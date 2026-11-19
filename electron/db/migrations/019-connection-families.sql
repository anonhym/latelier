-- Migration 019: Connection Families (X23).
-- Append-only; never edit after merge. Fixes go in a new migration.

-- A named set of Connections that share Reference Rules and Row Summaries.
CREATE TABLE connection_families (
  id         TEXT PRIMARY KEY,
  name       TEXT NOT NULL UNIQUE COLLATE NOCASE,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

-- At most one Family per Connection. Deleting a Family leaves its members
-- with no Family; their rows are untouched.
ALTER TABLE connections
  ADD COLUMN family_id TEXT REFERENCES connection_families(id) ON DELETE SET NULL;

CREATE INDEX idx_connections_family ON connections(family_id);

-- Reference rules gain a second possible owner. SQLite cannot relax NOT NULL
-- in place, so the table is rebuilt. No table references reference_rules and
-- no column is encrypted, so rows copy through unchanged and keep their
-- Connection as owner.
CREATE TABLE reference_rules_new (
  id                 TEXT PRIMARY KEY,
  connection_id      TEXT,
  family_id          TEXT,
  source_db          TEXT NOT NULL,
  source_collection  TEXT NOT NULL,
  source_field       TEXT NOT NULL,
  target_db          TEXT NOT NULL,
  target_collection  TEXT NOT NULL,
  target_field       TEXT NOT NULL DEFAULT '_id',
  projection_json    TEXT NOT NULL DEFAULT '[]',
  display_template   TEXT,
  enabled            INTEGER NOT NULL DEFAULT 1,
  created_at         TEXT NOT NULL,
  updated_at         TEXT NOT NULL,
  FOREIGN KEY (connection_id) REFERENCES connections(id) ON DELETE CASCADE,
  FOREIGN KEY (family_id) REFERENCES connection_families(id) ON DELETE CASCADE,
  CHECK ((connection_id IS NULL) <> (family_id IS NULL))
);

INSERT INTO reference_rules_new
  (id, connection_id, family_id, source_db, source_collection, source_field,
   target_db, target_collection, target_field, projection_json, display_template,
   enabled, created_at, updated_at)
SELECT
  id, connection_id, NULL, source_db, source_collection, source_field,
  target_db, target_collection, target_field, projection_json, display_template,
  enabled, created_at, updated_at
FROM reference_rules;

DROP TABLE reference_rules;
ALTER TABLE reference_rules_new RENAME TO reference_rules;

-- An Override is a Connection-owned row whose key matches a Family-owned row,
-- so the two owners each get their own uniqueness.
CREATE UNIQUE INDEX uq_reference_rules_connection_source
  ON reference_rules(connection_id, source_db, source_collection, source_field)
  WHERE connection_id IS NOT NULL;

CREATE UNIQUE INDEX uq_reference_rules_family_source
  ON reference_rules(family_id, source_db, source_collection, source_field)
  WHERE family_id IS NOT NULL;

CREATE INDEX idx_reference_rules_source
  ON reference_rules(connection_id, source_db, source_collection);

CREATE INDEX idx_reference_rules_family_source
  ON reference_rules(family_id, source_db, source_collection);

-- The fields a collapsed Tree row shows, per Collection.
CREATE TABLE row_summaries (
  id            TEXT PRIMARY KEY,
  connection_id TEXT,
  family_id     TEXT,
  db_name       TEXT NOT NULL,
  collection    TEXT NOT NULL,
  fields_json   TEXT NOT NULL,
  updated_at    TEXT NOT NULL,
  FOREIGN KEY (connection_id) REFERENCES connections(id) ON DELETE CASCADE,
  FOREIGN KEY (family_id) REFERENCES connection_families(id) ON DELETE CASCADE,
  CHECK ((connection_id IS NULL) <> (family_id IS NULL))
);

CREATE UNIQUE INDEX uq_row_summaries_connection
  ON row_summaries(connection_id, db_name, collection)
  WHERE connection_id IS NOT NULL;

CREATE UNIQUE INDEX uq_row_summaries_family
  ON row_summaries(family_id, db_name, collection)
  WHERE family_id IS NOT NULL;

UPDATE schema_version SET version = 19;
