import { createSessionToken, getBearerToken, verifySessionToken } from "./auth";
import { errorResponse, jsonResponse, parseJsonBody } from "./utils";

type LoginBody = {
  password?: string;
};

type SavePageBody = {
  profile?: unknown;
  links?: unknown;
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

  const storedPassword = await env.PAGE_KV.get(`page_auth:${pageId}`);
  if (storedPassword !== body.password) {
    return errorResponse("인증에 실패했습니다", 401, headers);
  }

  const session = await createSessionToken(env, "page", pageId);
  return jsonResponse(session, 200, headers);
}

export async function savePage(
  req: Request,
  env: any,
  pageId: string,
  headers: HeadersInit
) {
  const token = getBearerToken(req);
  const tokenValid = await verifySessionToken(env, "page", token, pageId);
  if (!tokenValid) {
    return errorResponse("인증이 필요합니다", 401, headers);
  }

  const body = await parseJsonBody<SavePageBody>(req);
  if (!body) {
    return errorResponse("잘못된 요청 본문입니다", 400, headers);
  }

  const pageData = { profile: body.profile ?? {}, links: body.links ?? [] };
  await env.PAGE_KV.put(`page:${pageId}`, JSON.stringify(pageData));

  return jsonResponse({ success: true, message: "Page saved" }, 200, headers);
}
