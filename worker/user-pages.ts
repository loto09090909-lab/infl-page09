import { getBearerToken, getSessionSubject } from "./auth";
import { resolvePageId } from "./slug";
import { findConflictingSlug, getSlugsForPage, normalizeSlugs, replaceSlugMap } from "./slug-map";
import {
  enforceContactFieldLimit,
  enforceMaxPages,
  enforcePlanLimit,
  enforcePrivateLinkLimit,
  getPlanLimits,
  getPagePlanId,
  hasPrivateLinks,
  PlanLimitError,
} from "./plan-limits";
import {
  errorResponse,
  errorResponseWithCode,
  jsonResponse,
  parseJsonBody,
  parseJsonBodyWithLimit,
  validatePageId,
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
import { clearContactSubmissionsData, countSubmissions, fetchSubmissions } from "./contact";
import { getPageStats } from "./stats";
import {
  createPrivateLink,
  countActivePrivateLinks,
  listPrivateLinks,
  revokePrivateLink,
} from "./private-links";
import {
  acceptInvite,
  createInvite,
  ensurePageMemberBridge,
  listInvites,
  listMembers,
  removeMember,
  revokeInvite,
} from "./page-members";
import { recordAuditEvent } from "./audit";

type CreatePageBody = {
  pageId?: string;
  profile?: unknown;
  links?: unknown;
  privateLinks?: unknown;
  contactSchema?: unknown;
  contactSettings?: unknown;
  accessControl?: unknown;
  slugs?: unknown;
  theme?: unknown;
};

type UpdatePageBody = {
  profile?: unknown;
  links?: unknown;
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

function validateLinks(rawLinks: unknown, defaultPrivate = false) {
  return validateLinksShared(rawLinks, defaultPrivate);
}

async function requireUserSession(req: Request, env: any, headers: HeadersInit) {
  const token = getBearerToken(req);
  const userId = await getSessionSubject(env, "user", token);
  if (!userId) {
    return { error: errorResponse("로그인이 필요합니다", 401, headers) } as const;
  }
  return { userId } as const;
}

async function requireUserPageAccess(
  req: Request,
  env: any,
  headers: HeadersInit,
  pageId: string
) {
  const session = await requireUserSession(req, env, headers);
  if ("error" in session) return session;

  const canonicalPageId = await resolvePageId(env, pageId);
  const memberRow = await env.DB.prepare(
    "SELECT role FROM page_members WHERE page_id = ? AND user_id = ? LIMIT 1"
  )
    .bind(canonicalPageId, session.userId)
    .first<{ role: string }>();

  if (!memberRow) {
    const adminRow = await env.DB.prepare(
      "SELECT 1 FROM page_admins WHERE page_id = ? AND user_id = ? LIMIT 1"
    )
      .bind(canonicalPageId, session.userId)
      .first<{ "1": number }>();
    if (!adminRow) {
      return {
        error: errorResponseWithCode("페이지 관리자 권한이 없습니다", "FORBIDDEN", 403, headers),
      } as const;
    }
    await ensurePageMemberBridge(env, canonicalPageId, session.userId);
    return { userId: session.userId, pageId: canonicalPageId, role: "owner" } as const;
  }

  return {
    userId: session.userId,
    pageId: canonicalPageId,
    role: memberRow.role as "owner" | "editor" | "viewer",
  } as const;
}

async function getPagePlan(env: any, pageId: string) {
  const planId = await getPagePlanId(env, pageId);
  return planId ?? "free";
}

async function getUserPlanId(env: any, userId: string) {
  const row = await env.DB.prepare("SELECT plan_id FROM users WHERE id = ? LIMIT 1")
    .bind(userId)
    .first<{ plan_id: string | null }>();
  return row?.plan_id ?? "free";
}

async function countOwnedPages(env: any, userId: string) {
  const row = await env.DB.prepare(
    "SELECT COUNT(*) AS count FROM page_members WHERE user_id = ? AND role = 'owner'"
  )
    .bind(userId)
    .first<{ count: number }>();
  if (row && typeof row.count === "number" && row.count > 0) {
    return Number(row.count);
  }
  const fallback = await env.DB.prepare(
    "SELECT COUNT(DISTINCT page_id) AS count FROM page_admins WHERE user_id = ?"
  )
    .bind(userId)
    .first<{ count: number }>();
  return Number(fallback?.count ?? 0);
}

function generateAccessCode() {
  return crypto.randomUUID().replace(/-/g, "").slice(0, 10);
}

export async function createUserPage(req: Request, env: any, headers: HeadersInit) {
  const session = await requireUserSession(req, env, headers);
  if ("error" in session) return session.error;

  const userPlan = await getUserPlanId(env, session.userId);
  try {
    await enforcePlanLimit(env, userPlan, "create_page");
    const ownedCount = await countOwnedPages(env, session.userId);
    await enforceMaxPages(env, userPlan, ownedCount);
  } catch (error) {
    if (error instanceof PlanLimitError) {
      return errorResponseWithCode(error.message, "PLAN_LIMIT_EXCEEDED", error.status, headers);
    }
    throw error;
  }

  const { data: body, error: bodyError } = await parseJsonBodyWithLimit<CreatePageBody>(
    req,
    MAX_BODY_BYTES
  );
  if (bodyError) {
    return errorResponse(bodyError, 413, headers);
  }
  if (!body) {
    return errorResponse("pageId가 필요합니다", 400, headers);
  }

  const { pageId, error: pageIdError } = validatePageId(body.pageId);
  if (pageIdError) {
    return errorResponse(pageIdError, 400, headers);
  }
  const existing = await env.PAGE_KV.get(`page:${pageId}`);
  if (existing) {
    return errorResponse("이미 존재하는 페이지입니다", 409, headers);
  }

  const existingMeta = await env.DB.prepare(
    "SELECT page_id FROM page_meta WHERE page_id = ? LIMIT 1"
  )
    .bind(pageId)
    .first();
  if (existingMeta) {
    return errorResponse("이미 존재하는 페이지입니다", 409, headers);
  }

  const { error: profileError, profile } = validateProfile(body.profile);
  if (profileError) {
    return errorResponse(profileError, 400, headers);
  }

  const { error: linkError, publicLinks, privateLinks } = validateLinks(body.links);
  if (linkError) {
    return errorResponse(linkError, 400, headers);
  }

  const providedPrivate = validateLinks((body as any).privateLinks ?? [], true);
  if (providedPrivate?.error) {
    return errorResponse(providedPrivate.error, 400, headers);
  }

  const { error: contactError, schema: contactSchema } = validateContactSchema(body.contactSchema);
  if (contactError) {
    return errorResponse(contactError, 400, headers);
  }

  try {
    await enforceContactFieldLimit(env, userPlan, contactSchema?.length ?? 0);
  } catch (error) {
    if (error instanceof PlanLimitError) {
      return errorResponseWithCode(error.message, "PLAN_LIMIT_EXCEEDED", error.status, headers);
    }
    throw error;
  }

  const { error: contactSettingsError, settings: contactSettings } =
    validateContactSettings(body.contactSettings);
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

  const { planId: nextPlanId, error: planError } = validatePlanId(body.plan);
  if (planError) {
    return errorResponse(planError, 400, headers);
  }
  if (nextPlanId && nextPlanId !== userPlan) {
    return errorResponseWithCode("플랜 변경 권한이 없습니다", "FORBIDDEN", 403, headers);
  }

  const plan = nextPlanId ?? userPlan;

  const slugs = normalizeSlugs(body.slugs, pageId);
  if (body.slugs !== undefined) {
    try {
      await enforcePlanLimit(env, plan, "update_slug");
    } catch (error) {
      if (error instanceof PlanLimitError) {
        return errorResponseWithCode(error.message, "PLAN_LIMIT_EXCEEDED", error.status, headers);
      }
      throw error;
    }
  }

  const conflictingSlug = await findConflictingSlug(env, slugs, pageId);
  if (conflictingSlug) {
    return errorResponse(`이미 다른 페이지에 사용 중인 슬러그입니다: ${conflictingSlug}`, 409, headers);
  }

  const combinedPrivateLinks = [
    ...(privateLinks ?? []),
    ...(providedPrivate?.privateLinks ?? []),
  ];
  if (hasPrivateLinks([...(publicLinks ?? []), ...combinedPrivateLinks])) {
    try {
      await enforcePlanLimit(env, plan, "create_private_link");
      await enforcePrivateLinkLimit(env, plan, combinedPrivateLinks.length);
    } catch (error) {
      if (error instanceof PlanLimitError) {
        return errorResponseWithCode(error.message, "PLAN_LIMIT_EXCEEDED", error.status, headers);
      }
      throw error;
    }
  }

  const pageData = {
    profile: profile ?? {},
    links: publicLinks ?? [],
    privateLinks: combinedPrivateLinks,
    contactSchema: contactSchema ?? [],
    contactSettings: contactSettings ?? { enabled: false },
    accessControl: accessControl ?? { enabled: false },
    slugs,
    plan,
    theme: typeof theme === "string" ? theme : "classic",
  };

  await env.PAGE_KV.put(`page:${pageId}`, JSON.stringify(pageData));

  await env.DB.prepare(
    "INSERT OR REPLACE INTO page_meta (page_id, name, photo_url, description, links, plan_id) VALUES (?, ?, ?, ?, ?, ?)"
  )
    .bind(
      pageId,
      (pageData.profile as any)?.name ?? null,
      (pageData.profile as any)?.photoUrl ?? null,
      (pageData.profile as any)?.description ?? null,
      JSON.stringify(pageData.links),
      typeof pageData.plan === "string" ? pageData.plan : "free"
    )
    .run();

  await env.DB.prepare(
    "INSERT OR IGNORE INTO page_admins (page_id, user_id) VALUES (?, ?)"
  )
    .bind(pageId, session.userId)
    .run();

  await env.DB.prepare(
    "INSERT OR IGNORE INTO page_members (page_id, user_id, role) VALUES (?, ?, 'owner')"
  )
    .bind(pageId, session.userId)
    .run();

  await replaceSlugMap(env, pageId, slugs);

  await recordAuditEvent(env, {
    pageId,
    actorUserId: session.userId,
    action: "page.created",
    metadata: { plan },
  });

  return jsonResponse({ success: true, pageId }, 201, headers);
}

export async function getUserPage(req: Request, env: any, headers: HeadersInit, pageId: string) {
  const access = await requireUserPageAccess(req, env, headers, pageId);
  if ("error" in access) return access.error;

  const kvRaw = await env.PAGE_KV.get(`page:${access.pageId}`);
  if (!kvRaw) {
    return errorResponse("Page not found", 404, headers);
  }

  let parsed: any = {};
  try {
    parsed = JSON.parse(kvRaw);
  } catch (error) {
    return errorResponse("Page data is corrupted", 500, headers);
  }

  const dbRow = await env.DB.prepare(
    "SELECT page_id, name, photo_url, description, links FROM page_meta WHERE page_id = ? LIMIT 1"
  )
    .bind(access.pageId)
    .first<{
      page_id: string;
      name: string | null;
      photo_url: string | null;
      description: string | null;
      links: string | null;
    }>();

  return jsonResponse(
    {
      pageId: access.pageId,
      profile: {
        name: dbRow?.name ?? parsed?.profile?.name ?? null,
        photoUrl: dbRow?.photo_url ?? parsed?.profile?.photoUrl ?? null,
        description: dbRow?.description ?? parsed?.profile?.description ?? null,
      },
      links: dbRow ? safeParseLinks(dbRow.links) : Array.isArray(parsed.links) ? parsed.links : [],
      privateLinks: parsed.privateLinks ?? [],
      contactSchema: parsed.contactSchema ?? [],
      contactSettings: parsed.contactSettings ?? { enabled: false },
      slugs: Array.isArray(parsed.slugs) ? parsed.slugs : await getSlugsForPage(env, access.pageId),
      plan: parsed.plan ?? null,
      theme: typeof parsed.theme === "string" ? parsed.theme : "classic",
    },
    200,
    headers
  );
}

export async function updateUserPage(
  req: Request,
  env: any,
  headers: HeadersInit,
  pageId: string
) {
  const access = await requireUserPageAccess(req, env, headers, pageId);
  if ("error" in access) return access.error;

  if (access.role === "viewer") {
    return errorResponseWithCode("페이지 편집 권한이 없습니다", "FORBIDDEN", 403, headers);
  }

  const existingRaw = await env.PAGE_KV.get(`page:${access.pageId}`);
  if (!existingRaw) {
    return errorResponse("Page not found", 404, headers);
  }

  const { data: body, error: bodyError } = await parseJsonBodyWithLimit<UpdatePageBody>(
    req,
    MAX_BODY_BYTES
  );
  if (bodyError) {
    return errorResponse(bodyError, 413, headers);
  }
  if (!body) {
    return errorResponse("잘못된 요청 본문입니다", 400, headers);
  }

  if (body.plan !== undefined && access.role !== "owner") {
    return errorResponseWithCode("플랜 변경 권한이 없습니다", "FORBIDDEN", 403, headers);
  }

  let existingData: any = {};
  try {
    existingData = JSON.parse(existingRaw);
  } catch (error) {
    existingData = {};
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

  let slugs: string[] | null = null;
  if (body.slugs !== undefined) {
    slugs = normalizeSlugs(body.slugs, access.pageId);
    const conflict = await findConflictingSlug(env, slugs, access.pageId);
    if (conflict) {
      return errorResponse(`이미 다른 페이지에 사용 중인 슬러그입니다: ${conflict}`, 409, headers);
    }

    try {
      await enforcePlanLimit(env, existingData.plan ?? "free", "update_slug");
    } catch (error) {
      if (error instanceof PlanLimitError) {
        return errorResponseWithCode(error.message, "PLAN_LIMIT_EXCEEDED", error.status, headers);
      }
      throw error;
    }
  } else if (!Array.isArray(existingData.slugs) || !existingData.slugs.length) {
    slugs = await getSlugsForPage(env, access.pageId);
  }

  const nextPublicLinks = linksProvided ? publicLinks ?? [] : existingData.links ?? [];
  const nextPrivateLinks = providedPrivate.provided
    ? providedPrivate.privateLinks ?? []
    : linksProvided && privateLinks !== undefined
    ? privateLinks ?? []
    : existingData.privateLinks ?? [];

  const nextPage = {
    profile: profile ?? existingData.profile ?? {},
    links: nextPublicLinks,
    privateLinks: nextPrivateLinks,
    contactSchema:
      contactProvided || schema !== undefined
        ? schema ?? []
        : existingData.contactSchema ?? [],
    contactSettings: contactSettings ?? existingData.contactSettings ?? { enabled: false },
    accessControl: accessControl ?? existingData.accessControl ?? { enabled: false },
    slugs: slugs ?? existingData.slugs ?? [],
    plan: nextPlanId ?? existingData.plan ?? "free",
    theme:
      typeof theme === "string"
        ? theme
        : typeof existingData.theme === "string"
        ? existingData.theme
        : "classic",
  };

  const effectivePlan = typeof nextPage.plan === "string" ? nextPage.plan : "free";
  if (contactProvided || schema !== undefined) {
    try {
      await enforceContactFieldLimit(env, effectivePlan, nextPage.contactSchema?.length ?? 0);
    } catch (error) {
      if (error instanceof PlanLimitError) {
        return errorResponseWithCode(error.message, "PLAN_LIMIT_EXCEEDED", error.status, headers);
      }
      throw error;
    }
  }

  if (hasPrivateLinks([...nextPage.links, ...(nextPage.privateLinks ?? [])])) {
    try {
      await enforcePlanLimit(env, effectivePlan, "create_private_link");
      if (providedPrivate.provided || linksProvided) {
        await enforcePrivateLinkLimit(env, effectivePlan, nextPage.privateLinks?.length ?? 0);
      }
    } catch (error) {
      if (error instanceof PlanLimitError) {
        return errorResponseWithCode(error.message, "PLAN_LIMIT_EXCEEDED", error.status, headers);
      }
      throw error;
    }
  }

  await env.PAGE_KV.put(`page:${access.pageId}`, JSON.stringify(nextPage));

  await env.DB.prepare(
    "INSERT OR REPLACE INTO page_meta (page_id, name, photo_url, description, links, plan_id) VALUES (?, ?, ?, ?, ?, ?)"
  )
    .bind(
      access.pageId,
      (nextPage.profile as any)?.name ?? null,
      (nextPage.profile as any)?.photoUrl ?? null,
      (nextPage.profile as any)?.description ?? null,
      JSON.stringify(nextPage.links),
      typeof nextPage.plan === "string" ? nextPage.plan : "free"
    )
    .run();

  if (slugs) {
    await replaceSlugMap(env, access.pageId, slugs);
  }

  await recordAuditEvent(env, {
    pageId: access.pageId,
    actorUserId: access.userId,
    action: "page.updated",
  });

  return jsonResponse({ success: true, pageId: access.pageId }, 200, headers);
}

export async function deleteUserPage(
  req: Request,
  env: any,
  headers: HeadersInit,
  pageId: string
) {
  const access = await requireUserPageAccess(req, env, headers, pageId);
  if ("error" in access) return access.error;

  if (access.role !== "owner") {
    return errorResponseWithCode("페이지 삭제 권한이 없습니다", "FORBIDDEN", 403, headers);
  }

  const existing = await env.PAGE_KV.get(`page:${access.pageId}`);
  if (!existing) {
    return errorResponse("Page not found", 404, headers);
  }

  await env.PAGE_KV.delete(`page:${access.pageId}`);
  await env.DB.prepare("DELETE FROM page_admins WHERE page_id = ?")
    .bind(access.pageId)
    .run();
  await env.DB.prepare("DELETE FROM page_meta WHERE page_id = ?")
    .bind(access.pageId)
    .run();
  await env.DB.prepare("DELETE FROM slug_map WHERE page_id = ?")
    .bind(access.pageId)
    .run();

  await recordAuditEvent(env, {
    pageId: access.pageId,
    actorUserId: access.userId,
    action: "page.deleted",
  });

  return jsonResponse({ success: true, message: "Page deleted" }, 200, headers);
}

export async function listUserPageMembers(
  req: Request,
  env: any,
  headers: HeadersInit,
  pageId: string
) {
  const access = await requireUserPageAccess(req, env, headers, pageId);
  if ("error" in access) return access.error;

  const result = await listMembers(env, access.pageId, access.userId);
  if ("error" in result) {
    const code = result.status === 404 ? "NOT_FOUND" : "FORBIDDEN";
    return errorResponseWithCode(result.error, code, result.status, headers);
  }

  return jsonResponse(result, 200, headers);
}

export async function createUserPageInvite(
  req: Request,
  env: any,
  headers: HeadersInit,
  pageId: string
) {
  const access = await requireUserPageAccess(req, env, headers, pageId);
  if ("error" in access) return access.error;

  return createInvite(req, env, headers, access.pageId, access.userId);
}

export async function listUserPageInvites(
  req: Request,
  env: any,
  headers: HeadersInit,
  pageId: string
) {
  const access = await requireUserPageAccess(req, env, headers, pageId);
  if ("error" in access) return access.error;

  const result = await listInvites(env, access.pageId, access.userId);
  if ("error" in result) {
    const code = result.status === 404 ? "NOT_FOUND" : "FORBIDDEN";
    return errorResponseWithCode(result.error, code, result.status, headers);
  }

  return jsonResponse(result, 200, headers);
}

export async function revokeUserPageInvite(
  req: Request,
  env: any,
  headers: HeadersInit,
  pageId: string,
  token: string
) {
  const access = await requireUserPageAccess(req, env, headers, pageId);
  if ("error" in access) return access.error;

  const result = await revokeInvite(env, access.pageId, token, access.userId);
  if ("error" in result) {
    const code = result.status === 404 ? "NOT_FOUND" : "FORBIDDEN";
    return errorResponseWithCode(result.error, code, result.status, headers);
  }

  return jsonResponse(result, 200, headers);
}

export async function acceptUserInvite(
  req: Request,
  env: any,
  headers: HeadersInit,
  token: string
) {
  const session = await requireUserSession(req, env, headers);
  if ("error" in session) return session.error;

  const result = await acceptInvite(env, token, session.userId);
  if ("error" in result) {
    const code = result.status === 404 ? "NOT_FOUND" : "FORBIDDEN";
    return errorResponseWithCode(result.error, code, result.status, headers);
  }

  return jsonResponse(result, 200, headers);
}

export async function removeUserPageMember(
  req: Request,
  env: any,
  headers: HeadersInit,
  pageId: string,
  memberUserId: string
) {
  const access = await requireUserPageAccess(req, env, headers, pageId);
  if ("error" in access) return access.error;

  const result = await removeMember(env, access.pageId, memberUserId, access.userId);
  if ("error" in result) {
    const code = result.status === 404 ? "NOT_FOUND" : "FORBIDDEN";
    return errorResponseWithCode(result.error, code, result.status, headers);
  }

  return jsonResponse(result, 200, headers);
}

export async function listUserPageContactSubmissions(
  req: Request,
  env: any,
  headers: HeadersInit,
  pageId: string
) {
  const access = await requireUserPageAccess(req, env, headers, pageId);
  if ("error" in access) return access.error;

  const submissions = await fetchSubmissions(env, access.pageId, 50);
  return jsonResponse({ submissions }, 200, headers);
}

export async function deleteUserPageContactSubmissions(
  req: Request,
  env: any,
  headers: HeadersInit,
  pageId: string
) {
  const access = await requireUserPageAccess(req, env, headers, pageId);
  if ("error" in access) return access.error;

  const url = new URL(req.url);
  const beforeDays = Number(url.searchParams.get("beforeDays"));
  const effectiveBeforeDays = Number.isFinite(beforeDays) && beforeDays > 0 ? beforeDays : undefined;
  const { removed, remaining } = await clearContactSubmissionsData(
    env,
    access.pageId,
    effectiveBeforeDays
  );
  return jsonResponse({ success: true, deleted: removed, remaining }, 200, headers);
}

export async function exportUserPageContactSubmissions(
  req: Request,
  env: any,
  headers: HeadersInit,
  pageId: string
) {
  const access = await requireUserPageAccess(req, env, headers, pageId);
  if ("error" in access) return access.error;

  try {
    const planId = (await getPagePlanId(env, access.pageId)) ?? "free";
    await enforcePlanLimit(env, planId, "export_csv");
  } catch (error) {
    if (error instanceof PlanLimitError) {
      return errorResponseWithCode(error.message, "PLAN_LIMIT_EXCEEDED", error.status, headers);
    }
    throw error;
  }

  const submissions = await fetchSubmissions(env, access.pageId, 200);
  const header = ["id", "pageId", "submittedAt", "ip", "userAgent", "answers"].join(",");
  const rows = submissions.map((s) => {
    const answers = s.answers.map((a) => `${a.label}:${a.value}`).join(" | ");
    return [s.id, s.pageId, s.submittedAt, s.ip ?? "", s.userAgent ?? "", answers]
      .map((value) => `"${(value ?? "").toString().replace(/"/g, '""')}"`)
      .join(",");
  });

  const csv = [header, ...rows].join("\n");
  return new Response(csv, {
    status: 200,
    headers: {
      ...headers,
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="contact-submissions-${access.pageId}.csv"`,
    },
  });
}

export async function getUserPageStats(
  req: Request,
  env: any,
  headers: HeadersInit,
  pageId: string
) {
  const access = await requireUserPageAccess(req, env, headers, pageId);
  if ("error" in access) return access.error;

  try {
    const planId = (await getPagePlanId(env, access.pageId)) ?? "free";
    await enforcePlanLimit(env, planId, "view_stats");
  } catch (error) {
    if (error instanceof PlanLimitError) {
      return errorResponseWithCode(error.message, "PLAN_LIMIT_EXCEEDED", error.status, headers);
    }
    throw error;
  }

  const stats = await getPageStats(env, access.pageId);
  if (!stats) {
    return errorResponse("Stats not found", 404, headers);
  }

  return jsonResponse({ pageId: access.pageId, ...stats }, 200, headers);
}

export async function getUserPagePlanStatus(
  req: Request,
  env: any,
  headers: HeadersInit,
  pageId: string
) {
  const access = await requireUserPageAccess(req, env, headers, pageId);
  if ("error" in access) return access.error;

  const planId = (await getPagePlanId(env, access.pageId)) ?? "free";
  const limits = await getPlanLimits(env, planId);
  const kvRaw = await env.PAGE_KV.get(`page:${access.pageId}`);
  let parsed: any = {};
  if (kvRaw) {
    try {
      parsed = JSON.parse(kvRaw);
    } catch (error) {
      parsed = {};
    }
  }

  const [activePrivateLinks, contactSubmissions, ownedPages] = await Promise.all([
    countActivePrivateLinks(env, access.pageId),
    countSubmissions(env, access.pageId),
    countOwnedPages(env, access.userId),
  ]);

  const contactFieldCount = Array.isArray(parsed?.contactSchema) ? parsed.contactSchema.length : 0;

  const overages = {
    pages: ownedPages > limits.max_pages,
    privateLinks: activePrivateLinks > limits.max_private_links,
    contactFields: contactFieldCount > limits.max_contact_fields,
  };

  return jsonResponse(
    {
      pageId: access.pageId,
      planId,
      limits,
      usage: {
        pages: ownedPages,
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

export async function createUserPrivateLink(
  req: Request,
  env: any,
  headers: HeadersInit,
  pageId: string
) {
  const access = await requireUserPageAccess(req, env, headers, pageId);
  if ("error" in access) return access.error;

  if (access.role === "viewer") {
    return errorResponseWithCode("프라이빗 링크 생성 권한이 없습니다", "FORBIDDEN", 403, headers);
  }

  const plan = await getPagePlan(env, access.pageId);
  try {
    await enforcePlanLimit(env, plan, "create_private_link");
    const activeCount = await countActivePrivateLinks(env, access.pageId);
    await enforcePrivateLinkLimit(env, plan, activeCount);
  } catch (error) {
    if (error instanceof PlanLimitError) {
      return errorResponseWithCode(error.message, "PLAN_LIMIT_EXCEEDED", error.status, headers);
    }
    throw error;
  }

  const response = await createPrivateLink(req, env, headers, access.pageId);
  await recordAuditEvent(env, {
    pageId: access.pageId,
    actorUserId: access.userId,
    action: "private_link.created",
  });
  return response;
}

export async function listUserPrivateLinks(
  req: Request,
  env: any,
  headers: HeadersInit,
  pageId: string
) {
  const access = await requireUserPageAccess(req, env, headers, pageId);
  if ("error" in access) return access.error;

  return listPrivateLinks(req, env, headers, access.pageId);
}

export async function deleteUserPrivateLink(
  req: Request,
  env: any,
  headers: HeadersInit,
  pageId: string,
  token: string
) {
  const access = await requireUserPageAccess(req, env, headers, pageId);
  if ("error" in access) return access.error;

  if (access.role === "viewer") {
    return errorResponseWithCode("프라이빗 링크 삭제 권한이 없습니다", "FORBIDDEN", 403, headers);
  }

  const response = await revokePrivateLink(req, env, headers, access.pageId, token);
  await recordAuditEvent(env, {
    pageId: access.pageId,
    actorUserId: access.userId,
    action: "private_link.revoked",
    metadata: { token },
  });
  return response;
}

export async function rotateUserAccessCode(
  req: Request,
  env: any,
  headers: HeadersInit,
  pageId: string
) {
  const access = await requireUserPageAccess(req, env, headers, pageId);
  if ("error" in access) return access.error;

  if (access.role === "viewer") {
    return errorResponseWithCode("접근 코드 변경 권한이 없습니다", "FORBIDDEN", 403, headers);
  }

  const existingRaw = await env.PAGE_KV.get(`page:${access.pageId}`);
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

  await env.PAGE_KV.put(`page:${access.pageId}`, JSON.stringify(updated));
  await recordAuditEvent(env, {
    pageId: access.pageId,
    actorUserId: access.userId,
    action: "access_code.rotated",
  });
  return jsonResponse({ pageId: access.pageId, accessControl: updated.accessControl }, 200, headers);
}

export async function disableUserAccessCode(
  req: Request,
  env: any,
  headers: HeadersInit,
  pageId: string
) {
  const access = await requireUserPageAccess(req, env, headers, pageId);
  if ("error" in access) return access.error;

  if (access.role === "viewer") {
    return errorResponseWithCode("접근 코드 변경 권한이 없습니다", "FORBIDDEN", 403, headers);
  }

  const existingRaw = await env.PAGE_KV.get(`page:${access.pageId}`);
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

  await env.PAGE_KV.put(`page:${access.pageId}`, JSON.stringify(updated));
  await recordAuditEvent(env, {
    pageId: access.pageId,
    actorUserId: access.userId,
    action: "access_code.disabled",
  });
  return jsonResponse({ pageId: access.pageId, accessControl: updated.accessControl }, 200, headers);
}

export async function listUserPages(req: Request, env: any, headers: HeadersInit) {
  const session = await requireUserSession(req, env, headers);
  if ("error" in session) return session.error;

  const rows = await env.DB.prepare(
    "SELECT pm.page_id, pm.name, pm.photo_url, pm.description, pm.links, pm.plan_id, pmem.role AS member_role " +
      "FROM page_admins pa " +
      "JOIN page_meta pm ON pa.page_id = pm.page_id " +
      "LEFT JOIN page_members pmem ON pmem.page_id = pm.page_id AND pmem.user_id = pa.user_id " +
      "WHERE pa.user_id = ? ORDER BY pm.created_at DESC"
  )
    .bind(session.userId)
    .all<{
      page_id: string;
      name: string | null;
      photo_url: string | null;
      description: string | null;
      links: string | null;
      plan_id: string | null;
      member_role: string | null;
    }>();

  const items = await Promise.all(
    (rows?.results ?? []).map(async (row) => {
      const kvRaw = await env.PAGE_KV.get(`page:${row.page_id}`);
      let plan: string | null = row.plan_id ?? null;
      if (kvRaw) {
        try {
          plan = JSON.parse(kvRaw)?.plan ?? plan;
        } catch (error) {
          plan = plan ?? null;
        }
      }

      const [slugs, submissionsCount, stats, planLimits] = await Promise.all([
        getSlugsForPage(env, row.page_id),
        countSubmissions(env, row.page_id),
        getPageStats(env, row.page_id),
        getPlanLimits(env, plan ?? "free"),
      ]);

      const safeStats =
        planLimits.stats_retention_days && planLimits.stats_retention_days > 0
          ? stats ?? { views: 0, admin_views: 0 }
          : null;

      return {
        pageId: row.page_id,
        profile: {
          name: row.name,
          photoUrl: row.photo_url,
          description: row.description,
        },
        links: safeParseLinks(row.links),
        plan,
        slugs,
        contactSubmissions: submissionsCount,
        stats: safeStats,
        role: row.member_role ?? "owner",
      };
    })
  );

  return jsonResponse({ items }, 200, headers);
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
