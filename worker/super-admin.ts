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
  password?: string;
};

export async function superAdminLogin(
  req: Request,
  env: any,
  headers: HeadersInit
): Promise<Response> {
  const body = await parseJsonBody<LoginBody>(req);
  if (!body || typeof body.password !== "string") {
    return errorResponse("유효한 비밀번호를 입력하세요", 400, headers);
  }

  const storedPassword = await env.PAGE_KV.get("super_admin_password");
  if (storedPassword !== body.password) {
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

  return jsonResponse({ success: true, message: "Page created" }, 201, headers);
}

export async function listPages(env: any, headers: HeadersInit): Promise<Response> {
  const keys = await env.PAGE_KV.list({ prefix: "page:" });
  const pages = await Promise.all(
    keys.keys.map(async (key) => {
      const data = await env.PAGE_KV.get(key.name);
      if (!data) return null;
      try {
        const parsed = JSON.parse(data);
        const pageId = key.name.replace(/^page:/, "");
        return { pageId, ...parsed };
      } catch (error) {
        return null;
      }
    })
  );

  const sanitized = pages.filter(Boolean);
  return jsonResponse(sanitized, 200, headers);
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

  return jsonResponse({ success: true, message: "Page updated" }, 200, headers);
}
