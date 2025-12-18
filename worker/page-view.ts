import { resolvePageId } from "./slug";
import { errorResponse, jsonResponse } from "./utils";
import { consumePrivateLink } from "./private-links";
import { getPublicContactForm } from "./contact-forms";
import { recordPageView } from "./stats";

type PageMetaRow = {
  page_id: string;
  name: string | null;
  photo_url: string | null;
  description: string | null;
  links: string | null;
  plan_id: string | null;
};

export async function getPage(
  env: any,
  pageId: string,
  headers: HeadersInit,
  options: { trackView?: boolean; isPrivate?: boolean; isAdmin?: boolean } = {}
): Promise<Response> {
  const resolvedPageId = await resolvePageId(env, pageId);

  const dbRow = await env.DB.prepare(
    "SELECT page_id, name, photo_url, description, links, plan_id FROM page_meta WHERE page_id = ? LIMIT 1"
  )
    .bind(resolvedPageId)
    .first<PageMetaRow>();

  const contactForm = await getPublicContactForm(env, resolvedPageId);

  if (dbRow) {
    if (options.trackView !== false) {
      await recordPageView(env, resolvedPageId, {
        isPrivate: options.isPrivate,
        isAdmin: options.isAdmin,
      });
    }

    return jsonResponse(
      {
        profile: {
          name: dbRow.name,
          photoUrl: dbRow.photo_url,
          description: dbRow.description,
        },
        links: safeParseLinks(dbRow.links),
        plan: dbRow.plan_id,
        contactForm,
      },
      200,
      headers
    );
  }

  const kvValue = await env.PAGE_KV.get(`page:${resolvedPageId}`);
  if (!kvValue) {
    return errorResponse("Page not found", 404, headers);
  }

  try {
    const parsed = JSON.parse(kvValue);
    if (options.trackView !== false) {
      await recordPageView(env, resolvedPageId, {
        isPrivate: options.isPrivate,
        isAdmin: options.isAdmin,
      });
    }
    return jsonResponse({ ...parsed, contactForm }, 200, headers);
  } catch (err) {
    return errorResponse("Page data is corrupted", 500, headers);
  }
}

export async function getPrivatePage(
  env: any,
  token: string,
  accessCode: string | null,
  headers: HeadersInit
): Promise<Response> {
  const result = await consumePrivateLink(env, token, accessCode ?? undefined);
  if ("error" in result) {
    return errorResponse(result.error, result.status, headers);
  }

  return getPage(env, result.pageId, headers, { isPrivate: true });
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

