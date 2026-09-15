-- 003-saved-unique-name.sql
-- Add unique constraint on saved_queries so that names are unique per
-- connection/db/collection/kind scope. Append-only; never edit after merge.

CREATE UNIQUE INDEX IF NOT EXISTS uq_saved_name
  ON saved_queries(connection_id, db_name, collection, kind, name);

UPDATE schema_version SET version = 3;
