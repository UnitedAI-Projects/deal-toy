-- Measure jobs are a fourth job purpose. SQLite cannot change a CHECK constraint in place, so the
-- jobs table is rebuilt with the same columns, rows and indexes. Its only child, artifacts, is
-- rebuilt with it, pointing at the new table, so no row ever references a missing job: dropping a
-- parent that still has children fails at commit even with deferred foreign keys.
CREATE TABLE jobs_rebuilt (
  id TEXT PRIMARY KEY,
  revision_id TEXT NOT NULL REFERENCES revisions(id),
  status TEXT NOT NULL CHECK(status IN ('queued','running','succeeded','failed')),
  error TEXT,
  facts TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  created_by TEXT,
  purpose TEXT NOT NULL DEFAULT 'build' CHECK(purpose IN ('build','check','view','measure')),
  options TEXT
);
INSERT INTO jobs_rebuilt (id,revision_id,status,error,facts,created_at,updated_at,created_by,purpose,options)
  SELECT id,revision_id,status,error,facts,created_at,updated_at,created_by,purpose,options FROM jobs;
CREATE TABLE artifacts_rebuilt (
  id TEXT PRIMARY KEY,
  job_id TEXT NOT NULL REFERENCES jobs_rebuilt(id),
  name TEXT NOT NULL,
  object_key TEXT NOT NULL UNIQUE,
  media_type TEXT NOT NULL,
  sha256 TEXT NOT NULL,
  size INTEGER NOT NULL
);
INSERT INTO artifacts_rebuilt (id,job_id,name,object_key,media_type,sha256,size)
  SELECT id,job_id,name,object_key,media_type,sha256,size FROM artifacts;
DROP TABLE artifacts;
DROP TABLE jobs;
-- Renaming rewrites artifacts_rebuilt's reference to the new name, jobs.
ALTER TABLE jobs_rebuilt RENAME TO jobs;
ALTER TABLE artifacts_rebuilt RENAME TO artifacts;
CREATE INDEX jobs_revision ON jobs(revision_id);
CREATE INDEX jobs_created_by ON jobs(created_by, created_at);
CREATE INDEX jobs_purpose ON jobs(revision_id, purpose, created_at);

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
