import { categoryLabel } from '../../shared/categories'
import { normalizeAlias } from '../../shared/markers'
import { SearchField, type Choice } from './SelectField'

export type PickerOption = {
  id: string
  name: string
  long_name?: string | null
  category: string
  aliases?: string[]
  hint?: string
  count?: number
}

/** Searchable marker list: matches name, long name, aliases and category. */
export function MarkerPicker({
  options,
  onPick,
  placeholder = 'Add a marker…',
  suggestions,
  autoFocus,
  allowCreate,
  onCreate,
  compact,
}: {
  options: PickerOption[]
  onPick: (id: string) => void
  placeholder?: string
  suggestions?: { label: string; items: PickerOption[] }
  autoFocus?: boolean
  allowCreate?: boolean
  onCreate?: (name: string) => void
  compact?: boolean
}) {
  function filter(query: string): Choice[] {
    const q = normalizeAlias(query)
    let matches = suggestions?.items.length ? suggestions.items : options
    if (q) {
      matches = options
        .map((o) => {
          const names = [o.name, o.long_name ?? '', ...(o.aliases ?? [])].map(normalizeAlias)
          let score = 0
          if (names[0] === q) score = 100
          else if (names.includes(q)) score = 90
          else if (names[0].startsWith(q)) score = 80
          else if (names.some((name) => name.startsWith(q))) score = 70
          else if (names.some((name) => name.includes(q))) score = 50
          else if (normalizeAlias(categoryLabel(o.category)).includes(q)) score = 20
          return { o, score }
        })
        .filter((item) => item.score > 0)
        .sort((a, b) => b.score - a.score || a.o.name.localeCompare(b.o.name))
        .map((item) => item.o)
    }
    const choices = matches.slice(0, 60).map((o) => ({
      value: o.id,
      label: o.name,
      detail: [o.long_name !== o.name && o.long_name, o.hint ?? categoryLabel(o.category), o.count]
        .filter((v) => v || v === 0)
        .join(' · '),
    }))
    if (allowCreate && query.trim() && !matches.some((o) => normalizeAlias(o.name) === q)) {
      choices.push({ value: 'create:' + query.trim(), label: 'Create marker “' + query.trim() + '”', detail: '' })
    }
    return choices
  }

  return (
    <SearchField
      label={placeholder}
      hideLabel
      placeholder={placeholder}
      autoFocus={autoFocus}
      size={compact ? 'sm' : 'md'}
      filterOptions={filter}
      suggestionsLabel={suggestions?.items.length ? suggestions.label : undefined}
      onChange={(id) => {
        if (id.startsWith('create:')) onCreate?.(id.slice(7))
        else onPick(id)
      }}
    />
  )
}
