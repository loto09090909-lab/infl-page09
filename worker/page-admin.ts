import {
  createSessionToken,
  getBearerToken,
  hasSessionSecret,
  resolveSessionTtl,
  revokeSessionToken,
  getSessionSubject,
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
import {
  errorResponse,
  errorResponseWithCode,
  jsonResponse,
  parseJsonBody,
  parseJsonBodyWithLimit,
  validateEmail,
  validatePlanId,
} from "./utils";
import {
  validateAccessControl as validateAccessControlShared,
  validateContactSchema as validateContactSchemaShared,
  validateContactSettings as validateContactSettingsShared,
  validateLinks as validateLinksShared,
  validateProfile as validateProfileShared,
  validateTheme as validateThemeShared,
} from "./validators";
import { authenticateExistingUser } from "./users";
import {
  enforceContactFieldLimit,
  enforcePlanLimit,
  enforcePrivateLinkLimit,
  getPagePlanId,
  getPlanLimits,
  hasPrivateLinks,
  PlanLimitError,
} from "./plan-limits";
import { countSubmissions } from "./contact";
import { countActivePrivateLinks } from "./private-links";
import {
  buildLoginIdentifier,
  clearLoginAttempts,
  getLoginThrottle,
  recordFailedLogin,
} from "./login-throttle";
import { ensurePageMemberBridge } from "./page-members";
import { recordAuditEvent } from "./audit";

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
  privateLinks?: unknown;
  contactSchema?: unknown;
  contactSettings?: unknown;
  accessControl?: unknown;
  slugs?: unknown;
  theme?: unknown;
};

const MAX_BODY_BYTES = 256 * 1024;

function validateTheme(raw: unknown) {
  return validateThemeShared(raw);
}

function validateProfile(profile: unknown) {
  return validateProfileShared(profile);
}

function validateContactSchema(raw: unknown) {
  return validateContactSchemaShared(raw);
}

function validateContactSettings(raw: unknown) {
  return validateContactSettingsShared(raw);
}

function validateAccessControl(raw: unknown) {
  return validateAccessControlShared(raw);
}

function validateLinks(rawLinks: unknown) {
  return validateLinksShared(rawLinks);
}

function generateAccessCode() {
  return crypto.randomUUID().replace(/-/g, "").slice(0, 10);
}

export async function pageAdminLogin(
  req: Request,
  env: any,
  pageId: string,
  headers: HeadersInit
) {
  if (!hasSessionSecret(env)) {
    return errorResponse("TOKEN_SECRET 또는 SESSION_SECRET이 필요합니다.", 500, headers);
  }

  const body = await parseJsonBody<LoginBody>(req);
  if (!body) {
    return errorResponse("이메일을 입력하세요", 400, headers);
  }
  const { email, error: emailError } = validateEmail(body.email);
  if (emailError) {
    return errorResponse(emailError, 400, headers);
  }

  const loginIdentifier = buildLoginIdentifier(req, email);
  const throttleState = await getLoginThrottle(env, "page", loginIdentifier);
  if (throttleState.blocked) {
    const waitSeconds = Math.max(1, Math.ceil((throttleState.resetAt - Date.now()) / 1000));
    return errorResponse(
      `로그인 시도가 너무 많습니다. ${waitSeconds}초 후 다시 시도하세요`,
      429,
      {
        ...headers,
        "Retry-After": String(waitSeconds),
        "X-RateLimit-Reset": new Date(throttleState.resetAt).toISOString(),
      }
    );
  }

  const canonicalPageId = await resolvePageId(env, pageId);

  const adminRow = await env.DB.prepare(
    "SELECT user_id FROM page_admins WHERE page_id = ? LIMIT 1"
  )
    .bind(canonicalPageId)
    .first<{ user_id: string }>();

  if (!adminRow?.user_id) {
    const memberExists = await env.DB.prepare(
      "SELECT 1 FROM page_members WHERE page_id = ? LIMIT 1"
    )
    .bind(canonicalPageId)
      .first<{ "1": number }>();
    if (!memberExists) {
      return errorResponseWithCode("페이지 관리자 계정을 찾을 수 없습니다", "NOT_FOUND", 404, headers);
    }
  }

  const result = await authenticateExistingUser(env, {
    email,
    password: body.password,
    oauthProvider: body.oauthProvider,
    oauthId: body.oauthId,
  });

  if ("error" in result) {
    await recordFailedLogin(env, "page", loginIdentifier);
    const code = result.status === 404 ? "NOT_FOUND" : "FORBIDDEN";
    return errorResponseWithCode(result.error, code, result.status, headers);
  }

  const memberRow = await env.DB.prepare(
    "SELECT 1 FROM page_members WHERE page_id = ? AND user_id = ? LIMIT 1"
  )
    .bind(canonicalPageId, result.user.id)
    .first<{ "1": number }>();

  if (!memberRow && result.user.id !== adminRow?.user_id) {
    await recordFailedLogin(env, "page", loginIdentifier);
    return errorResponseWithCode("페이지 관리자 권한이 없습니다", "FORBIDDEN", 403, headers);
  }

  await ensurePageMemberBridge(env, canonicalPageId, result.user.id);
  await clearLoginAttempts(env, "page", loginIdentifier);
  const ttlSeconds = resolveSessionTtl(env, "page");
  const session = await createSessionToken(env, "page", canonicalPageId, ttlSeconds);
  return jsonResponse(session, 200, headers);
}

