import { hashPassword } from "./users";
import { PlanLimitError } from "./plan-limits";

type CreatePrivateLinkBody = {
  ttlMinutes?: unknown;
  maxViews?: unknown;
  accessCode?: unknown;
};

export type PrivateLinkRow = {
  id: string;
  page_id: string;
  token: string;
  max_views: number | null;
  remaining_views: number | null;
  expire_at: string | null;
  access_code_hash: string | null;
};

export type PrivateLinkResponse = {
  token: string;
  expireAt: string | null;
  maxViews: number | null;
  remainingViews: number | null;
  requiresCode: boolean;
};

function normalizeNumber(value: unknown) {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function normalizeTtlMinutes(raw: unknown) {
  const parsed = normalizeNumber(raw);
  if (!parsed || parsed <= 0) return null;
  return Math.min(parsed, 24 * 60 * 7); // 최대 7일
}

function normalizeMaxViews(raw: unknown) {
  const parsed = normalizeNumber(raw);
  if (!parsed || parsed <= 0) return null;
  return Math.min(parsed, 10_000);
}

function normalizeAccessCode(raw: unknown) {
  if (typeof raw !== "string") return null;
  const trimmed = raw.trim();
  return trimmed.length ? trimmed : null;
}

function randomToken(length = 12) {
  const charset = "abcdefghijklmnopqrstuvwxyz0123456789";
  let token = "";
  const randomValues = crypto.getRandomValues(new Uint8Array(length));
  for (let i = 0; i < length; i++) {
    token += charset[randomValues[i] % charset.length];
  }
  return token;
}

export async function createPrivateLinkRecord(
  env: any,
  pageId: string,
  raw: CreatePrivateLinkBody
): Promise<PrivateLinkResponse> {
  const ttlMinutes = normalizeTtlMinutes(raw.ttlMinutes);
  const maxViews = normalizeMaxViews(raw.maxViews);
  const accessCode = normalizeAccessCode(raw.accessCode);

  const expireAt = ttlMinutes
    ? new Date(Date.now() + ttlMinutes * 60 * 1000).toISOString()
    : null;

  const accessCodeHash = accessCode ? await hashPassword(accessCode) : null;

  const token = randomToken(12);
  const id = crypto.randomUUID();

  await env.DB.prepare(
    "INSERT INTO private_links (id, page_id, token, max_views, remaining_views, expire_at, access_code_hash) VALUES (?, ?, ?, ?, ?, ?, ?)"
  )
    .bind(
      id,
      pageId,
      token,
      maxViews,
      maxViews,
      expireAt,
      accessCodeHash
    )
    .run();

  return {
    token,
    expireAt,
    maxViews,
    remainingViews: maxViews,
    requiresCode: !!accessCodeHash,
  };
}

export async function listPrivateLinks(env: any, pageId: string) {
  const rows = await env.DB.prepare(
    "SELECT id, page_id, token, max_views, remaining_views, expire_at, access_code_hash FROM private_links WHERE page_id = ? ORDER BY created_at DESC"
  )
    .bind(pageId)
    .all<PrivateLinkRow>();

  return (rows?.results ?? []).map((row) => formatResponse(row));
}

function formatResponse(row: PrivateLinkRow): PrivateLinkResponse {
  return {
    token: row.token,
    expireAt: row.expire_at,
    maxViews: row.max_views,
    remainingViews: row.remaining_views,
    requiresCode: !!row.access_code_hash,
  };
}

export async function consumePrivateLink(
  env: any,
  token: string,
  accessCode?: string | null
): Promise<{ pageId: string } | { error: string; status: number }> {
  const row = await env.DB.prepare(
    "SELECT id, page_id, token, max_views, remaining_views, expire_at, access_code_hash FROM private_links WHERE token = ? LIMIT 1"
  )
    .bind(token)
    .first<PrivateLinkRow>();

  if (!row) {
    return { error: "존재하지 않는 프라이빗 링크입니다", status: 404 } as const;
  }

  if (row.expire_at && Date.now() > Date.parse(row.expire_at)) {
    return { error: "만료된 링크입니다", status: 410 } as const;
  }

  if (row.remaining_views !== null && row.remaining_views <= 0) {
    return { error: "허용된 조회 수를 초과했습니다", status: 410 } as const;
  }

  if (row.access_code_hash) {
    const provided = normalizeAccessCode(accessCode);
    if (!provided) {
      return { error: "입장 코드가 필요합니다", status: 401 } as const;
    }

    const hashed = await hashPassword(provided);
    if (hashed !== row.access_code_hash) {
      return { error: "입장 코드가 올바르지 않습니다", status: 401 } as const;
    }
  }

  if (row.remaining_views !== null) {
    const nextRemaining = Math.max(0, row.remaining_views - 1);
    await env.DB.prepare(
      "UPDATE private_links SET remaining_views = ? WHERE id = ?"
    )
      .bind(nextRemaining, row.id)
      .run();
  }

  return { pageId: row.page_id } as const;
}

export function validatePrivateLinkCreation(planAllowed: boolean) {
  if (!planAllowed) {
    throw new PlanLimitError("이 플랜에서는 프라이빗 링크를 만들 수 없습니다", 403);
  }
}
