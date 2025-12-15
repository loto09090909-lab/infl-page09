import { errorResponse, jsonResponse } from "./utils";

type PageMetaRow = {
  page_id: string;
  name: string | null;
  photo_url: string | null;
  description: string | null;
  links: string | null;
};

export async function getPage(
  env: any,
  pageId: string,
  headers: HeadersInit
): Promise<Response> {
  const resolvedPageId = await resolvePageId(env, pageId);

  const dbRow = await env.DB.prepare(
    "SELECT page_id, name, photo_url, description, links FROM page_meta WHERE page_id = ? LIMIT 1"
  )
    .bind(resolvedPageId)
    .first<PageMetaRow>();

  if (dbRow) {
    return jsonResponse(
      {
        profile: {
          name: dbRow.name,
          photoUrl: dbRow.photo_url,
          description: dbRow.description,
        },
        links: safeParseLinks(dbRow.links),
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
    return jsonResponse(parsed, 200, headers);
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

async function resolvePageId(env: any, incoming: string) {
  const row = await env.DB.prepare(
    "SELECT page_id FROM slug_map WHERE display_name = ? LIMIT 1"
  )
    .bind(incoming)
    .first<{ page_id: string }>();

  return row?.page_id ?? incoming;
}
