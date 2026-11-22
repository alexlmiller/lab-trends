-- Every upload that put results on a draw. A draw can come from several
-- reports; each stays reachable from the draw and none outlives it.
CREATE TABLE panel_files (
  panel_id TEXT NOT NULL REFERENCES lab_panels(id) ON DELETE CASCADE,
  file_id TEXT NOT NULL REFERENCES files(id) ON DELETE CASCADE,
  PRIMARY KEY (panel_id, file_id)
);
CREATE INDEX panel_files_file ON panel_files(file_id);
INSERT INTO panel_files (panel_id, file_id)
  SELECT p.id, p.source_file_id FROM lab_panels p JOIN files f ON f.id = p.source_file_id;

-- panel_files now holds what these two columns held. Emptying them lets an
-- upload or an import be deleted without a draw still pointing at it.
UPDATE lab_panels SET source_file_id = NULL, source_candidate_id = NULL
  WHERE source_file_id IS NOT NULL OR source_candidate_id IS NOT NULL;
-- Both are still foreign keys, which SQLite checks on every delete of an upload
-- or a draft. These (empty) indexes answer that check without reading every draw.
CREATE INDEX lab_panels_source_file ON lab_panels(source_file_id) WHERE source_file_id IS NOT NULL;
CREATE INDEX lab_panels_source_candidate ON lab_panels(source_candidate_id) WHERE source_candidate_id IS NOT NULL;

-- Bookkeeping for one-time repairs to stored data (src/worker/upgrade.ts).
CREATE TABLE app_state (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

-- Indexes follow the queries the app runs (test/queries.test.ts checks each
-- one's plan). Every index also costs a row written on each insert, so three
-- that no query uses any more are dropped.

-- A person's draws in the order they are listed, so no query sorts them.
DROP INDEX lab_panels_subject_date;
CREATE INDEX lab_panels_subject_order ON lab_panels(subject_id, draw_date, draw_time, id);
-- The spellings one person's reports have used, read on every page load.
CREATE INDEX lab_marker_aliases_scope ON lab_marker_aliases(scope, marker_id);
CREATE INDEX saved_views_subject ON saved_views(subject_id, created_at);
-- Whether an import still needs an upload.
CREATE INDEX extraction_candidates_file ON extraction_candidates(file_id);

-- Results are always reached through their draw: UNIQUE (panel_id, marker_id).
DROP INDEX lab_results_subject_marker;
DROP INDEX lab_markers_loinc;
