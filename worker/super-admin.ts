import {
  createSessionToken,
  getBearerToken,
  hasSessionSecret,
  revokeSessionToken,
  verifySessionToken,
} from "./auth";
import { resolvePageId } from "./slug";
import {
  findConflictingSlug,
  getSlugsForPage,
  hasSlugMap,
  normalizeSlugs,
  replaceSlugMap,
} from "./slug-map";
import { errorResponse, errorResponseWithCode, jsonResponse, parseJsonBody } from "./utils";
import {
  enforceContactFieldLimit,
  enforcePlanLimit,
  enforcePrivateLinkLimit,
  hasPrivateLinks,
  PlanLimitError,
} from "./plan-limits";
import { findOrCreateUser, hashPassword, updateUserPassword, verifyPassword } from "./users";
import {
  buildLoginIdentifier,
  clearLoginAttempts,
  getLoginThrottle,
  recordFailedLogin,
} from "./login-throttle";

type CreatePageBody = {
  pageId: string;
  profile?: unknown;
  contactSchema?: unknown;
  contactSettings?: unknown;
  accessControl?: unknown;
  adminEmail: string;
  adminPassword?: string;
  adminOauthProvider?: string;
  adminOauthId?: string;
  plan?: unknown;
  links?: unknown;
  privateLinks?: unknown;
  slugs?: unknown;
  theme?: unknown;
};

type UpdatePageBody = {
  profile?: unknown;
  plan?: unknown;
  links?: unknown;
  privateLinks?: unknown;
  contactSchema?: unknown;
  contactSettings?: unknown;
  accessControl?: unknown;
  adminPassword?: string;
  slugs?: unknown;
  theme?: unknown;
};

type LoginBody = {
  username?: string;
  password?: string;
};

type NormalizedCreatePage = {
  pageId: string;
  profile: Record<string, unknown>;
  contactSchema: unknown[];
  contactSettings: Record<string, unknown>;
  accessControl: Record<string, unknown>;
  adminEmail: string;
  adminPassword?: string;
  adminOauthProvider?: string;
  adminOauthId?: string;
  plan: unknown;
  links: unknown[];
  privateLinks: unknown[];
  slugs: string[];
  theme?: string;
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

const MAX_LINKS = 100;
const ALLOWED_THEMES = new Set(["classic", "midnight", "sunset", "mint"]);

function sanitizeString(value: unknown, maxLength: number): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed ? trimmed.slice(0, maxLength) : undefined;
}

function isHttpUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch (error) {
    return false;
  }
}

function validateProfile(profile: unknown) {
  if (profile === undefined) return { profile: undefined };
  if (!profile || typeof profile !== "object") {
    return { error: "profile은 객체여야 합니다" };
  }

  const name = sanitizeString((profile as any).name, 120);
  const description = sanitizeString((profile as any).description, 500);
  const photoUrl = sanitizeString((profile as any).photoUrl, 500);

  if (photoUrl && !isHttpUrl(photoUrl)) {
    return { error: "photoUrl은 http(s) URL이어야 합니다" };
  }

  return {
    profile: {
      ...(name ? { name } : {}),
      ...(description ? { description } : {}),
      ...(photoUrl ? { photoUrl } : {}),
    },
  };
}

function validateContactSchema(raw: unknown) {
  if (raw === undefined) return { schema: undefined, provided: false };
  if (!Array.isArray(raw)) return { error: "contactSchema는 배열이어야 합니다" };
  if (raw.length > 50) return { error: "contactSchema 항목이 너무 많습니다" };

  const allowedTypes = new Set(["text", "email", "tel", "url", "textarea", "select", "checkbox"]);

  const schema = raw
    .map((field) => {
      if (!field || typeof field !== "object") return null;
      const label = sanitizeString((field as any).label, 120);
      const type = sanitizeString((field as any).type, 30);
      const placeholder = sanitizeString((field as any).placeholder, 200);
      const required = (field as any).required === true;
      const optionsRaw = Array.isArray((field as any).options) ? (field as any).options : [];
      const options = optionsRaw
        .map((opt) => sanitizeString(opt, 200))
        .filter((opt) => !!opt)
        .slice(0, 50);

      if (!label || !type || !allowedTypes.has(type)) return null;
      if ((type === "select" || type === "checkbox") && options.length === 0) return null;
      return {
        label,
        type,
        ...(placeholder ? { placeholder } : {}),
        ...(required ? { required: true } : {}),
        ...(options.length ? { options } : {}),
      };
    })
    .filter(Boolean);

  return { schema, provided: true };
}

