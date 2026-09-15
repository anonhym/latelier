-- 002-connections-unique-name.sql
-- Enforce unique connection names so the UI can rely on name-based addressing
-- without ambiguity. Migration is append-only; never edit after merge.

CREATE UNIQUE INDEX uq_connections_name ON connections(name);

UPDATE schema_version SET version = 2;
