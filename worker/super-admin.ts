import { createSessionToken } from "./auth";
import { errorResponse, jsonResponse, parseJsonBody } from "./utils";

type CreatePageBody = {
  pageId: string;
  profile?: unknown;
  adminPassword: string;
  plan?: unknown;
};

type UpdatePageBody = {
  profile?: unknown;
  plan?: unknown;
};

type LoginBody = {
  username?: string;
  password?: string;
};

export async function superAdminLogin(
  req: Request,
  env: any,
  headers: HeadersInit
): Promise<Response> {
  const body = await parseJsonBody<LoginBody>(req);
  if (!body || typeof body.username !== "string" || typeof body.password !== "string") {
    return errorResponse("아이디와 비밀번호를 모두 입력하세요", 400, headers);
  }

  const row = await env.DB.prepare(
    "SELECT username, password_hash FROM super_admin WHERE username = ? LIMIT 1"
  )
    .bind(body.username)
    .first<{ username: string; password_hash: string }>();

  if (!row || row.password_hash !== body.password) {
    return errorResponse("인증에 실패했습니다", 401, headers);
  }

  const session = await createSessionToken(env, "super", "super-admin");
  return jsonResponse(session, 200, headers);
}

export async function createPage(
  req: Request,
  env: any,
  headers: HeadersInit
): Promise<Response> {
  const body = await parseJsonBody<CreatePageBody>(req);
  if (!body || !body.pageId || !body.adminPassword) {
    return errorResponse("pageId와 adminPassword는 필수입니다", 400, headers);
  }

  const pageData = { profile: body.profile ?? {}, plan: body.plan ?? null };
  await env.PAGE_KV.put(`page:${body.pageId}`, JSON.stringify(pageData));
  await env.PAGE_KV.put(`page_auth:${body.pageId}`, body.adminPassword);

  await env.DB.prepare(
    "INSERT OR REPLACE INTO page_auth (page_id, password_hash) VALUES (?, ?)"
  )
    .bind(body.pageId, body.adminPassword)
    .run();

  await env.DB.prepare(
    "INSERT OR REPLACE INTO page_meta (page_id, name, photo_url, description, links) VALUES (?, ?, ?, ?, ?)"
  )
    .bind(
      body.pageId,
      (body.profile as any)?.name ?? null,
      (body.profile as any)?.photoUrl ?? null,
      (body.profile as any)?.description ?? null,
      JSON.stringify((body as any).links ?? [])
    )
    .run();

  return jsonResponse({ success: true, message: "Page created" }, 201, headers);
}

export async function listPages(env: any, headers: HeadersInit): Promise<Response> {
  const dbRows = await env.DB.prepare(
    "SELECT page_id, name, photo_url, description, links FROM page_meta"
  ).all<{ page_id: string; name: string | null; photo_url: string | null; description: string | null; links: string | null }>();

  const mapped = (dbRows?.results ?? []).map((row) => ({
    pageId: row.page_id,
    profile: {
      name: row.name,
      photoUrl: row.photo_url,
      description: row.description,
    },
    links: safeParseLinks(row.links),
  }));

  return jsonResponse(mapped, 200, headers);
}

export async function deletePage(
  env: any,
  pageId: string,
  headers: HeadersInit
): Promise<Response> {
  const exists = await env.PAGE_KV.get(`page:${pageId}`);
  if (!exists) {
    return errorResponse("Page not found", 404, headers);
  }

  await env.PAGE_KV.delete(`page:${pageId}`);
  await env.PAGE_KV.delete(`page_auth:${pageId}`);

  await env.DB.prepare("DELETE FROM page_auth WHERE page_id = ?")
    .bind(pageId)
    .run();

  await env.DB.prepare("DELETE FROM page_meta WHERE page_id = ?")
    .bind(pageId)
    .run();

  return jsonResponse({ success: true, message: "Page deleted" }, 200, headers);
}

export async function updatePage(
  req: Request,
  env: any,
  pageId: string,
  headers: HeadersInit
): Promise<Response> {
  const existingPage = await env.PAGE_KV.get(`page:${pageId}`);
  if (!existingPage) {
    return errorResponse("Page not found", 404, headers);
  }

  const body = await parseJsonBody<UpdatePageBody>(req);
  if (!body) {
    return errorResponse("잘못된 요청 본문입니다", 400, headers);
  }

  const updatedPage = { profile: body.profile ?? {}, plan: body.plan ?? null };
  await env.PAGE_KV.put(`page:${pageId}`, JSON.stringify(updatedPage));

  await env.DB.prepare(
    "INSERT OR REPLACE INTO page_meta (page_id, name, photo_url, description, links) VALUES (?, ?, ?, ?, ?)"
  )
    .bind(
      pageId,
      (updatedPage.profile as any)?.name ?? null,
      (updatedPage.profile as any)?.photoUrl ?? null,
      (updatedPage.profile as any)?.description ?? null,
      JSON.stringify((body as any).links ?? [])
    )
    .run();

  return jsonResponse({ success: true, message: "Page updated" }, 200, headers);
}

function safeParseLinks(raw: string | null) {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch (error) {
    return [];
  }
}
