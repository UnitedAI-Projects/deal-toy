-- Each project's phase state (brief, concepts, decisions, documents, suppliers) as one versioned
-- document, and the files its phases hold (logos, sketches, references, engine saves) in R2.
CREATE TABLE phase_states (
  project_id TEXT PRIMARY KEY REFERENCES projects(id),
  state TEXT NOT NULL,
  version INTEGER NOT NULL,
  updated_by TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE TABLE phase_files (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id),
  phase TEXT NOT NULL,
  name TEXT NOT NULL,
  media_type TEXT NOT NULL,
  size INTEGER NOT NULL,
  sha256 TEXT NOT NULL,
  object_key TEXT NOT NULL,
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX phase_files_project ON phase_files(project_id, phase, created_at);
