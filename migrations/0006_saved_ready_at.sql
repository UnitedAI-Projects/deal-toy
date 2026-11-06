-- When a saved action version became ready, so running agent sessions can be told about it.
ALTER TABLE saved_actions ADD COLUMN ready_at TEXT;
