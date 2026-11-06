-- Jobs now have a purpose: revision builds, saved-action check builds, and view-as-of previews.
-- Only 'build' jobs are a revision's build; the others never appear as one.
ALTER TABLE jobs ADD COLUMN purpose TEXT NOT NULL DEFAULT 'build' CHECK(purpose IN ('build','check','view'));
ALTER TABLE jobs ADD COLUMN options TEXT;
CREATE INDEX jobs_purpose ON jobs(revision_id, purpose, created_at);

-- Custom actions saved for reuse. A version is 'ready' only after its example built.
CREATE TABLE saved_actions (
  id TEXT NOT NULL,
  version INTEGER NOT NULL,
  scope TEXT NOT NULL CHECK(scope IN ('project','team')),
  project_id TEXT REFERENCES projects(id),
  status TEXT NOT NULL CHECK(status IN ('checking','ready','rejected')),
  record TEXT,
  source TEXT NOT NULL,
  error TEXT,
  revision_id TEXT NOT NULL REFERENCES revisions(id),
  job_id TEXT,
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY(id, version)
);
CREATE INDEX saved_actions_project ON saved_actions(project_id, status);

-- Named input sets for an action, such as "M3 counterbore".
CREATE TABLE presets (
  id TEXT NOT NULL,
  version INTEGER NOT NULL,
  action TEXT NOT NULL,
  name TEXT NOT NULL,
  description TEXT NOT NULL,
  inputs TEXT NOT NULL,
  scope TEXT NOT NULL CHECK(scope IN ('project','team')),
  project_id TEXT REFERENCES projects(id),
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY(id, version)
);

-- The newest saved action or preset a session has been told about.
ALTER TABLE sessions ADD COLUMN catalog_seen TEXT;
