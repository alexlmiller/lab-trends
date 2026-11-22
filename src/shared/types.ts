// Types shared by the Worker API and the React client.

// ─── Extraction (proposal layer) ────────────────────────────────────────

export type ExtractedResult = {
  raw_name: string
  raw_test_category?: string | null
  raw_value: string
  raw_units?: string | null
  reference_text?: string | null
  lab_flag?: string | null
  confidence?: number | null
  source_excerpt?: string | null
  source_row_id?: string | null
  warnings?: string[]
  // Review state, filled by the server's marker resolution and edited by the user.
  marker_id?: string | null
  match?: 'slug' | 'alias' | 'manual' | 'new' | null
  new_marker?: { name: string; category: string; default_units: string | null } | null
  include?: boolean
  existing?: { result_id: string; raw_value: string; raw_units: string | null } | null
}

export type ExtractedPanel = {
  panel_name?: string | null
  collected_at?: string | null
  draw_date?: string | null
  draw_time?: string | null
  facility?: string | null
  ordering_provider?: string | null
  accession_number?: string | null
  tags?: string[]
  results: ExtractedResult[]
  warnings?: string[]
  /** A saved draw a few days off with the same values: probably this draw under another date. */
  near_duplicate?: { draw_date: string; panel_id: string; matching: number; compared: number } | null
}

export type ExtractionDocument = {
  source_kind: SourceKind
  panels: ExtractedPanel[]
  document_warnings: string[]
}

export type SourceKind = 'pdf' | 'image' | 'csv' | 'xlsx' | 'manual'

export type CandidateStatus = 'queued' | 'processing' | 'ready' | 'failed' | 'committed' | 'discarded'

export type Candidate = {
  id: string
  batch_id: string
  file_id: string | null
  filename: string | null
  mime_type: string | null
  source_kind: SourceKind
  status: CandidateStatus
  document: ExtractionDocument | null
  model: string | null
  privacy_mode: string | null
  error: string | null
  created_at: string
  updated_at: string
}

export type ImportBatch = {
  id: string
  /** "committing" is an import being saved right now; it is open again if that save dies. */
  status: 'open' | 'committing' | 'committed'
  created_at: string
  created_by: string | null
  committed_at: string | null
  summary: CommitSummary | null
  candidates: Candidate[]
}

export type CommitSummary = {
  panels_created: number
  panels_merged: number
  results_created: number
  results_replaced: number
  duplicates_skipped: number
  markers_created: number
  skipped: number
  /** How many values were not saved because the import gave the same test another value on the same date. The first was saved. */
  same_day_conflict_count?: number
  /** Which ones. Only in the reply to the commit, never stored: an import's record holds counts, not results. */
  same_day_conflicts?: { date: string; name: string; kept: string; dropped: string }[]
}

// ─── Committed records ──────────────────────────────────────────────────

export type Subject = { id: string; display_name: string }

export type Marker = {
  id: string
  slug: string
  name: string
  long_name: string | null
  loinc_code: string | null
  category: string
  default_units: string | null
  description: string | null
  related_slugs: string[]
  is_custom: boolean
  status: string
  aliases?: string[]
}

export type Result = {
  id: string
  panel_id: string
  marker_id: string
  draw_date: string
  draw_time: string | null
  raw_name: string | null
  raw_value: string
  comparator: string | null
  value_numeric: number | null
  raw_units: string | null
  reference_text: string | null
  ref_low: number | null
  ref_high: number | null
  lab_flag: string | null
  flag_source: string | null
  notes: string | null
  corrected_at: string | null
  facility: string | null
  panel_tags: string[]
}

export type MarkerSeries = Marker & {
  results: Result[]
  target: PersonalTarget | null
}

export type Panel = {
  id: string
  draw_date: string
  draw_time: string | null
  facility: string | null
  ordering_provider: string | null
  accession_number: string | null
  panel_name: string | null
  notes: string | null
  tags: string[]
  /** Every uploaded report that put results on this draw. */
  sources: { file_id: string; filename: string }[]
  result_count: number
  flagged_count: number
}

export type PanelDetail = Panel & {
  results: (Result & { marker_name: string; marker_category: string })[]
}

export type PersonalTarget = {
  id: string
  marker_id: string
  target_low: number | null
  target_high: number | null
  note: string | null
}

export type EventPeriod = {
  start_date: string
  end_date: string | null
  ongoing: boolean
  /** What this occurrence was: a dose, a reason, where, what changed. */
  note?: string | null
}

export type TimelineEvent = EventPeriod & {
  id: string
  kind: EventKind
  label: string
  periods: EventPeriod[]
  updated_at: string
  notes: string | null
  marker_ids: string[]
}

export type EventKind = 'medication' | 'procedure' | 'illness' | 'lifestyle' | 'location' | 'other'

export type SavedView = { id: string; name: string; path: string; created_at: string }

export type Preferences = { starred_marker_ids: string[]; hidden_marker_ids: string[] }

/** Everything the charting surfaces need in one payload. */
export type Dataset = {
  subject: Subject
  markers: MarkerSeries[]
  panels: Panel[]
  events: TimelineEvent[]
  preferences: Preferences
  saved_views: SavedView[]
}

export type Me = {
  email: string
  /** May manage who has access. */
  owner?: boolean
  subjects: Subject[]
  document_imports?: boolean
  /** The model that reads each kind of upload. Ids starting with @cf/ run on Cloudflare. */
  extraction_models?: { pdf: string; photo: string }
  /** Model requests pass through an AI Gateway, which can log or cache them. */
  ai_gateway?: boolean
  /** A public read-only demo (DEMO_MODE=read-only). */
  demo?: boolean
}

/** Who may use this deployment, and the Cloudflare Access application it trusts. */
export type Instance = {
  owner_email: string
  access: { team_domain: string; source: 'settings' | 'first_sign_in' } | null
  people: { email: string; added_at: string; added_by: string | null }[]
}
