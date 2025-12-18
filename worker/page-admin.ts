import { createSessionToken, getBearerToken, verifySessionToken } from "./auth";
import { resolvePageId } from "./slug";
import { errorResponse, jsonResponse, parseJsonBody } from "./utils";
import { authenticateExistingUser } from "./users";
import { enforcePlanLimit, hasPrivateLinks, PlanLimitError } from "./plan-limits";

type LoginBody = {
  email?: string;
  password?: string;
  oauthProvider?: string;
  oauthId?: string;
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
  if (!body || typeof body.email !== "string") {
    return errorResponse("이메일을 입력하세요", 400, headers);
  }

  const canonicalPageId = await resolvePageId(env, pageId);

  const adminRow = await env.DB.prepare(
    "SELECT user_id FROM page_admins WHERE page_id = ? LIMIT 1"
  )
    .bind(canonicalPageId)
    .first<{ user_id: string }>();

  if (!adminRow?.user_id) {
    return errorResponse("페이지 관리자 계정을 찾을 수 없습니다", 404, headers);
  }

  const result = await authenticateExistingUser(env, {
    email: body.email,
    password: body.password,
    oauthProvider: body.oauthProvider,
    oauthId: body.oauthId,
  });

  if ("error" in result) {
    return errorResponse(result.error, result.status, headers);
  }

  if (result.user.id !== adminRow.user_id) {
    return errorResponse("페이지 관리자 권한이 없습니다", 403, headers);
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

  if (hasPrivateLinks(pageData.links)) {
    try {
      await enforcePlanLimit(env, pageData.plan, "create_private_link");
    } catch (error) {
      if (error instanceof PlanLimitError) {
        return errorResponse(error.message, error.status, headers);
      }
      throw error;
    }
  }
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

