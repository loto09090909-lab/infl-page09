import { slugify } from "./slug";

export function normalizeSlugs(raw: unknown, pageId: string) {
  const incoming = Array.isArray(raw) ? raw : [];
  const normalized: string[] = [];

  for (const value of incoming) {
    if (typeof value !== "string") continue;

    const trimmed = value.trim();
    if (!trimmed) continue;

    const slugified = slugify(trimmed);
    if (slugified) {
      normalized.push(slugified);
    }
  }

  const baseSlug = slugify(pageId);
  if (baseSlug) {
    normalized.unshift(baseSlug);
  }

  const fallback = pageId.trim();
  if (fallback && slugify(fallback) !== baseSlug) {
    normalized.push(slugify(fallback));
  }

  return Array.from(new Set(normalized.filter(Boolean)));
}

export async function findConflictingSlug(
  env: any,
  slugs: string[],
  ownerPageId: string
) {
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

export async function replaceSlugMap(env: any, pageId: string, slugs: string[]) {
  await env.DB.prepare("DELETE FROM slug_map WHERE page_id = ?")
    .bind(pageId)
    .run();

  for (const slug of slugs) {
    await env.DB.prepare(
      "INSERT OR REPLACE INTO slug_map (page_id, display_name) VALUES (?, ?)"
    )
      .bind(pageId, slug)
      .run();
  }
}

export async function getSlugsForPage(env: any, pageId: string) {
  const rows = await env.DB.prepare(
    "SELECT display_name FROM slug_map WHERE page_id = ?"
  )
    .bind(pageId)
    .all<{ display_name: string }>();

  return rows?.results?.map((row) => row.display_name) ?? [];
}

export async function hasSlugMap(env: any, pageId: string) {
  const row = await env.DB.prepare(
    "SELECT 1 FROM slug_map WHERE page_id = ? LIMIT 1"
  )
    .bind(pageId)
    .first<{ "1": number }>();

  return !!row;
}
