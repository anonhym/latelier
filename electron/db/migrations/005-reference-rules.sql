-- 005-reference-rules.sql
-- Document-reference rules (X05). A rule says: "when you see
-- `source_field` in a doc from `source_db.source_collection`, treat the
-- value as a pointer to `target_db.target_collection.target_field`."
-- Append-only; never edit after merge.

CREATE TABLE reference_rules (
  id                 TEXT PRIMARY KEY,
  connection_id      TEXT NOT NULL,
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
  FOREIGN KEY (connection_id) REFERENCES connections(id) ON DELETE CASCADE
);

CREATE UNIQUE INDEX uq_reference_rules_source
  ON reference_rules(connection_id, source_db, source_collection, source_field);

CREATE INDEX idx_reference_rules_source
  ON reference_rules(connection_id, source_db, source_collection);

UPDATE schema_version SET version = 5;
