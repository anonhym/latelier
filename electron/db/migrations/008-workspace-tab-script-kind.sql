-- Migration 008: allow 'script' as a workspace_tabs.kind so the W12 script
-- editor can persist its tabs alongside collection tabs. SQLite cannot
-- alter a CHECK constraint in place, so the table is rebuilt:
-- copy → drop → rename.
--
-- The migration runner disables foreign keys for the duration of the
-- migration loop, so DROP TABLE here doesn't cascade-delete existing rows.

CREATE TABLE workspace_tabs_new (
  id            TEXT PRIMARY KEY,
  connection_id TEXT NOT NULL,
  kind          TEXT NOT NULL CHECK(kind IN ('collection','aggregation','script')),
  db_name       TEXT NOT NULL,
  collection    TEXT NOT NULL,
  state_json    TEXT NOT NULL,
  position      INTEGER NOT NULL,
  is_active     INTEGER NOT NULL DEFAULT 0,
  opened_at     TEXT NOT NULL,
  pinned        INTEGER NOT NULL DEFAULT 0,
  FOREIGN KEY (connection_id) REFERENCES connections(id) ON DELETE CASCADE
);

INSERT INTO workspace_tabs_new
  (id, connection_id, kind, db_name, collection, state_json,
   position, is_active, opened_at, pinned)
SELECT
  id, connection_id, kind, db_name, collection, state_json,
  position, is_active, opened_at, pinned
FROM workspace_tabs;

DROP TABLE workspace_tabs;
ALTER TABLE workspace_tabs_new RENAME TO workspace_tabs;

CREATE INDEX idx_tabs_position ON workspace_tabs(position);

UPDATE schema_version SET version = 8;
