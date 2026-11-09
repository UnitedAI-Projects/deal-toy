-- Each model's check list, one versioned document edited by people and agents alike.
CREATE TABLE check_lists (
  model_id TEXT PRIMARY KEY REFERENCES models(id),
  version INTEGER NOT NULL,
  checks TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
-- Exact measurements made on a build's STEP by measure jobs, one row per requested pair.
CREATE TABLE measurements (
  build_id TEXT NOT NULL REFERENCES jobs(id),
  key TEXT NOT NULL,
  value TEXT,
  job_id TEXT,
  status TEXT NOT NULL,
  PRIMARY KEY(build_id, key)
);
