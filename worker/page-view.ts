import { getBearerToken, verifySessionToken } from "./auth";
import { getSlugsForPage } from "./slug-map";
import { resolvePageId } from "./slug";
import { recordPageView } from "./stats";
import { errorResponse, jsonResponse } from "./utils";

type PageMetaRow = {
  page_id: string;
  name: string | null;
  photo_url: string | null;
  description: string | null;
  links: string | null;
};

export async function getPage(
  req: Request,
  env: any,
  pageId: string,
  headers: HeadersInit
): Promise<Response> {
  const resolvedPageId = await resolvePageId(env, pageId);
  const token = getBearerToken(req);
  const isPageAdmin = await verifySessionToken(env, "page", token, resolvedPageId);
  const isSuperAdmin = await verifySessionToken(env, "super", token);
  const includePrivate = isPageAdmin || isSuperAdmin;
  await recordPageView(env, resolvedPageId, includePrivate);
  const kvRaw = await env.PAGE_KV.get(`page:${resolvedPageId}`);
  let kvParsed: any = null;
  if (kvRaw) {
    try {
      kvParsed = JSON.parse(kvRaw);
    } catch (error) {
      kvParsed = null;
    }
  }

  const dbRow = await env.DB.prepare(
    "SELECT page_id, name, photo_url, description, links FROM page_meta WHERE page_id = ? LIMIT 1"
  )
    .bind(resolvedPageId)
    .first<PageMetaRow>();

  if (dbRow) {
    const contactSettings = kvParsed?.contactSettings ?? {};
    const safeContactSettings = includePrivate
      ? {
          enabled: contactSettings?.enabled === true,
          ...(contactSettings?.webhookUrl ? { webhookUrl: contactSettings.webhookUrl } : {}),
        }
      : { enabled: contactSettings?.enabled === true };

    return jsonResponse(
      {
        profile: {
          name: dbRow.name,
          photoUrl: dbRow.photo_url,
          description: dbRow.description,
        },
        links: safeParseLinks(dbRow.links),
        plan: kvParsed?.plan ?? null,
        contactSchema: kvParsed?.contactSchema ?? [],
        contactSettings: safeContactSettings,
        theme: typeof kvParsed?.theme === "string" ? kvParsed.theme : "classic",
        privateLinks: includePrivate ? kvParsed?.privateLinks ?? [] : undefined,
        slugs: includePrivate
          ? kvParsed?.slugs ?? (await getSlugsForPage(env, resolvedPageId))
          : undefined,
      },
      200,
      headers
    );
  }

  if (!kvRaw) {
    return errorResponse("Page not found", 404, headers);
  }

  try {
    const parsed = JSON.parse(kvRaw);
    const publicLinks = Array.isArray(parsed.links)
      ? parsed.links
      : [];

    const contactSettings = parsed?.contactSettings ?? {};
    const safeContactSettings = includePrivate
      ? {
          enabled: contactSettings?.enabled === true,
          ...(contactSettings?.webhookUrl ? { webhookUrl: contactSettings.webhookUrl } : {}),
        }
      : { enabled: contactSettings?.enabled === true };

    return jsonResponse(
      {
        ...parsed,
        links: publicLinks,
        privateLinks: includePrivate ? parsed.privateLinks ?? [] : undefined,
        contactSchema: parsed.contactSchema ?? [],
        contactSettings: safeContactSettings,
        theme: typeof parsed.theme === "string" ? parsed.theme : "classic",
        slugs: includePrivate
          ? parsed.slugs ?? (await getSlugsForPage(env, resolvedPageId))
          : undefined,
      },
      200,
      headers
    );
  } catch (err) {
    return errorResponse("Page data is corrupted", 500, headers);
  }
}

function safeParseLinks(raw: string | null) {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch (err) {
    return [];
  }
}
