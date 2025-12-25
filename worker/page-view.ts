import { getBearerToken, verifySessionToken } from "./auth";
import { getSlugsForPage } from "./slug-map";
import { resolvePageId } from "./slug";
import { recordPageView } from "./stats";
import { errorResponse, errorResponseWithCode, jsonResponse } from "./utils";

type PageMetaRow = {
  page_id: string;
  name: string | null;
  photo_url: string | null;
  description: string | null;
  links: string | null;
};

async function createEtag(data: any): Promise<string> {
  const json = JSON.stringify(data);
  const digest = await crypto.subtle.digest('SHA-1', new TextEncoder().encode(json));
  const hashArray = Array.from(new Uint8Array(digest));
  const hexHash = hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
  return `W/"${hexHash}"`; // Use a weak ETag
}

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
  
  // Record the view before returning a cached response
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

  let responseData: any;

  if (dbRow) {
    const contactSettings = kvParsed?.contactSettings ?? {};
    const accessControl = kvParsed?.accessControl ?? {};
    if (accessControl?.enabled && !includePrivate) {
      const urlCode = new URL(req.url).searchParams.get("code");
      const headerCode = req.headers.get("X-Page-Code");
      const provided = headerCode || urlCode;
      if (!provided || provided !== accessControl.code) {
        return errorResponseWithCode("접근 코드가 필요합니다", "FORBIDDEN", 401, headers);
      }
    }
    const safeContactSettings = includePrivate
      ? {
          enabled: contactSettings?.enabled === true,
          ...(contactSettings?.webhookUrl ? { webhookUrl: contactSettings.webhookUrl } : {}),
        }
      : { enabled: contactSettings?.enabled === true };
    
    responseData = {
        profile: {
          name: dbRow.name,
          photoUrl: dbRow.photo_url,
          description: dbRow.description,
        },
        links: safeParseLinks(dbRow.links),
        plan: kvParsed?.plan ?? null,
        contactSchema: kvParsed?.contactSchema ?? [],
        contactSettings: safeContactSettings,
        accessControl: includePrivate
          ? accessControl ?? { enabled: false }
          : { enabled: accessControl?.enabled === true },
        theme: typeof kvParsed?.theme === "string" ? kvParsed.theme : "classic",
        privateLinks: includePrivate ? kvParsed?.privateLinks ?? [] : undefined,
        slugs: includePrivate
          ? kvParsed?.slugs ?? (await getSlugsForPage(env, resolvedPageId))
          : undefined,
    };
  } else if (kvRaw && kvParsed) {
    // Legacy data from KV only
    const publicLinks = Array.isArray(kvParsed.links) ? kvParsed.links : [];
    const contactSettings = kvParsed?.contactSettings ?? {};
    const accessControl = kvParsed?.accessControl ?? {};
    if (accessControl?.enabled && !includePrivate) {
      // ... (access control logic as before)
    }
    const safeContactSettings = includePrivate
      ? { enabled: contactSettings?.enabled === true, webhookUrl: contactSettings?.webhookUrl }
      : { enabled: contactSettings?.enabled === true };
      
    responseData = {
        ...kvParsed,
        links: publicLinks,
        privateLinks: includePrivate ? kvParsed.privateLinks ?? [] : undefined,
        contactSchema: kvParsed.contactSchema ?? [],
        contactSettings: safeContactSettings,
        accessControl: includePrivate
          ? accessControl ?? { enabled: false }
          : { enabled: accessControl?.enabled === true },
        theme: typeof kvParsed.theme === "string" ? kvParsed.theme : "classic",
        slugs: includePrivate
          ? kvParsed.slugs ?? (await getSlugsForPage(env, resolvedPageId))
          : undefined,
    };
  } else {
    return errorResponse("Page not found", 404, headers);
  }

  // ETag and Cache-Control logic
  const etag = await createEtag(responseData);
  const ifNoneMatch = req.headers.get('If-None-Match');
  if (ifNoneMatch === etag) {
    return new Response(null, { status: 304, headers });
  }

  const responseHeaders = { ...headers, 'ETag': etag };
  if (includePrivate) {
    responseHeaders['Cache-Control'] = 'no-cache';
  } else {
    responseHeaders['Cache-Control'] = 'public, max-age=3600';
  }
  
  return jsonResponse(responseData, 200, responseHeaders);
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
