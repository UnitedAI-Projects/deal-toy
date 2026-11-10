-- Deleting a project moves it to the Trash. A trashed project is hidden from every list and tool
-- until its owner restores it; after 30 days, or when the owner deletes it forever, the scheduled
-- sweep removes its rows and build files.
ALTER TABLE projects ADD COLUMN deleted_at TEXT;
ALTER TABLE projects ADD COLUMN deleted_by TEXT;
CREATE INDEX projects_trash ON projects(deleted_at) WHERE deleted_at IS NOT NULL;
