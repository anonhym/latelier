ALTER TABLE workspace_tabs
  ADD COLUMN pinned INTEGER NOT NULL DEFAULT 0;

UPDATE schema_version SET version = 6;
