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

type LoginBody = {
  password?: string;
};

type SavePageBody = {
  profile?: unknown;
  links?: unknown;
  plan?: unknown;
  privateLinks?: unknown;
  contactSchema?: unknown;
  slugs?: unknown;
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

  const canonicalPageId = await resolvePageId(env, pageId);

  const dbRow = await env.DB.prepare(
    "SELECT password_hash FROM page_auth WHERE page_id = ? LIMIT 1"
  )
    .bind(canonicalPageId)
    .first<{ password_hash: string }>();

  const storedPassword =
    dbRow?.password_hash ?? (await env.PAGE_KV.get(`page_auth:${canonicalPageId}`));
  if (!storedPassword || storedPassword !== body.password) {
    return errorResponse("인증에 실패했습니다", 401, headers);
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
  let existingData: any = {};
  if (existingRaw) {
    try {
      existingData = JSON.parse(existingRaw);
    } catch (error) {
      existingData = {};
    }
  }

  const incomingLinks = Array.isArray(body.links) ? body.links : [];
  const providedPrivate = Array.isArray((body as any).privateLinks)
    ? (body as any).privateLinks
    : [];
  const privateLinks = providedPrivate.length
    ? providedPrivate
    : incomingLinks.filter((link: any) => !!link?.isPrivate);
  const publicLinks = incomingLinks.filter((link: any) => !link?.isPrivate);

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
    profile: body.profile ?? existingData.profile ?? {},
    links: publicLinks,
    privateLinks,
    contactSchema: Array.isArray((body as any).contactSchema)
      ? (body as any).contactSchema
      : existingData.contactSchema ?? [],
    slugs: normalizedSlugs,
    plan: body.plan ?? existingData.plan ?? null,
  };
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

