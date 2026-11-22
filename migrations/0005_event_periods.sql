-- The original date columns hold the first occurrence for single-date clients.
ALTER TABLE timeline_events ADD COLUMN additional_periods TEXT NOT NULL DEFAULT '[]';
