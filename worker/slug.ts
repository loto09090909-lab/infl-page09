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
