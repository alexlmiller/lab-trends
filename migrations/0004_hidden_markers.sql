-- Markers a person removed; future imports leave their rows unticked.
ALTER TABLE preferences ADD COLUMN hidden_marker_ids TEXT NOT NULL DEFAULT '[]';
