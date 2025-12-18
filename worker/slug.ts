export function slugify(value: string): string {
  const normalized = value.normalize("NFKD").toLowerCase();

  const separated = normalized
    .replace(/[\s\p{P}\p{S}_]+/gu, "-")
    .replace(/-+/g, "-");

  const cleaned = separated.replace(/[^a-z0-9-]/g, "");
  const collapsed = cleaned.replace(/-+/g, "-").replace(/^-+|-+$/g, "");

  if (collapsed) {
    return collapsed;
  }

  const encodedFallback = encodeURIComponent(normalized)
    .replace(/%/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "");

  return encodedFallback;
}

export type ResolvedPage = { pageId: string; redirectSlug?: string };

export async function resolvePageId(env: any, incoming: string) {
  const result = await resolvePageWithRedirect(env, incoming);
  return result.pageId;
}

export async function resolvePageWithRedirect(
  env: any,
  incoming: string
): Promise<ResolvedPage> {
  const decodedIncoming = safeDecodeURIComponent(incoming);
  const slugified = slugify(decodedIncoming);

  if (slugified) {
    const slugRow = await env.DB.prepare(
      "SELECT page_id FROM slug_map WHERE display_name = ? LIMIT 1"
    )
      .bind(slugified)
      .first<{ page_id: string }>();

    if (slugRow?.page_id) {
      return { pageId: slugRow.page_id };
    }
  }

  const slugRow = await env.DB.prepare(
    "SELECT page_id FROM slug_map WHERE display_name = ? LIMIT 1"
  )
    .bind(decodedIncoming)
    .first<{ page_id: string }>();

  if (slugRow?.page_id) {
    return { pageId: slugRow.page_id };
  }

  if (slugified) {
    const historyRow = await env.DB.prepare(
      "SELECT page_id, new_slug FROM slug_history WHERE old_slug = ? LIMIT 1"
    )
      .bind(slugified)
      .first<{ page_id: string; new_slug: string }>();

    if (historyRow?.page_id && historyRow.new_slug) {
      return { pageId: historyRow.page_id, redirectSlug: historyRow.new_slug };
    }
  }

  const historyRow = await env.DB.prepare(
    "SELECT page_id, new_slug FROM slug_history WHERE old_slug = ? LIMIT 1"
  )
    .bind(decodedIncoming)
    .first<{ page_id: string; new_slug: string }>();

  if (historyRow?.page_id && historyRow.new_slug) {
    return { pageId: historyRow.page_id, redirectSlug: historyRow.new_slug };
  }

  return { pageId: decodedIncoming };
}

export function safeDecodeURIComponent(value: string) {
  try {
    return decodeURIComponent(value);
  } catch (error) {
    return value;
  }
}
