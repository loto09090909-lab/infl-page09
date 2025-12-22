import { errorResponse, errorResponseWithCode, jsonResponse, parseJsonBody } from "./utils";
import { resolvePageId } from "./slug";
import { getBearerToken, verifySessionToken } from "./auth";
import {
  enforcePlanLimit,
  enforcePrivateLinkLimit,
  getPagePlanId,
  PlanLimitError,
} from "./plan-limits";

type PrivateLinkRecord = {
  token: string;
  createdAt: string;
  expiresAt?: string;
  maxUses?: number;
  uses: number;
  status: "active" | "expired" | "usedup" | "revoked";
  revokedAt?: string;
  lastUsedAt?: string;
  note?: string;
};

type CreatePrivateLinkBody = {
  expiresAt?: string;
  maxUses?: number;
  note?: string;
};

function sanitizeString(value: unknown, maxLength: number): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed ? trimmed.slice(0, maxLength) : undefined;
}

function parsePositiveInt(value: unknown): number | undefined {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return undefined;
  return Math.floor(parsed);
}

function buildToken() {
  return crypto.randomUUID().replace(/-/g, "");
}

function privateListKey(pageId: string) {
  return `private:${pageId}:tokens`;
}

function privateTokenKey(pageId: string, token: string) {
  return `private:${pageId}:token:${token}`;
}

function getRetentionMs(env: any) {
  const raw = Number(env.PRIVATE_LINK_RETENTION_DAYS ?? 30);
  const days = Number.isFinite(raw) && raw > 0 ? raw : 30;
  return days * 24 * 60 * 60 * 1000;
}

function getPruneIntervalMs(env: any) {
  const raw = Number(env.PRIVATE_LINK_PRUNE_INTERVAL_MINUTES ?? 60);
  const minutes = Number.isFinite(raw) && raw > 0 ? raw : 60;
  return minutes * 60 * 1000;
}

function pruneMarkerKey(pageId: string) {
  return `private:${pageId}:prune`;
}

async function readTokenList(env: any, pageId: string): Promise<PrivateLinkRecord[]> {
  const raw = await env.PAGE_KV.get(privateListKey(pageId));
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch (error) {
    return [];
  }
}

async function writeTokenList(env: any, pageId: string, list: PrivateLinkRecord[]) {
  await env.PAGE_KV.put(privateListKey(pageId), JSON.stringify(list));
}

async function ensurePrivateLinksMigrated(env: any, pageId: string) {
  const countRow = await env.DB.prepare(
    "SELECT COUNT(*) AS count FROM private_links WHERE page_id = ?"
  )
    .bind(pageId)
    .first<{ count: number }>();
  if (Number(countRow?.count ?? 0) > 0) {
    return;
  }

  const list = await readTokenList(env, pageId);
  for (const record of list) {
    const status = computeStatus(record);
    await persistPrivateLink(env, pageId, { ...record, status });
  }
}

function computeStatus(record: PrivateLinkRecord) {
  if (record.status === "revoked") return "revoked";
  if (record.expiresAt) {
    const expiresTime = Date.parse(record.expiresAt);
    if (Number.isFinite(expiresTime) && Date.now() > expiresTime) {
      return "expired";
    }
  }
  if (record.maxUses && record.uses >= record.maxUses) {
    return "usedup";
  }
  return "active";
}

function getInactiveTimestamp(record: PrivateLinkRecord) {
  const candidate =
    record.revokedAt || record.expiresAt || record.lastUsedAt || record.createdAt;
  if (!candidate) return null;
  const parsed = Date.parse(candidate);
  return Number.isFinite(parsed) ? parsed : null;
}

