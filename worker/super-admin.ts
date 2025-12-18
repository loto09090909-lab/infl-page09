import { createSessionToken } from "./auth";
import { resolvePageId } from "./slug";
import { errorResponse, jsonResponse, parseJsonBody } from "./utils";
import {
  enforcePlanLimit,
  hasPrivateLinks,
  normalizePlanId,
  PlanLimitError,
} from "./plan-limits";
import { findOrCreateUser, hashPassword, updateUserPassword } from "./users";
import {
  findConflictingSlug,
  getSlugsForPage,
  hasSlugMap,
  normalizeSlugs,
  replaceSlugMap,
} from "./slug-map";

type CreatePageBody = {
  pageId: string;
  profile?: unknown;
  adminEmail: string;
  adminPassword?: string;
  adminOauthProvider?: string;
  adminOauthId?: string;
  plan?: unknown;
  links?: unknown;
  slugs?: unknown;
};

type UpdatePageBody = {
  profile?: unknown;
  plan?: unknown;
  links?: unknown;
  adminPassword?: string;
  slugs?: unknown;
};

type LoginBody = {
  username?: string;
  password?: string;
};

type NormalizedCreatePage = {
  pageId: string;
  profile: Record<string, unknown>;
  adminEmail: string;
  adminPassword?: string;
  adminOauthProvider?: string;
  adminOauthId?: string;
  plan: unknown;
  links: unknown[];
  slugs: string[];
};

type BulkCreateBody = {
  pages?: CreatePageBody[];
};

class CreatePageError extends Error {
  status: number;