export async function pageAdminLogout(
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
    return errorResponse("유효한 로그인 세션이 없습니다", 401, headers);
  }

  if (pageTokenValid) {
    await revokeSessionToken(env, "page", token);
  }

  if (superTokenValid) {
    await revokeSessionToken(env, "super", token);
  }

  return jsonResponse({ success: true, message: "로그아웃되었습니다" }, 200, headers);
}

export async function verifyPageSession(
  req: Request,
  env: any,
  pageId: string,
  headers: HeadersInit
) {
  const token = getBearerToken(req);
  const canonicalPageId = await resolvePageId(env, pageId);

  const superTokenValid = await verifySessionToken(env, "super", token);
  if (superTokenValid) {
    return jsonResponse(
      {
        ok: true,
        role: "super",
        pageId: canonicalPageId,
      },
      200,
      headers
    );
  }

  const pageTokenValid = await verifySessionToken(env, "page", token, canonicalPageId);
  if (!pageTokenValid) {
    return errorResponse("페이지 관리자 인증이 필요합니다", 401, headers);
  }

  const userId = await getSessionSubject(env, "page", token);
  if (!userId) {
    return errorResponse("세션에서 사용자 ID를 찾을 수 없습니다", 500, headers);
  }

  const memberRow = await env.DB.prepare(
    "SELECT role FROM page_members WHERE page_id = ? AND user_id = ? LIMIT 1"
  )
    .bind(canonicalPageId, userId)
    .first<{ role: string }>();
  
  let role = memberRow?.role || null;

  if (!role) {
    const adminRow = await env.DB.prepare(
      "SELECT 1 FROM page_admins WHERE page_id = ? AND user_id = ? LIMIT 1"
    )
      .bind(canonicalPageId, userId)
      .first<{ "1": number }>();
    if (adminRow) {
      role = "owner";
    }
  }

  if (!role) {
    return errorResponse("페이지에 대한 사용자의 역할을 찾을 수 없습니다.", 403, headers);
  }

  return jsonResponse(
    {
      ok: true,
      role: role,
      pageId: canonicalPageId,
    },
    200,
    headers
  );
}

