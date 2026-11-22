-- Note for an event's first period (later periods keep theirs inside additional_periods).
ALTER TABLE timeline_events ADD COLUMN period_note TEXT;