async function persistPrivateLink(env: any, pageId: string, record: PrivateLinkRecord) {
  await env.DB.prepare(
    "INSERT OR REPLACE INTO private_links (page_id, token, status, created_at, expires_at, max_uses, uses, revoked_at, last_used_at, note) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"
  )
    .bind(
      pageId,
      record.token,
      record.status,
      record.createdAt,
      record.expiresAt ?? null,
      record.maxUses ?? null,
      record.uses ?? 0,
      record.revokedAt ?? null,
      record.lastUsedAt ?? null,
      record.note ?? null
    )
    .run();
}

async function shouldPrunePrivateLinks(env: any, pageId: string, force: boolean) {
  if (force) return true;
  const intervalMs = getPruneIntervalMs(env);
  if (!intervalMs) return false;
  const last = await env.PAGE_KV.get(pruneMarkerKey(pageId));
  if (!last) return true;
  const parsed = Date.parse(last);
  if (!Number.isFinite(parsed)) return true;
  return Date.now() - parsed >= intervalMs;
}

async function markPrivateLinksPruned(env: any, pageId: string) {
  await env.PAGE_KV.put(pruneMarkerKey(pageId), new Date().toISOString());
}

export async function prunePrivateLinksForPage(
  env: any,
  pageId: string,
  { force = false } = {}
) {
  const shouldPrune = await shouldPrunePrivateLinks(env, pageId, force);
  if (!shouldPrune) return { removed: 0, updated: 0 };

  await ensurePrivateLinksMigrated(env, pageId);
  const list = await readTokenList(env, pageId);
  if (list.length === 0) {
    await markPrivateLinksPruned(env, pageId);
    return { removed: 0, updated: 0 };
  }

  const retentionMs = getRetentionMs(env);
  const now = Date.now();
  const next: PrivateLinkRecord[] = [];
  const tokensToDelete: string[] = [];
  let updatedCount = 0;

  for (const record of list) {
    const status = computeStatus(record);
    const nextRecord = status !== record.status ? { ...record, status } : record;
    if (status !== record.status) {
      updatedCount += 1;
      await env.PAGE_KV.put(privateTokenKey(pageId, record.token), JSON.stringify(nextRecord));
      await persistPrivateLink(env, pageId, nextRecord);
    }

    if (status === "active") {
      next.push(nextRecord);
      continue;
    }

    const inactiveAt = getInactiveTimestamp(nextRecord);
    if (inactiveAt && now - inactiveAt > retentionMs) {
      tokensToDelete.push(record.token);
      continue;
    }
    next.push(nextRecord);
  }

  if (tokensToDelete.length > 0 || next.length !== list.length) {
    await writeTokenList(env, pageId, next);
  }

  if (tokensToDelete.length > 0) {
    await Promise.all(
      tokensToDelete.map((token) =>
        env.PAGE_KV.delete(privateTokenKey(pageId, token))
      )
    );
    const deletes = tokensToDelete.map((token) =>
      env.DB.prepare("DELETE FROM private_links WHERE page_id = ? AND token = ?").bind(
        pageId,
        token
      )
    );
    await env.DB.batch(deletes);
  }

  await markPrivateLinksPruned(env, pageId);
  return { removed: tokensToDelete.length, updated: updatedCount };
}

export async function createPrivateLinkRecord(
  env: any,
  pageId: string,
  body: CreatePrivateLinkBody | null
) {
  const expiresAt = sanitizeString(body?.expiresAt, 40);
  const maxUses = parsePositiveInt(body?.maxUses);
  const note = sanitizeString(body?.note, 120);

  const token = buildToken();
  const now = new Date().toISOString();
  const record: PrivateLinkRecord = {
    token,
    createdAt: now,
    ...(expiresAt ? { expiresAt } : {}),
    ...(maxUses ? { maxUses } : {}),
    ...(note ? { note } : {}),
    uses: 0,
    status: "active",
  };

  const list = await readTokenList(env, pageId);
  list.unshift(record);
  await writeTokenList(env, pageId, list.slice(0, 200));
  await env.PAGE_KV.put(privateTokenKey(pageId, token), JSON.stringify(record));
  await persistPrivateLink(env, pageId, record);

  return { token, record };
}

