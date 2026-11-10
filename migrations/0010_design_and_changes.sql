-- Design sheets and change plans. A model's design sheet records what the agent asked about and
-- the framework of layers it agreed with the person; change plans record each request's declared
-- layers, so the guard in saveRevision can refuse agent writes outside them.
CREATE TABLE design_sheets (
  model_id TEXT PRIMARY KEY REFERENCES models(id),
  request TEXT NOT NULL,
  sections TEXT NOT NULL,
  framework TEXT NOT NULL,
  built INTEGER NOT NULL DEFAULT 0,
  session_id TEXT,
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE TABLE change_plans (
  id TEXT PRIMARY KEY,
  model_id TEXT NOT NULL REFERENCES models(id),
  project_id TEXT NOT NULL REFERENCES projects(id),
  session_id TEXT,
  member TEXT NOT NULL,
  by_kind TEXT NOT NULL CHECK(by_kind IN ('agent','person')),
  framework INTEGER NOT NULL DEFAULT 0,
  request TEXT NOT NULL,
  layers TEXT NOT NULL,
  sections TEXT NOT NULL DEFAULT '[]',
  status TEXT NOT NULL CHECK(status IN ('open','finished','stopped')),
  current TEXT,
  phrases TEXT NOT NULL DEFAULT '[]',
  summary TEXT,
  started_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  ended_at TEXT
);
CREATE UNIQUE INDEX one_open_plan ON change_plans(model_id) WHERE status='open';
CREATE INDEX change_plans_model ON change_plans(model_id, started_at);
CREATE INDEX change_plans_session ON change_plans(session_id) WHERE status='open';

-- The change that produced each revision. Older revisions have none.
ALTER TABLE revisions ADD COLUMN change_id TEXT REFERENCES change_plans(id);

-- Two new event kinds. SQLite cannot change a CHECK constraint in place, so project_events is
-- rebuilt with the same columns, rows and indexes, together with its only child, note_deliveries,
-- the same way 0008_checks.sql rebuilt jobs and artifacts. Rows are copied in rowid order, which
-- note delivery relies on.
CREATE TABLE project_events_rebuilt (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id),
  session_id TEXT REFERENCES sessions(id),
  kind TEXT NOT NULL CHECK(kind IN ('prompt','agent_update','tool_call','team_note','team_edit','ended','design','change')),
  actor TEXT NOT NULL,
  payload TEXT NOT NULL,
  created_at TEXT NOT NULL
);
INSERT INTO project_events_rebuilt (id,project_id,session_id,kind,actor,payload,created_at)
  SELECT id,project_id,session_id,kind,actor,payload,created_at FROM project_events ORDER BY rowid;
CREATE TABLE note_deliveries_rebuilt (
  note_id TEXT NOT NULL REFERENCES project_events_rebuilt(id),
  session_id TEXT NOT NULL,
  delivered_at TEXT NOT NULL,
  PRIMARY KEY(note_id, session_id)
);
INSERT INTO note_deliveries_rebuilt (note_id,session_id,delivered_at)
  SELECT note_id,session_id,delivered_at FROM note_deliveries;
DROP TABLE note_deliveries;
DROP TABLE project_events;
-- Renaming rewrites note_deliveries_rebuilt's reference to the new name, project_events.
ALTER TABLE project_events_rebuilt RENAME TO project_events;
ALTER TABLE note_deliveries_rebuilt RENAME TO note_deliveries;
CREATE INDEX project_events_project ON project_events(project_id, created_at);
CREATE INDEX project_events_session ON project_events(session_id);
