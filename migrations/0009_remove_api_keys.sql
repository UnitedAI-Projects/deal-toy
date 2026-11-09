-- MCP clients sign in with OAuth only. API keys and the permission that allowed them are removed.
-- When this was written, every production key had already been revoked.
DELETE FROM level_permissions WHERE permission = 'keys.use';
DELETE FROM member_permissions WHERE permission = 'keys.use';
DROP INDEX api_keys_email;
DROP TABLE api_keys;