  constructor(message: string, status = 400) {
    super(message);
    this.status = status;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function normalizeCreatePageBody(
  body: CreatePageBody | null
): NormalizedCreatePage {
  if (!body || typeof body.pageId !== "string" || !body.pageId.trim()) {
    throw new CreatePageError("pageId와 관리자 이메일은 필수입니다", 400);
  }

  if (typeof body.adminEmail !== "string" || !body.adminEmail.trim()) {
    throw new CreatePageError("pageId와 관리자 이메일은 필수입니다", 400);
  }

  const isOAuth =
    typeof body.adminOauthProvider === "string" && typeof body.adminOauthId === "string";

  if (!isOAuth && (typeof body.adminPassword !== "string" || !body.adminPassword.trim())) {
    throw new CreatePageError("관리자 비밀번호가 필요합니다", 400);
  }

  const pageId = body.pageId.trim();
  const profile = isRecord(body.profile) ? body.profile : {};
  const links = Array.isArray((body as any).links) ? (body as any).links : [];

  return {
    pageId,
    profile,
    adminEmail: body.adminEmail.trim().toLowerCase(),
    adminPassword: body.adminPassword,
    adminOauthProvider: body.adminOauthProvider,
    adminOauthId: body.adminOauthId,
    plan: normalizePlanId(body.plan, "free"),
    links,
    slugs: normalizeSlugs(body.slugs, pageId),
  };
}

async function persistCreatePage(env: any, data: NormalizedCreatePage) {
  const planId = normalizePlanId(data.plan, "free");

  await enforcePlanLimit(env, planId, "create_page");
  if (data.slugs.length) {
    await enforcePlanLimit(env, planId, "update_slug");
  }
  if (hasPrivateLinks(data.links)) {
    await enforcePlanLimit(env, planId, "create_private_link");
  }

  const conflictingSlug = await findConflictingSlug(env, data.slugs, data.pageId);
  if (conflictingSlug) {
    throw new CreatePageError(
      `이미 다른 페이지에 사용 중인 슬러그입니다: ${conflictingSlug}`,
      409
    );
  }

  const pageData = {
    profile: data.profile ?? {},
    links: Array.isArray(data.links) ? data.links : [],
    plan: planId,
  };

  await env.PAGE_KV.put(`page:${data.pageId}`, JSON.stringify(pageData));

  const adminUser = await findOrCreateUser(env, {
    email: data.adminEmail,
    password: data.adminPassword,
    oauthProvider: data.adminOauthProvider,
    oauthId: data.adminOauthId,
  });

  if (data.adminPassword) {
    await updateUserPassword(env, adminUser.id, data.adminPassword);
  }

  await env.DB.prepare("INSERT OR REPLACE INTO page_admins (page_id, user_id) VALUES (?, ?)")
    .bind(data.pageId, adminUser.id)
    .run();

  await env.DB.prepare(
    "INSERT OR REPLACE INTO page_meta (page_id, name, photo_url, description, links, plan_id) VALUES (?, ?, ?, ?, ?, ?)"
  )
    .bind(
      data.pageId,
      (data.profile as any)?.name ?? null,
      (data.profile as any)?.photoUrl ?? null,
      (data.profile as any)?.description ?? null,
      JSON.stringify((data as any).links ?? []),
      planId
    )
    .run();

  await replaceSlugMap(env, data.pageId, data.slugs);
}

export async function superAdminLogin(
  req: Request,
  env: any,
  headers: HeadersInit
): Promise<Response> {
  const body = await parseJsonBody<LoginBody>(req);
  if (!body || typeof body.password !== "string") {
    return errorResponse("아이디와 비밀번호를 모두 입력하세요", 400, headers);
  }

  const username =
    typeof body.username === "string" && body.username.trim()
      ? body.username.trim()
      : "admin"; // 기본 슈퍼 관리자 호환

  const row = await env.DB.prepare(
    "SELECT username, password_hash FROM super_admins WHERE username = ? LIMIT 1"
  )
    .bind(username)
    .first<{ username: string; password_hash: string }>();

  if (!row) {
    return errorResponse("인증에 실패했습니다", 401, headers);
  }

  const hashedInput = await hashPassword(body.password);
  const passwordMatches =
    row.password_hash === hashedInput || row.password_hash === body.password;

  if (!passwordMatches) {
    return errorResponse("인증에 실패했습니다", 401, headers);
  }

  // 레거시 평문 비밀번호를 사용하는 경우 자동으로 해시로 승격
  if (row.password_hash === body.password) {
    await env.DB.prepare(
      "UPDATE super_admins SET password_hash = ? WHERE username = ?"
    )
      .bind(hashedInput, username)
      .run();
  }

  const session = await createSessionToken(env, "super", "super-admin");
  return jsonResponse(session, 200, headers);
}

export async function createPage(
  req: Request,
  env: any,
  headers: HeadersInit
): Promise<Response> {
  try {
    const body = await parseJsonBody<CreatePageBody>(req);
    const normalized = normalizeCreatePageBody(body);
    await persistCreatePage(env, normalized);
    return jsonResponse({ success: true, message: "Page created" }, 201, headers);
  } catch (error) {
    if (error instanceof CreatePageError) {
      return errorResponse(error.message, error.status, headers);
    }
    if (error instanceof PlanLimitError) {
      return errorResponse(error.message, error.status, headers);
    }
    throw error;
  }
}

export async function bulkCreatePages(
  req: Request,
  env: any,
  headers: HeadersInit
): Promise<Response> {
  const body = await parseJsonBody<BulkCreateBody>(req);
  if (!body || !Array.isArray(body.pages) || !body.pages.length) {
    return errorResponse(
      "업로드할 페이지 데이터가 없습니다. pages 배열을 확인하세요.",
      400,
      headers
    );
  }

  const results: { pageId: string; success: boolean; message: string; status: number }[] = [];

  for (const raw of body.pages) {
    let normalized: NormalizedCreatePage;
    try {
      normalized = normalizeCreatePageBody(raw as any);
      await persistCreatePage(env, normalized);
      results.push({
        pageId: normalized.pageId,
        success: true,
        message: "created",
        status: 201,
      });
    } catch (error) {
      const status =
        error instanceof CreatePageError || error instanceof PlanLimitError
          ? error.status
          : 500;
      const message =
        error instanceof CreatePageError || error instanceof PlanLimitError
          ? error.message
          : "알 수 없는 오류";
      const pageId = (raw as any)?.pageId || "(미지정)";
      results.push({
        pageId: String(pageId),
        success: false,
        message,
        status,
      });
    }
  }

  const successCount = results.filter((item) => item.success).length;
  const failedCount = results.length - successCount;
  const status = failedCount && successCount ? 207 : failedCount ? 400 : 201;

  return jsonResponse(
    {
      summary: {
        total: results.length,
        success: successCount,
        failed: failedCount,
      },
      results,
    },
    status,
    headers
  );
}

export async function listPages(
  req: Request,
  env: any,
  headers: HeadersInit
): Promise<Response> {
  const url = new URL(req.url);
  const page = Math.max(1, Number(url.searchParams.get("page")) || 1);
  const pageSize = Math.min(100, Math.max(1, Number(url.searchParams.get("pageSize")) || 30));
  const search = (url.searchParams.get("search") || "").trim();

  const hasSearch = !!search;
  const likeSearch = `%${search}%`;

  const baseQuery =
    "FROM page_meta pm " +
    (hasSearch ? "LEFT JOIN slug_map sm ON pm.page_id = sm.page_id " : "") +
    (hasSearch
      ? "WHERE pm.page_id LIKE ? OR pm.name LIKE ? OR sm.display_name LIKE ?"
      : "");

  const countParams = hasSearch ? [likeSearch, likeSearch, likeSearch] : [];
  let countStmt = env.DB.prepare(
    `SELECT COUNT(DISTINCT pm.page_id) AS total ${baseQuery}`
  );
  if (countParams.length) {
    countStmt = countStmt.bind(...countParams);
  }
  const countRow = await countStmt.first<{ total: number }>();

  const total = Number(countRow?.total || 0);
  const offset = (page - 1) * pageSize;

  const dataParams = hasSearch
    ? [likeSearch, likeSearch, likeSearch, pageSize, offset]
    : [pageSize, offset];

  let dataStmt = env.DB.prepare(
    `SELECT DISTINCT pm.page_id, pm.name, pm.photo_url, pm.description, pm.links, pm.plan_id ${baseQuery} ORDER BY pm.page_id LIMIT ? OFFSET ?`
  );
  if (dataParams.length) {
    dataStmt = dataStmt.bind(...dataParams);
  }

  const dbRows = await dataStmt.all<{
    page_id: string;
    name: string | null;
    photo_url: string | null;
    description: string | null;
    links: string | null;
    plan_id: string | null;
  }>();

  const mapped = await Promise.all(
    (dbRows?.results ?? []).map(async (row) => {
      const kvValue = await env.PAGE_KV.get(`page:${row.page_id}`);
      let planFromKv: string | null = null;
      if (kvValue) {
        try {
          planFromKv = JSON.parse(kvValue).plan ?? null;
        } catch (error) {
          planFromKv = null;
        }
      }

      return {
        pageId: row.page_id,
        profile: {
          name: row.name,
          photoUrl: row.photo_url,
          description: row.description,
        },
        links: safeParseLinks(row.links),
        plan: normalizePlanId(row.plan_id ?? planFromKv, "free"),
        slugs: await getSlugsForPage(env, row.page_id),
      };
    })
  );

  return jsonResponse(
    {
      items: mapped,
      total,
      page,
      pageSize,
    },
    200,
    headers
  );
}

export async function getAdminPage(
  env: any,
  pageId: string,
  headers: HeadersInit
): Promise<Response> {
  const canonicalPageId = await resolvePageId(env, pageId);
  const row = await env.DB.prepare(
    "SELECT page_id, name, photo_url, description, links, plan_id FROM page_meta WHERE page_id = ? LIMIT 1"
  )
    .bind(canonicalPageId)
    .first<{
      page_id: string;
      name: string | null;
      photo_url: string | null;
      description: string | null;
      links: string | null;
      plan_id: string | null;
    }>();

  if (!row) {
    return errorResponse("Page not found", 404, headers);
  }

  const kvValue = await env.PAGE_KV.get(`page:${row.page_id}`);
  let planFromKv: string | null = null;
  if (kvValue) {
    try {
      planFromKv = JSON.parse(kvValue).plan ?? null;
    } catch (error) {
      planFromKv = null;
    }
  }

  return jsonResponse(
    {
      pageId: row.page_id,
      profile: {
        name: row.name,
        photoUrl: row.photo_url,
        description: row.description,
      },
      links: safeParseLinks(row.links),
      plan: normalizePlanId(row.plan_id ?? planFromKv, "free"),
      slugs: await getSlugsForPage(env, row.page_id),
    },
    200,
    headers
  );
}

export async function deletePage(
  env: any,
  pageId: string,
  headers: HeadersInit
): Promise<Response> {
  const canonicalPageId = await resolvePageId(env, pageId);

  const exists = await env.PAGE_KV.get(`page:${canonicalPageId}`);
  if (!exists) {
    return errorResponse("Page not found", 404, headers);
  }

  await env.PAGE_KV.delete(`page:${canonicalPageId}`);
  await env.DB.prepare("DELETE FROM page_admins WHERE page_id = ?")
    .bind(canonicalPageId)
    .run();

  await env.DB.prepare("DELETE FROM page_meta WHERE page_id = ?")
    .bind(canonicalPageId)
    .run();

  await env.DB.prepare("DELETE FROM slug_map WHERE page_id = ?")
    .bind(canonicalPageId)
    .run();

  return jsonResponse({ success: true, message: "Page deleted" }, 200, headers);
}

export async function updatePage(
  req: Request,
  env: any,
  pageId: string,
  headers: HeadersInit
): Promise<Response> {
  const canonicalPageId = await resolvePageId(env, pageId);

  const existingPage = await env.PAGE_KV.get(`page:${canonicalPageId}`);
  if (!existingPage) {
    return errorResponse("Page not found", 404, headers);
  }

  const body = await parseJsonBody<UpdatePageBody>(req);
  if (!body) {
    return errorResponse("잘못된 요청 본문입니다", 400, headers);
  }

  let existingPlan: unknown = null;
  try {
    const parsedExisting = JSON.parse(existingPage);
    existingPlan = parsedExisting?.plan ?? null;
  } catch (error) {
    existingPlan = null;
  }

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
      await enforcePlanLimit(env, normalizePlanId(body.plan ?? existingPlan, "free"), "update_slug");
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

  const normalizedPlan = normalizePlanId(body.plan ?? existingPlan, "free");
  const updatedPage = {
    profile: body.profile ?? {},
    links: Array.isArray((body as any).links) ? (body as any).links : [],
    plan: normalizedPlan,
  };

  if (hasPrivateLinks(updatedPage.links)) {
    try {
      await enforcePlanLimit(env, normalizedPlan, "create_private_link");
    } catch (error) {
      if (error instanceof PlanLimitError) {
        return errorResponse(error.message, error.status, headers);
      }
      throw error;
    }
  }

  await env.PAGE_KV.put(`page:${canonicalPageId}`, JSON.stringify(updatedPage));

  if (body.adminPassword) {
    const adminRow = await env.DB.prepare(
      "SELECT user_id FROM page_admins WHERE page_id = ? LIMIT 1"
    )
      .bind(canonicalPageId)
      .first<{ user_id: string }>();

    if (adminRow?.user_id) {
      await updateUserPassword(env, adminRow.user_id, body.adminPassword);
    }
  }

  await env.DB.prepare(
    "INSERT OR REPLACE INTO page_meta (page_id, name, photo_url, description, links, plan_id) VALUES (?, ?, ?, ?, ?, ?)"
  )
    .bind(
      canonicalPageId,
      (updatedPage.profile as any)?.name ?? null,
      (updatedPage.profile as any)?.photoUrl ?? null,
      (updatedPage.profile as any)?.description ?? null,
      JSON.stringify((body as any).links ?? []),
      normalizedPlan
    )
    .run();

  if (slugs) {
    await replaceSlugMap(env, canonicalPageId, slugs);
  }

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
