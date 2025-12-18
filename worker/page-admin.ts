import { createSessionToken, getBearerToken, verifySessionToken } from "./auth";
import { resolvePageId } from "./slug";
import { errorResponse, jsonResponse, parseJsonBody } from "./utils";
import { authenticateExistingUser } from "./users";
import {
  enforcePlanLimit,
  hasPrivateLinks,
  normalizePlanId,
  PlanLimitError,
} from "./plan-limits";
import {
  createPrivateLinkRecord,
  listPrivateLinks,
} from "./private-links";
import {
  findConflictingSlug,
  getSlugsForPage,
  hasSlugMap,
  normalizeSlugs,
  replaceSlugMap,
} from "./slug-map";

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
  slugs?: unknown;
};

type PrivateLinkBody = {
  ttlMinutes?: unknown;
  maxViews?: unknown;
  accessCode?: unknown;
};

type PageAccessResult =
  | { authorized: Response }
  | { authorized: true; canonicalPageId: string };

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
  const access = await verifyPageAccess(req, env, pageId, headers);
  if (access.authorized !== true) return access.authorized;
  const canonicalPageId = access.canonicalPageId;

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

  const metaRow = await env.DB.prepare(
    "SELECT plan_id FROM page_meta WHERE page_id = ? LIMIT 1"
  )
    .bind(canonicalPageId)
    .first<{ plan_id: string | null }>();

  const normalizedPlan = normalizePlanId(
    body.plan ?? metaRow?.plan_id ?? existingPlan,
    "free"
  );

  let slugs: string[] | null = null;
  if (body.slugs !== undefined) {
    slugs = normalizeSlugs(body.slugs, canonicalPageId);
    const conflict = await findConflictingSlug(env, slugs, canonicalPageId);
    if (conflict) {
      return errorResponse(
        `이미 다른 페이지에 사용 중인 슬러그입니다: ${conflict}`,
        409,
        headers
      );
    }

    try {
      await enforcePlanLimit(env, normalizedPlan, "update_slug");
    } catch (error) {
      if (error instanceof PlanLimitError) {
        return errorResponse(error.message, error.status, headers);
      }
      throw error;
    }
  } else {
    const hasExistingSlugMap = await hasSlugMap(env, canonicalPageId);
    if (!hasExistingSlugMap) {
      slugs = await getSlugsForPage(env, canonicalPageId);
    }
  }
  const pageData = {
    profile: body.profile ?? {},
    links: Array.isArray(body.links) ? body.links : [],
    plan: normalizedPlan,
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
    "INSERT OR REPLACE INTO page_meta (page_id, name, photo_url, description, links, plan_id) VALUES (?, ?, ?, ?, ?, ?)"
  )
    .bind(
      canonicalPageId,
      (pageData.profile as any)?.name ?? null,
      (pageData.profile as any)?.photoUrl ?? null,
      (pageData.profile as any)?.description ?? null,
      JSON.stringify(pageData.links),
      normalizedPlan
    )
    .run();

  if (slugs) {
    await replaceSlugMap(env, canonicalPageId, slugs);
  }

  return jsonResponse({ success: true, message: "Page saved" }, 200, headers);
}

export async function createPrivateLink(
  req: Request,
  env: any,
  pageId: string,
  headers: HeadersInit
) {
  const access = await verifyPageAccess(req, env, pageId, headers);
  if (access.authorized !== true) return access.authorized;

  const planId = await getPlanForPage(env, access.canonicalPageId);
  try {
    await enforcePlanLimit(env, planId, "create_private_link");
  } catch (error) {
    if (error instanceof PlanLimitError) {
      return errorResponse(error.message, error.status, headers);
    }
    throw error;
  }

  const body = await parseJsonBody<PrivateLinkBody>(req);
  if (!body) {
    return errorResponse("잘못된 요청 본문입니다", 400, headers);
  }

  const created = await createPrivateLinkRecord(
    env,
    access.canonicalPageId,
    body
  );

  return jsonResponse({ link: created }, 201, headers);
}

export async function listPrivateLinksForPage(
  req: Request,
  env: any,
  pageId: string,
  headers: HeadersInit
) {
  const access = await verifyPageAccess(req, env, pageId, headers);
  if (access.authorized !== true) return access.authorized;

  const links = await listPrivateLinks(env, access.canonicalPageId);
  return jsonResponse({ links }, 200, headers);
}

export async function verifyPageAccess(
  req: Request,
  env: any,
  pageId: string,
  headers: HeadersInit
): Promise<PageAccessResult> {
  const token = getBearerToken(req);
  const canonicalPageId = await resolvePageId(env, pageId);
  const pageTokenValid = await verifySessionToken(env, "page", token, canonicalPageId);
  const superTokenValid = await verifySessionToken(env, "super", token);

  if (!pageTokenValid && !superTokenValid) {
    return { authorized: errorResponse("인증이 필요합니다", 401, headers) } as const;
  }

  return { authorized: true as const, canonicalPageId };
}

export async function getPlanForPage(env: any, canonicalPageId: string) {
  const metaRow = await env.DB.prepare(
    "SELECT plan_id FROM page_meta WHERE page_id = ? LIMIT 1"
  )
    .bind(canonicalPageId)
    .first<{ plan_id: string | null }>();

  if (metaRow?.plan_id) {
    return metaRow.plan_id;
  }

  const existingRaw = await env.PAGE_KV.get(`page:${canonicalPageId}`);
  if (existingRaw) {
    try {
      const parsed = JSON.parse(existingRaw);
      if (parsed.plan) {
        return parsed.plan;
      }
    } catch (error) {
      // ignore JSON parse errors
    }
  }

  return "free";
}

