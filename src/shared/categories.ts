export type CategoryMeta = { slug: string; label: string; order: number; aliases: string[] }

export const CATEGORIES: CategoryMeta[] = [
  { slug: 'inflammatory', label: 'Inflammatory', order: 10, aliases: ['inflammation'] },
  { slug: 'cbc', label: 'CBC', order: 20, aliases: ['hematology', 'complete_blood_count'] },
  { slug: 'metabolic', label: 'Metabolic', order: 30, aliases: ['chemistry', 'cmp', 'comprehensive_metabolic_panel', 'bmp'] },
  { slug: 'hormone', label: 'Hormone', order: 40, aliases: ['hormones', 'endocrine', 'thyroid'] },
  { slug: 'immune', label: 'Immune', order: 45, aliases: ['immunology', 'immunoglobulin', 'immunoglobulins'] },
  { slug: 'iron', label: 'Iron', order: 50, aliases: ['iron_studies'] },
  { slug: 'lipid', label: 'Lipid', order: 60, aliases: ['lipids', 'lipid_panel'] },
  { slug: 'nutrients', label: 'Nutrients', order: 70, aliases: ['nutrient', 'vitamin', 'vitamins'] },
  { slug: 'uncategorized', label: 'Other', order: 999, aliases: ['other', 'unknown'] },
]

const BY_SLUG = new Map(CATEGORIES.map((c) => [c.slug, c]))
const ALIASES = new Map<string, string>()
for (const c of CATEGORIES) {
  ALIASES.set(c.slug, c.slug)
  for (const a of c.aliases) ALIASES.set(a, c.slug)
}

function key(value: string | null | undefined): string {
  return (value ?? '').trim().toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '')
}

export function normalizeCategory(value: string | null | undefined): string {
  const k = key(value)
  return ALIASES.get(k) ?? (k || 'uncategorized')
}

export function categoryLabel(slug: string | null | undefined): string {
  if (!slug) return 'Other'
  return BY_SLUG.get(slug)?.label ?? slug.replace(/[-_]/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())
}

export function categoryOrder(slug: string): number {
  return BY_SLUG.get(slug)?.order ?? 500
}

export function sortCategories(slugs: string[]): string[] {
  return [...slugs].sort((a, b) => categoryOrder(a) - categoryOrder(b) || a.localeCompare(b))
}
