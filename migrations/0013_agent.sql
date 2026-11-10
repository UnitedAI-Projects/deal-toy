-- Conversation data follows project deletion; admission records retain no project content.
CREATE TABLE agent_turns (
 id TEXT PRIMARY KEY,
 project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
 phase TEXT NOT NULL,
 member TEXT NOT NULL,
 prompt TEXT NOT NULL,
 response TEXT NOT NULL DEFAULT '',
 actions TEXT NOT NULL DEFAULT '[]',
 status TEXT NOT NULL CHECK(status IN ('running','complete','failed')),
 created_at TEXT NOT NULL
);
CREATE INDEX agent_history ON agent_turns(project_id,phase,created_at);
CREATE TABLE agent_usage (
 id TEXT PRIMARY KEY,
 member TEXT NOT NULL,
 created_at TEXT NOT NULL
);
CREATE INDEX agent_usage_member ON agent_usage(member,created_at);
CREATE INDEX agent_usage_time ON agent_usage(created_at);