export async function countActivePrivateLinks(env: any, pageId: string) {
  await ensurePrivateLinksMigrated(env, pageId);
  try {
    await prunePrivateLinksForPage(env, pageId);
  } catch (error) {
    console.warn("private link prune failed", error);
  }
  const row = await env.DB.prepare(
    "SELECT COUNT(*) AS count FROM private_links WHERE page_id = ? AND status = 'active'"
  )
    .bind(pageId)
    .first<{ count: number }>();
  return Number(row?.count ?? 0);
}

export async function createPrivateLink(
  req: Request,
  env: any,
  headers: HeadersInit,
  pageId: string
) {
  const body = await parseJsonBody<CreatePrivateLinkBody>(req);
  const created = await createPrivateLinkRecord(env, pageId, body);
  return jsonResponse(created, 201, headers);
}

export async function listPrivateLinks(
  _req: Request,
  env: any,
  headers: HeadersInit,
  pageId: string
) {
  await ensurePrivateLinksMigrated(env, pageId);
  try {
    await prunePrivateLinksForPage(env, pageId);
  } catch (error) {
    console.warn("private link prune failed", error);
  }
  const list = await readTokenList(env, pageId);
  const refreshed = await Promise.all(
    list.map(async (record) => {
      const status = computeStatus(record);
      if (status !== record.status) {
        const updated = { ...record, status };
        await env.PAGE_KV.put(privateTokenKey(pageId, record.token), JSON.stringify(updated));
        await persistPrivateLink(env, pageId, updated);
        return updated;
      }
      return record;
    })
  );
  return jsonResponse({ items: refreshed }, 200, headers);
}

export async function prunePrivateLinks(env: any) {
  const rows = await env.DB.prepare("SELECT DISTINCT page_id FROM private_links").all<{
    page_id: string;
  }>();
  const pageIds = (rows?.results ?? []).map((row) => row.page_id).filter(Boolean);

  for (const pageId of pageIds) {
    try {
      await prunePrivateLinksForPage(env, pageId, { force: true });
    } catch (error) {
      console.warn("private link prune failed", { pageId, error });
    }
  }
}

export async function revokePrivateLink(
  _req: Request,
  env: any,
  headers: HeadersInit,
  pageId: string,
  token: string
) {
  await ensurePrivateLinksMigrated(env, pageId);
  const list = await readTokenList(env, pageId);
  const next = list.map((item) => {
    if (item.token !== token) return item;
    return {
      ...item,
      status: "revoked" as const,
      revokedAt: new Date().toISOString(),
    };
  });
  await writeTokenList(env, pageId, next);
  const updated = next.find((item) => item.token === token);
  if (updated) {
    await env.PAGE_KV.put(privateTokenKey(pageId, token), JSON.stringify(updated));
    await persistPrivateLink(env, pageId, updated);
  }
  return jsonResponse({ success: true }, 200, headers);
}

export async function createRandomPrivateLink(
  req: Request,
  env: any,
  headers: HeadersInit,
  pageId: string
) {
  const resolvedPageId = await resolvePageId(env, pageId);
  const kvRaw = await env.PAGE_KV.get(`page:${resolvedPageId}`);
  if (!kvRaw) {
    return errorResponse("Page not found", 404, headers);
  }
  let parsed: any = null;
  try {
    parsed = JSON.parse(kvRaw);
  } catch (error) {
    parsed = null;
  }

  const accessControl = parsed?.accessControl ?? {};
  if (accessControl?.enabled) {
    const urlCode = new URL(req.url).searchParams.get("code");
    const headerCode = req.headers.get("X-Page-Code");
    const provided = headerCode || urlCode;
    if (!provided || provided !== accessControl.code) {
      return errorResponseWithCode("접근 코드가 필요합니다", "FORBIDDEN", 401, headers);
    }
  }

  const planId = (await getPagePlanId(env, resolvedPageId)) ?? "free";
  try {
    await enforcePlanLimit(env, planId, "create_private_link");
    const activeCount = await countActivePrivateLinks(env, resolvedPageId);
    await enforcePrivateLinkLimit(env, planId, activeCount);
  } catch (error) {
    if (error instanceof PlanLimitError) {
      return errorResponseWithCode(error.message, "PLAN_LIMIT_EXCEEDED", error.status, headers);
    }
    throw error;
  }

  const expiresAt = new Date(Date.now() + 15 * 60 * 1000).toISOString();
  const fakeReq = new Request(req.url, {
    method: "POST",
    headers: req.headers,
    body: JSON.stringify({ expiresAt, maxUses: 1, note: "random" }),
  });

  return createPrivateLink(fakeReq, env, headers, resolvedPageId);
}

