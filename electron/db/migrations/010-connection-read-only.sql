-- Migration 010: read-only connection flag. Blocks every MongoDB
-- write reachable through the connection, enforced in the main process.
-- Whole-connection, persisted on the record (survives restarts) rather
-- than a per-session toggle. Existing connections default to writable.

ALTER TABLE connections
  ADD COLUMN read_only INTEGER NOT NULL DEFAULT 0;

UPDATE schema_version SET version = 10;
