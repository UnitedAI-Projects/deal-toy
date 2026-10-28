-- Agent sessions, the per-project activity log and team-note delivery.
CREATE TABLE sessions (id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES projects(id), member TEXT NOT NULL REFERENCES members(email), client TEXT, prompt TEXT NOT NULL, title TEXT, summary TEXT, started_at TEXT NOT NULL, ended_at TEXT, last_event_at TEXT NOT NULL);
CREATE INDEX sessions_project ON sessions(project_id, started_at);
CREATE TABLE project_events (id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES projects(id), session_id TEXT REFERENCES sessions(id), kind TEXT NOT NULL CHECK(kind IN ('prompt','agent_update','tool_call','team_note','team_edit','ended')), actor TEXT NOT NULL, payload TEXT NOT NULL, created_at TEXT NOT NULL);
CREATE INDEX project_events_project ON project_events(project_id, created_at);
CREATE INDEX project_events_session ON project_events(session_id);
-- session_id '' records a delivery made outside any session (projects_get without a session).
CREATE TABLE note_deliveries (note_id TEXT NOT NULL REFERENCES project_events(id), session_id TEXT NOT NULL, delivered_at TEXT NOT NULL, PRIMARY KEY(note_id, session_id));
