import { getBearerToken, getSessionSubject } from "./auth";
import { findConflictingSlug, getSlugsForPage, normalizeSlugs, replaceSlugMap } from "./slug-map";
import { enforcePlanLimit, hasPrivateLinks, PlanLimitError } from "./plan-limits";
import { errorResponse, jsonResponse, parseJsonBody } from "./utils";

type CreatePageBody = {
  pageId?: string;
  profile?: unknown;
  links?: unknown;
  privateLinks?: unknown;
  contactSchema?: unknown;
  contactSettings?: unknown;
  slugs?: unknown;
  theme?: unknown;
};

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

async function requireUserSession(req: Request, env: any, headers: HeadersInit) {
  const token = getBearerToken(req);
  const userId = await getSessionSubject(env, "user", token);
  if (!userId) {
    return { error: errorResponse("로그인이 필요합니다", 401, headers) } as const;
  }
  return { userId } as const;
}

export async function createUserPage(req: Request, env: any, headers: HeadersInit) {
  const session = await requireUserSession(req, env, headers);
  if ("error" in session) return session.error;

  const body = await parseJsonBody<CreatePageBody>(req);
  if (!body || typeof body.pageId !== "string" || !body.pageId.trim()) {
    return errorResponse("pageId가 필요합니다", 400, headers);
  }

  const pageId = body.pageId.trim();
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

  const { error: contactSettingsError, settings: contactSettings } =
    validateContactSettings(body.contactSettings);
  if (contactSettingsError) {
    return errorResponse(contactSettingsError, 400, headers);
  }

  const { error: themeError, theme } = validateTheme(body.theme);
  if (themeError) {
    return errorResponse(themeError, 400, headers);
  }

  const plan = "free";
  try {
    await enforcePlanLimit(env, plan, "create_page");
  } catch (error) {
    if (error instanceof PlanLimitError) {
      return errorResponse(error.message, error.status, headers);
    }
    throw error;
  }

  const slugs = normalizeSlugs(body.slugs, pageId);
  if (body.slugs !== undefined) {
    try {
      await enforcePlanLimit(env, plan, "update_slug");
    } catch (error) {
      if (error instanceof PlanLimitError) {
        return errorResponse(error.message, error.status, headers);
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
    } catch (error) {
      if (error instanceof PlanLimitError) {
        return errorResponse(error.message, error.status, headers);
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
    slugs,
    plan,
    theme: typeof theme === "string" ? theme : "classic",
  };

  await env.PAGE_KV.put(`page:${pageId}`, JSON.stringify(pageData));

  await env.DB.prepare(
    "INSERT OR REPLACE INTO page_meta (page_id, name, photo_url, description, links) VALUES (?, ?, ?, ?, ?)"
  )
    .bind(
      pageId,
      (pageData.profile as any)?.name ?? null,
      (pageData.profile as any)?.photoUrl ?? null,
      (pageData.profile as any)?.description ?? null,
      JSON.stringify(pageData.links)
    )
    .run();

  await env.DB.prepare(
    "INSERT OR IGNORE INTO page_admins (page_id, user_id) VALUES (?, ?)"
  )
    .bind(pageId, session.userId)
    .run();

  await replaceSlugMap(env, pageId, slugs);

  return jsonResponse({ success: true, pageId }, 201, headers);
}

export async function listUserPages(req: Request, env: any, headers: HeadersInit) {
  const session = await requireUserSession(req, env, headers);
  if ("error" in session) return session.error;

  const rows = await env.DB.prepare(
    "SELECT pm.page_id, pm.name, pm.photo_url, pm.description, pm.links FROM page_admins pa JOIN page_meta pm ON pa.page_id = pm.page_id WHERE pa.user_id = ? ORDER BY pm.created_at DESC"
  )
    .bind(session.userId)
    .all<{
      page_id: string;
      name: string | null;
      photo_url: string | null;
      description: string | null;
      links: string | null;
    }>();

  const items = await Promise.all(
    (rows?.results ?? []).map(async (row) => {
      const kvRaw = await env.PAGE_KV.get(`page:${row.page_id}`);
      let plan: string | null = null;
      if (kvRaw) {
        try {
          plan = JSON.parse(kvRaw)?.plan ?? null;
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
