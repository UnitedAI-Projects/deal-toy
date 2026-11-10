-- A recorded walkthrough of a project (src/server/demo-tools.ts): the steps a demo plays back.
CREATE TABLE project_demos (
 project_id TEXT PRIMARY KEY REFERENCES projects(id),
 script TEXT NOT NULL,
 updated_at TEXT NOT NULL
);
