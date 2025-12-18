import { createSessionToken, getBearerToken, verifySessionToken } from "./auth";
import { resolvePageId } from "./slug";
import {
  findConflictingSlug,
  getSlugsForPage,
  hasSlugMap,
  normalizeSlugs,
  replaceSlugMap,
} from "./slug-map";
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
  privateLinks?: unknown;
  contactSchema?: unknown;
  slugs?: unknown;
};

const MAX_LINKS = 100;

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

  const allowedTypes = new Set(["text", "email", "tel", "url"]);

  const schema = raw
    .map((field) => {
      if (!field || typeof field !== "object") return null;
      const label = sanitizeString((field as any).label, 120);
      const type = sanitizeString((field as any).type, 30);
      const placeholder = sanitizeString((field as any).placeholder, 200);
      if (!label || !type || !allowedTypes.has(type)) return null;
      return {
        label,
        type,
        ...(placeholder ? { placeholder } : {}),
      };
    })
    .filter(Boolean);

  return { schema, provided: true };
}

function validateLinks(rawLinks: unknown) {
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
    const title = sanitizeString((rawLink as any).title, 120);
    const url = sanitizeString((rawLink as any).url, 1000);
    const iconUrl = sanitizeString((rawLink as any).iconUrl, 500);
    const platformId = sanitizeString((rawLink as any).platformId, 120);
    const handle = sanitizeString((rawLink as any).handle, 200);
    const isPrivate = (rawLink as any).isPrivate === true || (rawLink as any).private === true;

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

export async function verifyPageSession(
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

  return jsonResponse(
    {
      ok: true,
      role: superTokenValid ? "super" : "page",
      pageId: canonicalPageId,
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

  const body = await parseJsonBody<SavePageBody>(req);
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
    slugs: normalizedSlugs,
    plan:
      typeof body.plan === "string"
        ? sanitizeString(body.plan, 30)
        : existingData.plan ?? null,
  };

  const linksForPlan = [...pageData.links, ...(pageData.privateLinks ?? [])];
  if (hasPrivateLinks(linksForPlan)) {
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

  if (normalizedSlugs?.length) {
    await replaceSlugMap(env, canonicalPageId, normalizedSlugs);
  }

  return jsonResponse({ success: true, message: "Page saved" }, 200, headers);
}

