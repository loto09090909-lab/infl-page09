export function slugify(value: string): string {
  const normalized = value.normalize("NFKD").toLowerCase();

  const separated = normalized
    .replace(/[\s\p{P}\p{S}_]+/gu, "-")
    .replace(/-+/g, "-");

  const cleaned = separated.replace(/[^\p{L}\p{N}-]/gu, "");
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

export async function resolvePageId(env: any, incoming: string) {
  const decodedIncoming = safeDecodeURIComponent(incoming);
  const slugified = slugify(decodedIncoming);

  if (slugified) {
    const slugRow = await env.DB.prepare(
      "SELECT page_id FROM slug_map WHERE display_name = ? LIMIT 1"
    )
      .bind(slugified)
      .first<{ page_id: string }>();

    if (slugRow?.page_id) {
      return slugRow.page_id;
    }
  }

  const row = await env.DB.prepare(
    "SELECT page_id FROM slug_map WHERE display_name = ? LIMIT 1"
  )
    .bind(decodedIncoming)
    .first<{ page_id: string }>();

  return row?.page_id ?? decodedIncoming;
}

export function safeDecodeURIComponent(value: string) {
  try {
    return decodeURIComponent(value);
  } catch (error) {
    return value;
  }
}
