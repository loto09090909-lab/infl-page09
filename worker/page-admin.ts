import { createSessionToken, getBearerToken, verifySessionToken } from "./auth";
import { errorResponse, jsonResponse, parseJsonBody } from "./utils";

type LoginBody = {
  password?: string;
};

type SavePageBody = {
  profile?: unknown;
  links?: unknown;
  plan?: unknown;
};

export async function pageAdminLogin(
  req: Request,
  env: any,
  pageId: string,
  headers: HeadersInit
) {
  const body = await parseJsonBody<LoginBody>(req);
  if (!body || typeof body.password !== "string") {
    return errorResponse("유효한 비밀번호를 입력하세요", 400, headers);
  }

  const canonicalPageId = await resolvePageId(env, pageId);

  const dbRow = await env.DB.prepare(
    "SELECT password_hash FROM page_auth WHERE page_id = ? LIMIT 1"
  )
    .bind(canonicalPageId)
    .first<{ password_hash: string }>();

  const storedPassword =
    dbRow?.password_hash ?? (await env.PAGE_KV.get(`page_auth:${canonicalPageId}`));
  if (!storedPassword || storedPassword !== body.password) {
    return errorResponse("인증에 실패했습니다", 401, headers);
  }

  const session = await createSessionToken(env, "page", canonicalPageId);
  return jsonResponse(session, 200, headers);
}

export async function savePage(
  req: Request,
  env: any,
  pageId: string,
  headers: HeadersInit
) {
  const token = getBearerToken(req);
  const canonicalPageId = await resolvePageId(env, pageId);
  const pageTokenValid = await verifySessionToken(env, "page", token, canonicalPageId);
  const superTokenValid = await verifySessionToken(env, "super", token);
  if (!pageTokenValid && !superTokenValid) {
    return errorResponse("인증이 필요합니다", 401, headers);
  }

  const body = await parseJsonBody<SavePageBody>(req);
  if (!body) {
    return errorResponse("잘못된 요청 본문입니다", 400, headers);
  }

  const existingRaw = await env.PAGE_KV.get(`page:${canonicalPageId}`);
  let existingPlan: unknown = null;
  if (existingRaw) {
    try {
      const parsed = JSON.parse(existingRaw);
      existingPlan = parsed.plan ?? null;
    } catch (error) {
      existingPlan = null;
    }
  }

  const pageData = {
    profile: body.profile ?? {},
    links: Array.isArray(body.links) ? body.links : [],
    plan: body.plan ?? existingPlan ?? null,
  };
  await env.PAGE_KV.put(`page:${canonicalPageId}`, JSON.stringify(pageData));

  await env.DB.prepare(
    "INSERT OR REPLACE INTO page_meta (page_id, name, photo_url, description, links) VALUES (?, ?, ?, ?, ?)"
  )
    .bind(
      canonicalPageId,
      (pageData.profile as any)?.name ?? null,
      (pageData.profile as any)?.photoUrl ?? null,
      (pageData.profile as any)?.description ?? null,
      JSON.stringify(pageData.links)
    )
    .run();

  return jsonResponse({ success: true, message: "Page saved" }, 200, headers);
}

async function resolvePageId(env: any, incoming: string) {
  const row = await env.DB.prepare(
    "SELECT page_id FROM slug_map WHERE display_name = ? LIMIT 1"
  )
    .bind(incoming)
    .first<{ page_id: string }>();

  return row?.page_id ?? incoming;
}
