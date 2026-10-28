-- In-app accounts: access levels, per-person adjustments, browser sessions, sign-in links,
-- API keys and an audit log. Replaces the admin/maker role and the administrator-issued tokens.
CREATE TABLE levels (id TEXT PRIMARY KEY, name TEXT NOT NULL UNIQUE, is_default INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL);
CREATE TABLE level_permissions (level_id TEXT NOT NULL REFERENCES levels(id) ON DELETE CASCADE, permission TEXT NOT NULL, PRIMARY KEY(level_id, permission));
INSERT INTO levels VALUES
  ('level-demo','Demo',1,'2026-10-28T00:00:00.000Z'),
  ('level-maker','Maker',0,'2026-10-28T00:00:00.000Z'),
  ('level-admin','Admin',0,'2026-10-28T00:00:00.000Z');
INSERT INTO level_permissions VALUES
  ('level-demo','demo.view'),
  ('level-maker','demo.view'),('level-maker','projects.create'),('level-maker','models.edit'),
  ('level-maker','builds.run'),('level-maker','exports.download'),('level-maker','notes.write'),
  ('level-maker','keys.use'),
  ('level-admin','demo.view'),('level-admin','projects.create'),('level-admin','models.edit'),
  ('level-admin','builds.run'),('level-admin','exports.download'),('level-admin','notes.write'),
  ('level-admin','keys.use'),('level-admin','members.manage'),('level-admin','settings.manage');

ALTER TABLE members ADD COLUMN name TEXT NOT NULL DEFAULT '';
ALTER TABLE members ADD COLUMN level_id TEXT REFERENCES levels(id);
ALTER TABLE members ADD COLUMN owner INTEGER NOT NULL DEFAULT 0;
ALTER TABLE members ADD COLUMN status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active','suspended'));
ALTER TABLE members ADD COLUMN google_sub TEXT;
ALTER TABLE members ADD COLUMN created_at TEXT;
ALTER TABLE members ADD COLUMN last_active_at TEXT;
UPDATE members SET
  owner = CASE role WHEN 'admin' THEN 1 ELSE 0 END,
  level_id = CASE role WHEN 'admin' THEN 'level-admin' ELSE 'level-maker' END,
  status = CASE active WHEN 1 THEN 'active' ELSE 'suspended' END,
  created_at = '2026-10-28T00:00:00.000Z';
ALTER TABLE members DROP COLUMN role;
ALTER TABLE members DROP COLUMN active;
CREATE UNIQUE INDEX members_google_sub ON members(google_sub) WHERE google_sub IS NOT NULL;

CREATE TABLE member_permissions (email TEXT NOT NULL REFERENCES members(email), permission TEXT NOT NULL, effect TEXT NOT NULL CHECK(effect IN ('allow','revoke')), PRIMARY KEY(email, permission));
CREATE TABLE auth_sessions (hash TEXT PRIMARY KEY, email TEXT NOT NULL REFERENCES members(email), created_at TEXT NOT NULL, expires_at TEXT NOT NULL, last_seen_at TEXT NOT NULL, user_agent TEXT);
CREATE INDEX auth_sessions_email ON auth_sessions(email);
CREATE TABLE signin_links (hash TEXT PRIMARY KEY, email TEXT NOT NULL REFERENCES members(email), expires_at TEXT NOT NULL, used_at TEXT);

CREATE TABLE api_keys (id TEXT PRIMARY KEY, email TEXT NOT NULL REFERENCES members(email), name TEXT NOT NULL, prefix TEXT NOT NULL, hash TEXT NOT NULL UNIQUE, created_at TEXT NOT NULL, expires_at TEXT NOT NULL, last_used_at TEXT, revoked_at TEXT);
CREATE INDEX api_keys_email ON api_keys(email);
INSERT INTO api_keys (id, email, name, prefix, hash, created_at, expires_at)
  SELECT lower(hex(randomblob(16))), email, label, 'legacy', hash, '2026-10-28T00:00:00.000Z', expires_at FROM tokens;
DROP TABLE tokens;

CREATE TABLE audit_events (id TEXT PRIMARY KEY, actor TEXT NOT NULL, target TEXT NOT NULL, action TEXT NOT NULL, detail TEXT NOT NULL, created_at TEXT NOT NULL);
CREATE INDEX audit_events_created ON audit_events(created_at);

ALTER TABLE projects ADD COLUMN demo INTEGER NOT NULL DEFAULT 0;
ALTER TABLE jobs ADD COLUMN created_by TEXT;
CREATE INDEX jobs_created_by ON jobs(created_by, created_at);