export async function getPrivatePage(
  req: Request,
  env: any,
  headers: HeadersInit,
  pageId: string,
  token: string
) {
  const resolvedPageId = await resolvePageId(env, pageId);
  const tokenKey = privateTokenKey(resolvedPageId, token);
  const raw = await env.PAGE_KV.get(tokenKey);
  if (!raw) {
    return errorResponse("프라이빗 링크가 유효하지 않습니다", 404, headers);
  }

  let record: PrivateLinkRecord | null = null;
  try {
    record = JSON.parse(raw);
  } catch (error) {
    record = null;
  }

  if (!record) {
    return errorResponse("프라이빗 링크가 유효하지 않습니다", 404, headers);
  }
  await ensurePrivateLinksMigrated(env, resolvedPageId);

  const status = computeStatus(record);
  if (status === "expired") {
    const updated = { ...record, status };
    await env.PAGE_KV.put(tokenKey, JSON.stringify(updated));
    await persistPrivateLink(env, resolvedPageId, updated);
    return errorResponse("프라이빗 링크가 만료되었습니다", 410, headers);
  }

  if (status === "usedup") {
    const updated = { ...record, status };
    await env.PAGE_KV.put(tokenKey, JSON.stringify(updated));
    await persistPrivateLink(env, resolvedPageId, updated);
    return errorResponse("프라이빗 링크 사용 횟수가 초과되었습니다", 410, headers);
  }

  if (status === "revoked") {
    return errorResponse("프라이빗 링크가 비활성화되었습니다", 410, headers);
  }

  record.uses += 1;
  record.lastUsedAt = new Date().toISOString();
  record.status = computeStatus(record);
  await env.PAGE_KV.put(tokenKey, JSON.stringify(record));
  await persistPrivateLink(env, resolvedPageId, record);

  const kvRaw = await env.PAGE_KV.get(`page:${resolvedPageId}`);
  if (!kvRaw) {
    return errorResponse("Page not found", 404, headers);
  }

  let parsed: any = null;
  try {
    parsed = JSON.parse(kvRaw);
  } catch (error) {
    return errorResponse("Page data is corrupted", 500, headers);
  }

  const authToken = getBearerToken(req);
  const isSuperAdmin = await verifySessionToken(env, "super", authToken);
  const contactSettings = parsed?.contactSettings ?? {};
  const safeContactSettings = isSuperAdmin
    ? {
        enabled: contactSettings?.enabled === true,
        ...(contactSettings?.webhookUrl ? { webhookUrl: contactSettings.webhookUrl } : {}),
      }
    : { enabled: contactSettings?.enabled === true };

  return jsonResponse(
    {
      profile: parsed?.profile ?? {},
      links: Array.isArray(parsed?.links) ? parsed.links : [],
      privateLinks: parsed?.privateLinks ?? [],
      plan: parsed?.plan ?? null,
      contactSchema: parsed?.contactSchema ?? [],
      contactSettings: safeContactSettings,
      accessControl: { enabled: false },
      theme: typeof parsed?.theme === "string" ? parsed.theme : "classic",
    },
    200,
    headers
  );
}