export async function getPagePlanStatus(
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
    return errorResponse("페이지 관리자 인증이 필요합니다", 401, headers);
  }

  const planId = (await getPagePlanId(env, canonicalPageId)) ?? "free";
  const limits = await getPlanLimits(env, planId);
  const kvRaw = await env.PAGE_KV.get(`page:${canonicalPageId}`);
  let parsed: any = {};
  if (kvRaw) {
    try {
      parsed = JSON.parse(kvRaw);
    } catch (error) {
      parsed = {};
    }
  }

  const [activePrivateLinks, contactSubmissions] = await Promise.all([
    countActivePrivateLinks(env, canonicalPageId),
    countSubmissions(env, canonicalPageId),
  ]);

  const contactFieldCount = Array.isArray(parsed?.contactSchema) ? parsed.contactSchema.length : 0;

  const overages = {
    privateLinks: activePrivateLinks > limits.max_private_links,
    contactFields: contactFieldCount > limits.max_contact_fields,
  };

  return jsonResponse(
    {
      pageId: canonicalPageId,
      planId,
      limits,
      usage: {
        privateLinks: activePrivateLinks,
        contactFields: contactFieldCount,
        contactSubmissions,
      },
      overages,
    },
    200,
    headers
  );
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

  const { data: body, error: bodyError } = await parseJsonBodyWithLimit<SavePageBody>(
    req,
    MAX_BODY_BYTES
  );
  if (bodyError) {
    return errorResponse(bodyError, 413, headers);
  }
  if (!body) {
    return errorResponse("잘못된 요청 본문입니다", 400, headers);
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

  const { planId: nextPlanId, error: planError } = validatePlanId(body.plan);
  if (planError) {
    return errorResponse(planError, 400, headers);
  }

  const existingRaw = await env.PAGE_KV.get(`page:${canonicalPageId}`);
  let existingData: any = {};
  if (existingRaw) {
    try {
      existingData = JSON.parse(existingRaw);
    } catch (error) {
      existingData = {};
    }
  }

  const providedPrivate = Array.isArray((body as any).privateLinks)
    ? validateLinks((body as any).privateLinks)
    : { publicLinks: undefined, privateLinks: undefined, provided: false };
  if (providedPrivate?.error) {
    return errorResponse(providedPrivate.error, 400, headers);
  }

  const nextPublicLinks = linksProvided ? publicLinks ?? [] : existingData.links ?? [];
  const nextPrivateLinks = providedPrivate.provided
    ? providedPrivate.privateLinks ?? []
    : linksProvided && privateLinks !== undefined
    ? privateLinks ?? []
    : existingData.privateLinks ?? [];

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
  } else if (!(await hasSlugMap(env, canonicalPageId))) {
    slugs = await getSlugsForPage(env, canonicalPageId);
  }

  const slugsToPersist = slugs ?? existingData.slugs ?? [];
  const normalizedSlugs = (slugsToPersist && slugsToPersist.length)
    ? slugsToPersist
    : normalizeSlugs([], canonicalPageId);

  const pageData = {
    profile: profile ?? existingData.profile ?? {},
    links: nextPublicLinks,
    privateLinks: nextPrivateLinks,
    contactSchema:
      contactProvided || schema !== undefined ? schema ?? [] : existingData.contactSchema ?? [],
    contactSettings: contactSettings ?? existingData.contactSettings ?? { enabled: false },
    accessControl: accessControl ?? existingData.accessControl ?? { enabled: false },
    slugs: normalizedSlugs,
    plan: nextPlanId ?? existingData.plan ?? null,
    theme:
      typeof theme === "string"
        ? theme
        : typeof existingData.theme === "string"
        ? existingData.theme
        : "classic",
  };

  const effectivePlan = typeof pageData.plan === "string" ? pageData.plan : "free";
  if (contactProvided || schema !== undefined) {
    try {
      await enforceContactFieldLimit(env, effectivePlan, pageData.contactSchema?.length ?? 0);
    } catch (error) {
      if (error instanceof PlanLimitError) {
        return errorResponseWithCode(error.message, "PLAN_LIMIT_EXCEEDED", error.status, headers);
      }
      throw error;
    }
  }

  const linksForPlan = [...pageData.links, ...(pageData.privateLinks ?? [])];
  if (hasPrivateLinks(linksForPlan)) {
    try {
      await enforcePlanLimit(env, effectivePlan, "create_private_link");
      if (providedPrivate.provided || linksProvided) {
        await enforcePrivateLinkLimit(env, effectivePlan, pageData.privateLinks?.length ?? 0);
      }
    } catch (error) {
      if (error instanceof PlanLimitError) {
        return errorResponseWithCode(error.message, "PLAN_LIMIT_EXCEEDED", error.status, headers);
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
      typeof pageData.plan === "string" ? pageData.plan : "free"
    )
    .run();

  if (normalizedSlugs?.length) {
    await replaceSlugMap(env, canonicalPageId, normalizedSlugs);
  }

  const actorUserId =
    (await getSessionSubject(env, "page", token)) ||
    (await getSessionSubject(env, "super", token)) ||
    "unknown";
  await recordAuditEvent(env, {
    pageId: canonicalPageId,
    actorUserId,
    action: "page.updated",
  });

  return jsonResponse({ success: true, message: "Page saved" }, 200, headers);
}

export async function rotateAccessCode(
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

  const existingRaw = await env.PAGE_KV.get(`page:${canonicalPageId}`);
  if (!existingRaw) {
    return errorResponse("Page not found", 404, headers);
  }

  let existingData: any = {};
  try {
    existingData = JSON.parse(existingRaw);
  } catch (error) {
    existingData = {};
  }

  const code = generateAccessCode();
  const updated = {
    ...existingData,
    accessControl: {
      enabled: true,
      code,
    },
  };

  await env.PAGE_KV.put(`page:${canonicalPageId}`, JSON.stringify(updated));

  const actorUserId =
    (await getSessionSubject(env, "page", token)) ||
    (await getSessionSubject(env, "super", token)) ||
    "unknown";
  await recordAuditEvent(env, {
    pageId: canonicalPageId,
    actorUserId,
    action: "page.access_code.rotated",
  });

  return jsonResponse({ pageId: canonicalPageId, accessControl: updated.accessControl }, 200, headers);
}

export async function disableAccessCode(
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

  const existingRaw = await env.PAGE_KV.get(`page:${canonicalPageId}`);
  if (!existingRaw) {
    return errorResponse("Page not found", 404, headers);
  }

  let existingData: any = {};
  try {
    existingData = JSON.parse(existingRaw);
  } catch (error) {
    existingData = {};
  }

  const updated = {
    ...existingData,
    accessControl: { enabled: false },
  };

  await env.PAGE_KV.put(`page:${canonicalPageId}`, JSON.stringify(updated));

  const actorUserId =
    (await getSessionSubject(env, "page", token)) ||
    (await getSessionSubject(env, "super", token)) ||
    "unknown";
  await recordAuditEvent(env, {
    pageId: canonicalPageId,
    actorUserId,
    action: "page.access_code.disabled",
  });

  return jsonResponse({ pageId: canonicalPageId, accessControl: updated.accessControl }, 200, headers);
}
