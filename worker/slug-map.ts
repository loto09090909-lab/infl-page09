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

    if (!normalized.includes(trimmed)) {
      normalized.push(trimmed);
    }
  }

  const baseSlug = slugify(pageId) || pageId.trim();

  if (baseSlug) {
    normalized.unshift(baseSlug);
  }

  const rawPageId = pageId.trim();
  if (rawPageId && !normalized.includes(rawPageId)) {
    normalized.push(rawPageId);
  }

  return Array.from(new Set(normalized));
}

export async function findConflictingSlug(env: any, slugs: string[], ownerPageId: string) {
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
  const existing = await env.DB.prepare(
    "SELECT display_name FROM slug_map WHERE page_id = ?"
  )
    .bind(pageId)
    .all<{ display_name: string }>();

  const existingSlugs = (existing?.results ?? [])
    .map((row) => row.display_name)
    .filter(Boolean);
  const primarySlug = slugs[0] ?? pageId;

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

  const removedSlugs = existingSlugs.filter(
    (slug) => !slugs.includes(slug) && slug !== primarySlug
  );

  for (const oldSlug of removedSlugs) {
    await env.DB.prepare(
      "INSERT OR REPLACE INTO slug_history (old_slug, new_slug, page_id) VALUES (?, ?, ?)"
    )
      .bind(oldSlug, primarySlug, pageId)
      .run();
  }
}

export async function getSlugsForPage(env: any, pageId: string) {
  const rows = await env.DB.prepare(
    "SELECT display_name FROM slug_map WHERE page_id = ?"
  )
    .bind(pageId)
    .all<{ display_name: string }>();

  const slugs = (rows?.results ?? []).map((row) => row.display_name).filter(Boolean);
  return slugs.length ? slugs : [pageId];
}

export async function hasSlugMap(env: any, pageId: string) {
  const row = await env.DB.prepare(
    "SELECT display_name FROM slug_map WHERE page_id = ? LIMIT 1"
  )
    .bind(pageId)
    .first();

  return !!row;
}
