import { createSessionToken } from "./auth";
import { errorResponse, jsonResponse, parseJsonBody } from "./utils";

type CreatePageBody = {
  pageId: string;
  profile?: unknown;
  adminPassword: string;
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
    "SELECT username, password_hash FROM super_admin WHERE username = ? LIMIT 1"
  )
    .bind(username)
    .first<{ username: string; password_hash: string }>();

  if (!row || row.password_hash !== body.password) {
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

  const slugs = normalizeSlugs(body.slugs, body.pageId);

  const conflictingSlug = await findConflictingSlug(env, slugs, body.pageId);
  if (conflictingSlug) {
    return errorResponse(
      `이미 다른 페이지에 사용 중인 슬러그입니다: ${conflictingSlug}`,
      409,
      headers
    );
  }

  const pageData = {
    profile: body.profile ?? {},
    links: Array.isArray((body as any).links) ? (body as any).links : [],
    plan: body.plan ?? null,
  };
  await env.PAGE_KV.put(`page:${body.pageId}`, JSON.stringify(pageData));
  await env.PAGE_KV.put(`page_auth:${body.pageId}`, body.adminPassword);

  await env.DB.prepare(
    "INSERT OR REPLACE INTO page_auth (page_id, password_hash) VALUES (?, ?)"
  )
    .bind(body.pageId, body.adminPassword)
    .run();

  await env.DB.prepare(
    "INSERT OR REPLACE INTO page_meta (page_id, name, photo_url, description, links) VALUES (?, ?, ?, ?, ?)"
  )
    .bind(
      body.pageId,
      (body.profile as any)?.name ?? null,
      (body.profile as any)?.photoUrl ?? null,
      (body.profile as any)?.description ?? null,
      JSON.stringify((body as any).links ?? [])
    )
    .run();

  await replaceSlugMap(env, body.pageId, slugs);

  return jsonResponse({ success: true, message: "Page created" }, 201, headers);
}

export async function listPages(env: any, headers: HeadersInit): Promise<Response> {
  const dbRows = await env.DB.prepare(
    "SELECT page_id, name, photo_url, description, links FROM page_meta"
  ).all<{ page_id: string; name: string | null; photo_url: string | null; description: string | null; links: string | null }>();

  const mapped = await Promise.all(
    (dbRows?.results ?? []).map(async (row) => {
      const kvValue = await env.PAGE_KV.get(`page:${row.page_id}`);
      let plan: string | null = null;
      if (kvValue) {
        try {
          plan = JSON.parse(kvValue).plan ?? null;
        } catch (error) {
          plan = null;
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

  return jsonResponse(mapped, 200, headers);
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

  await env.DB.prepare("DELETE FROM page_auth WHERE page_id = ?")
    .bind(pageId)
    .run();

  await env.DB.prepare("DELETE FROM page_meta WHERE page_id = ?")
    .bind(pageId)
    .run();

  await env.DB.prepare("DELETE FROM slug_map WHERE page_id = ?")
    .bind(pageId)
    .run();

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

  let slugs: string[] | null = null;
  if (body.slugs !== undefined) {
    slugs = normalizeSlugs(body.slugs, pageId);
    const conflict = await findConflictingSlug(env, slugs, pageId);
    if (conflict) {
      return errorResponse(
        `이미 다른 페이지에 사용 중인 슬러그입니다: ${conflict}`,
        409,
        headers
      );
    }
  } else {
    const hasExistingSlugMap = await hasSlugMap(env, pageId);
    if (!hasExistingSlugMap) {
      slugs = await getSlugsForPage(env, pageId);
    }
  }

  const updatedPage = {
    profile: body.profile ?? {},
    links: Array.isArray((body as any).links) ? (body as any).links : [],
    plan: body.plan ?? null,
  };
  await env.PAGE_KV.put(`page:${pageId}`, JSON.stringify(updatedPage));

  if (body.adminPassword) {
    await env.PAGE_KV.put(`page_auth:${pageId}`, body.adminPassword);
    await env.DB.prepare(
      "INSERT OR REPLACE INTO page_auth (page_id, password_hash) VALUES (?, ?)"
    )
      .bind(pageId, body.adminPassword)
      .run();
  }

  await env.DB.prepare(
    "INSERT OR REPLACE INTO page_meta (page_id, name, photo_url, description, links) VALUES (?, ?, ?, ?, ?)"
  )
    .bind(
      pageId,
      (updatedPage.profile as any)?.name ?? null,
      (updatedPage.profile as any)?.photoUrl ?? null,
      (updatedPage.profile as any)?.description ?? null,
      JSON.stringify((body as any).links ?? [])
    )
    .run();

  if (slugs) {
    await replaceSlugMap(env, pageId, slugs);
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

function normalizeSlugs(raw: unknown, pageId: string) {
  const incoming = Array.isArray(raw) ? raw : [];
  const normalized = incoming
    .filter((value): value is string => typeof value === "string" && !!value.trim())
    .map((value) => value.trim());

  if (!normalized.includes(pageId)) {
    normalized.unshift(pageId);
  }

  return Array.from(new Set(normalized));
}

async function findConflictingSlug(env: any, slugs: string[], ownerPageId: string) {
  for (const slug of slugs) {
    const row = await env.DB.prepare(
      "SELECT page_id FROM slug_map WHERE display_name = ? LIMIT 1"
    )
      .bind(slug)
      .first<{ page_id: string }>();

    if (row && row.page_id !== ownerPageId) {
      return slug;
    }
  }

  return null;
}

async function replaceSlugMap(env: any, pageId: string, slugs: string[]) {
  await env.DB.prepare("DELETE FROM slug_map WHERE page_id = ?")
    .bind(pageId)
    .run();

  for (const slug of slugs) {
    await env.DB.prepare(
      "INSERT OR REPLACE INTO slug_map (display_name, page_id) VALUES (?, ?)"
    )
      .bind(slug, pageId)
      .run();
  }
}

async function getSlugsForPage(env: any, pageId: string) {
  const rows = await env.DB.prepare(
    "SELECT display_name FROM slug_map WHERE page_id = ?"
  )
    .bind(pageId)
    .all<{ display_name: string }>();

  const slugs = (rows?.results ?? []).map((row) => row.display_name).filter(Boolean);
  return slugs.length ? slugs : [pageId];
}

async function hasSlugMap(env: any, pageId: string) {
  const row = await env.DB.prepare(
    "SELECT display_name FROM slug_map WHERE page_id = ? LIMIT 1"
  )
    .bind(pageId)
    .first();

  return !!row;
}
