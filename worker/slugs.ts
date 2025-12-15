export function normalizeSlug(slug: string): string {
  return slug.trim().toLowerCase();
}

export function collectNormalizedSlugs(
  pageId: string,
  extras: unknown
): string[] {
  const set = new Set<string>();
  if (pageId) {
    set.add(normalizeSlug(pageId));
  }
  if (Array.isArray(extras)) {
    for (const value of extras) {
      if (typeof value === "string" && value.trim()) {
        set.add(normalizeSlug(value));
      }
    }
  }
  return Array.from(set);
}

export async function fetchSlugsForPage(env: any, pageId: string) {
  const rows = await env.DB.prepare(
    "SELECT display_name FROM slug_map WHERE page_id = ?"
  )
    .bind(pageId)
    .all<{ display_name: string }>();

  return rows.results?.map((row) => row.display_name) ?? [];
}

export async function findSlugConflict(
  env: any,
  slugs: string[],
  pageId: string
): Promise<string | null> {
  for (const slug of slugs) {
    const row = await env.DB.prepare(
      "SELECT page_id FROM slug_map WHERE display_name = ? LIMIT 1"
    )
      .bind(slug)
      .first<{ page_id: string }>();
    if (row && row.page_id !== pageId) {
      return slug;
    }
  }
  return null;
}

export async function replaceSlugs(
  env: any,
  pageId: string,
  slugs: string[]
) {
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

export async function resolvePageIdFromSlug(
  env: any,
  slug: string
): Promise<string | null> {
  const normalized = normalizeSlug(slug);
  const row = await env.DB.prepare(
    "SELECT page_id FROM slug_map WHERE display_name = ? LIMIT 1"
  )
    .bind(normalized)
    .first<{ page_id: string }>();

  return row?.page_id ?? null;
}
