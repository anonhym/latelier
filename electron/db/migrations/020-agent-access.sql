-- Migration 020: Agent Access (X27).
-- Append-only; never edit after merge. Fixes go in a new migration.

-- Shared with Agents is a property of one Connection and defaults to off.
-- Only a dedicated main-process action writes it; the insert and the general
-- update statements never name the column.
ALTER TABLE connections
  ADD COLUMN share_with_agents INTEGER NOT NULL DEFAULT 0 CHECK (share_with_agents IN (0,1));

-- One row per named Agent. Only the SHA-256 of the token is stored; the
-- token itself is shown once and never persisted.
CREATE TABLE agent_tokens (
  id           TEXT PRIMARY KEY,
  name         TEXT NOT NULL CHECK (length(name) BETWEEN 1 AND 64),
  token_hash   TEXT NOT NULL UNIQUE,
  created_at   TEXT NOT NULL,
  last_used_at TEXT
);

-- Every Agent tool call, refused ones included. No foreign keys: a row
-- outlives its Connection and its token, so the names are copied at write
-- time and the ids are nullable (list_connections and pre-auth refusals have
-- no Connection). request_json is sealed by ColumnCipher, hence BLOB. outcome
-- is deliberately not CHECK-constrained so a new error code needs no table
-- rebuild; the repository validates it.
CREATE TABLE agent_read_log (
  id              TEXT PRIMARY KEY,
  ts              TEXT NOT NULL,
  token_id        TEXT,
  token_name      TEXT,
  client_name     TEXT,
  client_version  TEXT,
  connection_id   TEXT,
  connection_name TEXT,
  database        TEXT,
  collection      TEXT,
  tool            TEXT NOT NULL,
  request_json    BLOB,
  doc_count       INTEGER NOT NULL DEFAULT 0,
  bytes           INTEGER NOT NULL DEFAULT 0,
  duration_ms     INTEGER NOT NULL,
  outcome         TEXT NOT NULL,
  truncated       INTEGER NOT NULL DEFAULT 0 CHECK (truncated IN (0,1))
);

CREATE INDEX idx_agent_read_log_ts ON agent_read_log(ts);

-- schema_version is a one-row table by design, so no WHERE.
UPDATE schema_version SET version = 20;