function validateContactSettings(raw: unknown) {
  if (raw === undefined) return { settings: undefined };
  if (!raw || typeof raw !== "object") {
    return { error: "contactSettings는 객체여야 합니다" };
  }

  const webhookUrl = sanitizeString((raw as any).webhookUrl, 1000);
  const enabled = (raw as any).enabled === true;
  if (webhookUrl && !isHttpUrl(webhookUrl)) {
    return { error: "webhookUrl은 http(s)여야 합니다" };
  }

  return {
    settings: {
      ...(enabled ? { enabled: true } : { enabled: false }),
      ...(webhookUrl ? { webhookUrl } : {}),
    },
  };
}

function validateAccessControl(raw: unknown) {
  if (raw === undefined) return { accessControl: undefined };
  if (!raw || typeof raw !== "object") {
    return { error: "accessControl은 객체여야 합니다" };
  }

  const enabled = (raw as any).enabled === true;
  const code = sanitizeString((raw as any).code, 80);

  if (enabled && !code) {
    return { error: "accessControl.enabled가 true이면 code가 필요합니다" };
  }

  return {
    accessControl: {
      enabled,
      ...(code ? { code } : {}),
    },
  };
}

function validateLinks(rawLinks: unknown, defaultPrivate = false) {
  if (rawLinks === undefined) return { publicLinks: undefined, privateLinks: undefined, provided: false };
  if (!Array.isArray(rawLinks)) {
    return { error: "links는 배열이어야 합니다" };
  }

  if (rawLinks.length > MAX_LINKS) {
    return { error: "링크가 너무 많습니다" };
  }

  const publicLinks: any[] = [];
  const privateLinks: any[] = [];

  for (const rawLink of rawLinks) {
    if (!rawLink || typeof rawLink !== "object") continue;
    const title = sanitizeString((rawLink as any).title ?? (rawLink as any).name, 120);
    const url = sanitizeString((rawLink as any).url, 1000);
    const iconUrl = sanitizeString((rawLink as any).iconUrl, 500);
    const platformId = sanitizeString((rawLink as any).platformId, 120);
    const handle = sanitizeString((rawLink as any).handle, 200);
    const isPrivate =
      (rawLink as any).isPrivate === true || (rawLink as any).private === true || defaultPrivate;

    if (!title || !url) continue;
    if (!isHttpUrl(url)) {
      return { error: "링크 URL은 http(s)여야 합니다" };
    }

    const cleaned = {
      title,
      url,
      ...(iconUrl && isHttpUrl(iconUrl) ? { iconUrl } : {}),
      ...(platformId ? { platformId } : {}),
      ...(handle ? { handle } : {}),
      ...(isPrivate ? { isPrivate: true } : {}),
    };

    if (isPrivate) {
      privateLinks.push(cleaned);
    } else {
      publicLinks.push(cleaned);
    }
  }

  return { publicLinks, privateLinks, provided: true };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function validateTheme(raw: unknown) {
  if (raw === undefined) return { theme: undefined };
  if (typeof raw !== "string") return { error: "theme은 문자열이어야 합니다" };

  const trimmed = raw.trim();
  if (!trimmed) return { theme: "classic" };
  if (!ALLOWED_THEMES.has(trimmed)) {
    return { error: "지원하지 않는 테마입니다" };
  }

  return { theme: trimmed };
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
  const { error: profileError, profile } = validateProfile(body.profile);
  if (profileError) {
    throw new CreatePageError(profileError, 400);
  }

  const { error: linkError, publicLinks, privateLinks } = validateLinks(body.links);
  if (linkError) {
    throw new CreatePageError(linkError, 400);
  }

  const providedPrivate = validateLinks((body as any).privateLinks ?? [], true);
  if (providedPrivate?.error) {
    throw new CreatePageError(providedPrivate.error, 400);
  }

  const { error: contactError, schema: contactSchema } = validateContactSchema(
    body.contactSchema
  );
  if (contactError) {
    throw new CreatePageError(contactError, 400);
  }

  const { error: contactSettingsError, settings: contactSettings } = validateContactSettings(
    body.contactSettings
  );
  if (contactSettingsError) {
    throw new CreatePageError(contactSettingsError, 400);
  }

  const { error: accessError, accessControl } = validateAccessControl(body.accessControl);
  if (accessError) {
    throw new CreatePageError(accessError, 400);
  }

  const { error: themeError, theme } = validateTheme(body.theme);
  if (themeError) {
    throw new CreatePageError(themeError, 400);
  }

  return {
    pageId,
    profile: profile ?? {},
    contactSchema: contactSchema ?? [],
    contactSettings: contactSettings ?? { enabled: false },
    accessControl: accessControl ?? { enabled: false },
    adminEmail: body.adminEmail.trim().toLowerCase(),
    adminPassword: body.adminPassword,
    adminOauthProvider: body.adminOauthProvider,
    adminOauthId: body.adminOauthId,
    plan:
      typeof body.plan === "string" ? sanitizeString(body.plan, 30) ?? null : body.plan ?? null,
    links: publicLinks ?? [],
    privateLinks: [
      ...(privateLinks ?? []),
      ...(providedPrivate?.privateLinks ?? []),
    ],
    slugs: normalizeSlugs(body.slugs, pageId),
    theme: typeof theme === "string" ? theme : "classic",
  };
}

async function persistCreatePage(env: any, data: NormalizedCreatePage) {
  const planId = typeof data.plan === "string" ? data.plan : "free";
  await enforcePlanLimit(env, planId, "create_page");
  await enforceContactFieldLimit(env, planId, data.contactSchema?.length ?? 0);
  if (data.slugs.length) {
    await enforcePlanLimit(env, planId, "update_slug");
  }
  const allLinks = [...(data.links ?? []), ...(data.privateLinks ?? [])];
  if (hasPrivateLinks(allLinks)) {
    await enforcePlanLimit(env, planId, "create_private_link");
    await enforcePrivateLinkLimit(env, planId, data.privateLinks?.length ?? 0);
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
    privateLinks: Array.isArray(data.privateLinks) ? data.privateLinks : [],
    contactSchema: Array.isArray(data.contactSchema) ? data.contactSchema : [],
    contactSettings: data.contactSettings ?? { enabled: false },
    accessControl: data.accessControl ?? { enabled: false },
    slugs: data.slugs ?? [],
    plan: data.plan ?? null,
    theme: typeof data.theme === "string" ? data.theme : "classic",
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
      typeof data.plan === "string" ? data.plan : "free"
    )
    .run();

  await replaceSlugMap(env, data.pageId, data.slugs);
}

export async function superAdminLogin(
  req: Request,
  env: any,
  headers: HeadersInit
): Promise<Response> {
  if (!hasSessionSecret(env)) {
    return errorResponse("TOKEN_SECRET 또는 SESSION_SECRET이 필요합니다.", 500, headers);
  }

  const body = await parseJsonBody<LoginBody>(req);
  if (!body || typeof body.password !== "string") {
    return errorResponse("아이디와 비밀번호를 모두 입력하세요", 400, headers);
  }

  const username =
    typeof body.username === "string" && body.username.trim()
      ? body.username.trim()
      : "admin"; // 기본 슈퍼 관리자 호환

  const loginIdentifier = buildLoginIdentifier(req, username);
  const throttleState = await getLoginThrottle(env, "super", loginIdentifier);
  if (throttleState.blocked) {
    const waitSeconds = Math.max(1, Math.ceil((throttleState.resetAt - Date.now()) / 1000));
    return errorResponse(
      `로그인 시도가 너무 많습니다. ${waitSeconds}초 후 다시 시도하세요`,
      429,
      headers
    );
  }

  const row = await env.DB.prepare(
    "SELECT username, password_hash FROM super_admins WHERE username = ? LIMIT 1"
  )
    .bind(username)
    .first<{ username: string; password_hash: string }>();

  const passwordValid = await verifyPassword(body.password, row?.password_hash ?? null);

  if (!row || !passwordValid) {
    await recordFailedLogin(env, "super", loginIdentifier);
    return errorResponse("인증에 실패했습니다", 401, headers);
  }

  await clearLoginAttempts(env, "super", loginIdentifier);
  const session = await createSessionToken(env, "super", "super-admin");
  return jsonResponse(session, 200, headers);
}

export async function superAdminLogout(req: Request, env: any, headers: HeadersInit) {
  const token = getBearerToken(req);
  const valid = await verifySessionToken(env, "super", token);

  if (!valid) {
    return errorResponse("유효한 슈퍼 관리자 세션이 없습니다", 401, headers);
  }

  await revokeSessionToken(env, "super", token);
  return jsonResponse({ success: true, message: "로그아웃되었습니다" }, 200, headers);
}

export async function bootstrapSuperAdmin(
  req: Request,
  env: any,
  headers: HeadersInit
): Promise<Response> {
  if (!hasSessionSecret(env)) {
    return errorResponse("TOKEN_SECRET 또는 SESSION_SECRET이 필요합니다.", 500, headers);
  }

  const body = await parseJsonBody<LoginBody>(req);
  if (!body || typeof body.password !== "string") {
    return errorResponse("아이디와 비밀번호를 모두 입력하세요", 400, headers);
  }

  const username =
    typeof body.username === "string" && body.username.trim()
      ? body.username.trim()
      : "admin";

  if (username.length < 3) {
    return errorResponse("아이디는 3자 이상이어야 합니다", 400, headers);
  }

  if (body.password.trim().length < 8) {
    return errorResponse("비밀번호는 8자 이상으로 설정하세요", 400, headers);
  }

  const countRow = await env.DB.prepare(
    "SELECT COUNT(*) AS count FROM super_admins"
  ).first<{ count: number }>();
  const adminCount = Number(countRow?.count ?? 0);

  if (adminCount > 0) {
    const token = getBearerToken(req);
    const authorized = await verifySessionToken(env, "super", token);
    if (!authorized) {
      return errorResponse(
        "이미 계정이 있어 추가/초기화하려면 슈퍼 관리자 토큰이 필요합니다",
        401,
        headers
      );
    }
  }

  const passwordHash = await hashPassword(body.password);
  await env.DB.prepare(
    "INSERT OR REPLACE INTO super_admins (username, password_hash) VALUES (?, ?)"
  )
    .bind(username, passwordHash)
    .run();

  const status = adminCount === 0 ? 201 : 200;
  const mode = adminCount === 0 ? "bootstrapped" : "updated";
  return jsonResponse(
    { success: true, username, mode, passwordHash },
    status,
    headers
  );
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
      return errorResponseWithCode(error.message, "PLAN_LIMIT_EXCEEDED", error.status, headers);
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
    "FROM page_meta " + 
    (hasSearch ? "LEFT JOIN slug_map sm ON page_meta.page_id = sm.page_id " : "") +
    (hasSearch
      ? "WHERE page_meta.page_id LIKE ? OR page_meta.name LIKE ? OR sm.display_name LIKE ?"
      : " ");

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
    `SELECT DISTINCT page_meta.page_id, name, photo_url, description, links, plan_id ${baseQuery} ORDER BY page_meta.page_id LIMIT ? OFFSET ?`
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
      let plan: string | null = (row as any).plan_id ?? null;
      if (kvValue) {
        try {
          plan = JSON.parse(kvValue).plan ?? plan;
        } catch (error) {
          plan = plan ?? null;
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
        plan,
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
  let plan: string | null = row?.plan_id ?? null;
  let privateLinks: unknown[] = [];
  let contactSchema: unknown[] = [];
  let contactSettings: Record<string, unknown> | undefined;
  let slugs = await getSlugsForPage(env, row.page_id);
  let theme: string | null = null;
  if (kvValue) {
    try {
      const parsed = JSON.parse(kvValue);
      plan = parsed.plan ?? null;
      privateLinks = Array.isArray(parsed.privateLinks) ? parsed.privateLinks : [];
      contactSchema = Array.isArray(parsed.contactSchema)
        ? parsed.contactSchema
        : [];
      contactSettings = parsed.contactSettings && typeof parsed.contactSettings === "object"
        ? parsed.contactSettings
        : undefined;
      if (Array.isArray(parsed.slugs) && parsed.slugs.length) {
        slugs = parsed.slugs;
      }
      theme = typeof parsed.theme === "string" ? parsed.theme : null;
    } catch (error) {
      plan = null;
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
      plan: plan ?? row.plan_id ?? null,
      slugs,
      privateLinks,
      contactSchema,
      contactSettings,
      theme: theme ?? "classic",
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
  let existingData: any = {};
  try {
    existingData = JSON.parse(existingPage);
    existingPlan = existingData?.plan ?? null;
  } catch (error) {
    existingPlan = null;
    existingData = {};
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
      await enforcePlanLimit(env, body.plan ?? existingPlan, "update_slug");
    } catch (error) {
      if (error instanceof PlanLimitError) {
        return errorResponseWithCode(error.message, "PLAN_LIMIT_EXCEEDED", error.status, headers);
      }
      throw error;
    }
  } else {
    const hasExistingSlugMap = await hasSlugMap(env, canonicalPageId);
    if (!hasExistingSlugMap) {
      slugs = await getSlugsForPage(env, canonicalPageId);
    }
  }

  const { error: profileError, profile } = validateProfile(body.profile);
  if (profileError) {
    return errorResponse(profileError, 400, headers);
  }

  const {
    error: linkError,
    publicLinks,
    privateLinks,
    provided: linksProvided,
  } = validateLinks(body.links);
  if (linkError) {
    return errorResponse(linkError, 400, headers);
  }

  const providedPrivate = validateLinks((body as any).privateLinks ?? [], true);
  if (providedPrivate?.error) {
    return errorResponse(providedPrivate.error, 400, headers);
  }

  const { error: contactError, schema, provided: contactProvided } = validateContactSchema(
    body.contactSchema
  );
  if (contactError) {
    return errorResponse(contactError, 400, headers);
  }

  const { error: contactSettingsError, settings: contactSettings } = validateContactSettings(
    body.contactSettings
  );
  if (contactSettingsError) {
    return errorResponse(contactSettingsError, 400, headers);
  }

  const { error: accessError, accessControl } = validateAccessControl(body.accessControl);
  if (accessError) {
    return errorResponse(accessError, 400, headers);
  }

  const { error: themeError, theme } = validateTheme(body.theme);
  if (themeError) {
    return errorResponse(themeError, 400, headers);
  }

  const nextPublicLinks = linksProvided ? publicLinks ?? [] : existingData.links ?? [];
  const nextPrivateLinks = providedPrivate.provided
    ? providedPrivate.privateLinks ?? []
    : linksProvided && privateLinks !== undefined
    ? privateLinks ?? []
    : existingData.privateLinks ?? [];

  const updatedPage = {
    profile: profile ?? existingData.profile ?? {},
    links: nextPublicLinks,
    privateLinks: nextPrivateLinks,
    contactSchema:
      contactProvided || schema !== undefined
        ? schema ?? []
        : existingData.contactSchema ?? [],
    contactSettings: contactSettings ?? existingData.contactSettings ?? { enabled: false },
    accessControl: accessControl ?? existingData.accessControl ?? { enabled: false },
    plan:
      typeof body.plan === "string"
        ? sanitizeString(body.plan, 30) ?? existingPlan ?? null
        : body.plan ?? existingPlan ?? null,
    slugs: slugs ?? existingData.slugs ?? [],
    theme:
      typeof theme === "string"
        ? theme
        : typeof existingData.theme === "string"
        ? existingData.theme
        : "classic",
  };

  const effectivePlan = typeof updatedPage.plan === "string" ? updatedPage.plan : "free";
  if (contactProvided || schema !== undefined) {
    try {
      await enforceContactFieldLimit(env, effectivePlan, updatedPage.contactSchema?.length ?? 0);
    } catch (error) {
      if (error instanceof PlanLimitError) {
        return errorResponseWithCode(error.message, "PLAN_LIMIT_EXCEEDED", error.status, headers);
      }
      throw error;
    }
  }

  if (hasPrivateLinks([...updatedPage.links, ...(updatedPage.privateLinks ?? [])])) {
    try {
      await enforcePlanLimit(env, effectivePlan, "create_private_link");
      if (providedPrivate.provided || linksProvided) {
        await enforcePrivateLinkLimit(env, effectivePlan, updatedPage.privateLinks?.length ?? 0);
      }
    } catch (error) {
      if (error instanceof PlanLimitError) {
        return errorResponseWithCode(error.message, "PLAN_LIMIT_EXCEEDED", error.status, headers);
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
      JSON.stringify(updatedPage.links),
      typeof updatedPage.plan === "string" ? updatedPage.plan : "free"
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
