// Marker name normalization. The seeded aliases (migrations/0002) were stored
// with these rules, so changing them means re-normalizing those rows.

const STRIP = /\b(?:quant|quantitative|serum|plasma|blood|total)\b/g

export function normalizeAlias(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(STRIP, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

export function slugify(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'marker'
}
