-- Lab Trends schema. Committed lab facts are the source of truth; charts,
-- correlations and grids are computed from them at read time.

CREATE TABLE subjects (
  id TEXT PRIMARY KEY,
  display_name TEXT NOT NULL,
  sex TEXT,
  birth_date TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE lab_markers (
  id TEXT PRIMARY KEY,
  slug TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  long_name TEXT,
  loinc_code TEXT,
  category TEXT NOT NULL DEFAULT 'uncategorized',
  default_units TEXT,
  description TEXT,
  related_slugs TEXT NOT NULL DEFAULT '[]',
  default_ref_low REAL,
  default_ref_high REAL,
  default_ref_text TEXT,
  is_custom INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'active',          -- active | merged | archived
  merged_into_id TEXT REFERENCES lab_markers(id),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX lab_markers_loinc ON lab_markers(loinc_code);

-- Source-name aliases. scope = 'global' or a subject id.
CREATE TABLE lab_marker_aliases (
  id TEXT PRIMARY KEY,
  marker_id TEXT NOT NULL REFERENCES lab_markers(id) ON DELETE CASCADE,
  source_name TEXT NOT NULL,
  normalized_name TEXT NOT NULL,
  scope TEXT NOT NULL DEFAULT 'global',
  created_at TEXT NOT NULL,
  UNIQUE (normalized_name, scope)
);
CREATE INDEX lab_marker_aliases_marker ON lab_marker_aliases(marker_id);

-- Raw evidence. Bytes live in R2 under r2_key.
CREATE TABLE files (
  id TEXT PRIMARY KEY,
  subject_id TEXT NOT NULL REFERENCES subjects(id),
  r2_key TEXT NOT NULL,
  filename TEXT NOT NULL,
  mime_type TEXT,
  byte_size INTEGER,
  sha256 TEXT,
  created_at TEXT NOT NULL,
  created_by TEXT
);
CREATE INDEX files_subject_sha ON files(subject_id, sha256);

-- One user upload = one batch; review/commit happens per batch.
CREATE TABLE import_batches (
  id TEXT PRIMARY KEY,
  subject_id TEXT NOT NULL REFERENCES subjects(id),
  status TEXT NOT NULL,                            -- open | committed | discarded
  created_at TEXT NOT NULL,
  created_by TEXT,
  committed_at TEXT,
  committed_by TEXT,
  summary TEXT
);
CREATE INDEX import_batches_subject ON import_batches(subject_id, created_at);

-- Extraction output per file, kept as a reviewable proposal until committed.
CREATE TABLE extraction_candidates (
  id TEXT PRIMARY KEY,
  batch_id TEXT NOT NULL REFERENCES import_batches(id) ON DELETE CASCADE,
  subject_id TEXT NOT NULL REFERENCES subjects(id),
  file_id TEXT REFERENCES files(id),
  source_kind TEXT NOT NULL,                       -- pdf | image | csv | xlsx | manual
  status TEXT NOT NULL,                            -- queued | processing | ready | failed | committed | discarded
  document TEXT,                                   -- JSON ExtractionDocument
  model TEXT,
  prompt_version TEXT,
  privacy_mode TEXT,                               -- local | cloudflare_ai | cloudflare_ai_redacted
  error TEXT,
  attempts INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX extraction_candidates_batch ON extraction_candidates(batch_id);

CREATE TABLE lab_panels (
  id TEXT PRIMARY KEY,
  subject_id TEXT NOT NULL REFERENCES subjects(id),
  draw_date TEXT NOT NULL,                         -- YYYY-MM-DD calendar date as reported
  draw_time TEXT,                                  -- HH:MM when reported
  facility TEXT,
  ordering_provider TEXT,
  accession_number TEXT,
  panel_name TEXT,
  notes TEXT,
  tags TEXT NOT NULL DEFAULT '[]',                 -- JSON array: draw context ("cycle day 3", "fasting")
  source_candidate_id TEXT REFERENCES extraction_candidates(id),
  source_file_id TEXT REFERENCES files(id),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  deleted_at TEXT
);
CREATE INDEX lab_panels_subject_date ON lab_panels(subject_id, draw_date);

CREATE TABLE lab_results (
  id TEXT PRIMARY KEY,
  panel_id TEXT NOT NULL REFERENCES lab_panels(id) ON DELETE CASCADE,
  subject_id TEXT NOT NULL REFERENCES subjects(id),
  marker_id TEXT NOT NULL REFERENCES lab_markers(id),
  raw_name TEXT,
  raw_value TEXT NOT NULL,                         -- exactly as displayed
  comparator TEXT,                                 -- = < <= > >= or text
  value_numeric REAL,
  value_text TEXT,
  raw_units TEXT,
  reference_text TEXT,                             -- exactly as displayed
  ref_low REAL,
  ref_high REAL,
  lab_flag TEXT,                                   -- low | high | critical | abnormal
  flag_source TEXT,                                -- reported | inferred
  notes TEXT,
  source_excerpt TEXT,
  source_row_id TEXT,
  corrected_at TEXT,
  corrected_by TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (panel_id, marker_id)
);
CREATE INDEX lab_results_subject_marker ON lab_results(subject_id, marker_id);

-- Audit trail for manual corrections and deletions.
CREATE TABLE result_revisions (
  id TEXT PRIMARY KEY,
  result_id TEXT NOT NULL,
  action TEXT NOT NULL,                            -- update | delete
  before_json TEXT,
  after_json TEXT,
  changed_at TEXT NOT NULL,
  changed_by TEXT
);
CREATE INDEX result_revisions_result ON result_revisions(result_id);

CREATE TABLE personal_targets (
  id TEXT PRIMARY KEY,
  subject_id TEXT NOT NULL REFERENCES subjects(id),
  marker_id TEXT NOT NULL REFERENCES lab_markers(id),
  target_low REAL,
  target_high REAL,
  note TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (subject_id, marker_id)
);

-- Context markers drawn on every chart: medications, procedures, illness, life events.
CREATE TABLE timeline_events (
  id TEXT PRIMARY KEY,
  subject_id TEXT NOT NULL REFERENCES subjects(id),
  kind TEXT NOT NULL DEFAULT 'other',              -- medication | procedure | illness | lifestyle | other
  label TEXT NOT NULL,
  start_date TEXT NOT NULL,
  end_date TEXT,                                   -- null = single day (or ongoing when ongoing=1)
  ongoing INTEGER NOT NULL DEFAULT 0,
  notes TEXT,
  marker_ids TEXT NOT NULL DEFAULT '[]',           -- empty = relevant to all markers
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  created_by TEXT
);
CREATE INDEX timeline_events_subject ON timeline_events(subject_id, start_date);

-- Named URLs (compare sets, correlation selections).
CREATE TABLE saved_views (
  id TEXT PRIMARY KEY,
  subject_id TEXT NOT NULL REFERENCES subjects(id),
  name TEXT NOT NULL,
  path TEXT NOT NULL,
  created_at TEXT NOT NULL,
  created_by TEXT
);

CREATE TABLE preferences (
  subject_id TEXT PRIMARY KEY REFERENCES subjects(id),
  starred_marker_ids TEXT NOT NULL DEFAULT '[]',
  section_order TEXT NOT NULL DEFAULT '[]',
  updated_at TEXT NOT NULL
);
