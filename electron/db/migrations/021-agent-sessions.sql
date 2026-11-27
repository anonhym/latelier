-- Migration 021: Agent sessions (X27 §16.2).
-- Append-only; never edit after merge. Fixes go in a new migration.

-- One row per Agent session past its discovery probe. No foreign keys, like
-- the Agent Read Log: a session row outlives its token, so the token's name
-- is copied at write time. folder is what the bridge reported as its working
-- directory, sealed by ColumnCipher, hence BLOB. ended_at and end_reason stay
-- null while the session is live.
CREATE TABLE agent_sessions (
  id             TEXT PRIMARY KEY,
  token_id       TEXT,
  token_name     TEXT,
  client_name    TEXT,
  client_version TEXT,
  folder         BLOB,
  started_at     TEXT NOT NULL,
  ended_at       TEXT,
  end_reason     TEXT CHECK (end_reason IN ('client-closed','user-ended','token-revoked','access-off','app-quit','unknown'))
);

CREATE INDEX idx_agent_sessions_token ON agent_sessions(token_id, started_at, id);
CREATE INDEX idx_agent_sessions_open ON agent_sessions(ended_at);

-- Rows written before this migration keep a null session.
ALTER TABLE agent_read_log ADD COLUMN session_id TEXT;

CREATE INDEX idx_agent_read_log_session ON agent_read_log(session_id, ts, id);
CREATE INDEX idx_agent_read_log_conn ON agent_read_log(connection_id, ts);

-- schema_version is a one-row table by design, so no WHERE.
UPDATE schema_version SET version = 21;
