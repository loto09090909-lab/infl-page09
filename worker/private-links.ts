import { errorResponse, jsonResponse, parseJsonBody } from "./utils";
import { resolvePageId } from "./slug";
import { getBearerToken, verifySessionToken } from "./auth";

type PrivateLinkRecord = {
  token: string;
  createdAt: string;
  expiresAt?: string;
  maxUses?: number;
  uses: number;
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

export async function createPrivateLink(
  req: Request,
  env: any,
  headers: HeadersInit,
  pageId: string
) {
  const body = await parseJsonBody<CreatePrivateLinkBody>(req);

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
  };

  const list = await readTokenList(env, pageId);
  list.unshift(record);
  await writeTokenList(env, pageId, list.slice(0, 200));
  await env.PAGE_KV.put(privateTokenKey(pageId, token), JSON.stringify(record));

  return jsonResponse({ token, record }, 201, headers);
}

export async function listPrivateLinks(
  _req: Request,
  env: any,
  headers: HeadersInit,
  pageId: string
) {
  const list = await readTokenList(env, pageId);
  return jsonResponse({ items: list }, 200, headers);
}

export async function revokePrivateLink(
  _req: Request,
  env: any,
  headers: HeadersInit,
  pageId: string,
  token: string
) {
  const list = await readTokenList(env, pageId);
  const next = list.filter((item) => item.token !== token);
  await writeTokenList(env, pageId, next);
  await env.PAGE_KV.delete(privateTokenKey(pageId, token));
  return jsonResponse({ success: true }, 200, headers);
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

  if (record.expiresAt) {
    const expiresTime = Date.parse(record.expiresAt);
    if (Number.isFinite(expiresTime) && Date.now() > expiresTime) {
      await env.PAGE_KV.delete(tokenKey);
      return errorResponse("프라이빗 링크가 만료되었습니다", 410, headers);
    }
  }

  if (record.maxUses && record.uses >= record.maxUses) {
    await env.PAGE_KV.delete(tokenKey);
    return errorResponse("프라이빗 링크 사용 횟수가 초과되었습니다", 410, headers);
  }

  record.uses += 1;
  await env.PAGE_KV.put(tokenKey, JSON.stringify(record));

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
      theme: typeof parsed?.theme === "string" ? parsed.theme : "classic",
    },
    200,
    headers
  );
}
