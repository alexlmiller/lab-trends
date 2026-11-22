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

-- Bookkeeping for one-time repairs to stored data (src/worker/upgrade.ts).
CREATE TABLE app_state (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
