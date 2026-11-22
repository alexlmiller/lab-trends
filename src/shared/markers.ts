// Marker name normalization. Stored aliases hold names normalized by these
// rules, so a change here needs the stored rows normalized again: bump
// DATA_VERSION in src/worker/upgrade.ts.

const STRIP = /\b(?:quant|quantitative|serum|plasma|blood|total)\b/g

/**
 * The key two spellings of one test share. Letters and digits of any script
 * are kept, and "%" and "#" become words: "Neutrophils %" and "Neutrophils #"
 * are different tests.
 */
export function normalizeAlias(value: string): string {
  const words = value
    .trim()
    .toLowerCase()
    .replace(/%/g, ' percent ')
    .replace(/#/g, ' absolute ')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()
  // A name made only of specimen words ("Blood", "Total") keeps them: an empty key would match every other such name.
  return words.replace(STRIP, ' ').replace(/\s+/g, ' ').trim() || words
}

/** An ASCII slug for URLs, or "" when the name has no ASCII letters or digits; callers pick the fallback. */
export function slugify(value: string): string {
  return value
    .toLowerCase()
    .replace(/%/g, ' percent ')
    .replace(/#/g, ' absolute ')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
}
