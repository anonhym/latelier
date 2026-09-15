-- 004-auth-mech-default.sql
-- Widen the auth_mech CHECK to include 'default' (driver-negotiated via
-- SASL saslSupportedMechs; matches Compass / mongosh behavior when the
-- authMechanism query param is absent). Append-only; never edit after merge.
--
-- SQLite has no ALTER TABLE ... DROP/ADD CONSTRAINT, so we rebuild the
-- table. Foreign-key enforcement is disabled by the migration runner for
-- the duration of the loop, so DROP TABLE connections does not cascade
-- into connection_secrets / saved_queries / recent_queries /
-- workspace_tabs / preview_fields.

CREATE TABLE connections_new (
  id                          TEXT PRIMARY KEY,
  name                        TEXT NOT NULL,
  color                       TEXT NOT NULL DEFAULT '#1A6835',
  connection_type             TEXT NOT NULL CHECK(connection_type IN ('srv','standard')),
  host                        TEXT NOT NULL,
  port                        INTEGER NOT NULL,
  default_db                  TEXT,
  auth_mech                   TEXT NOT NULL CHECK(auth_mech IN ('default','scram256','scram1','x509','awsiam','none')),
  auth_username               TEXT,
  auth_database               TEXT,
  tls_enabled                 INTEGER NOT NULL DEFAULT 1,
  tls_verify                  INTEGER NOT NULL DEFAULT 1,
  tls_ca_path                 TEXT,
  tls_client_cert_path        TEXT,
  ssh_enabled                 INTEGER NOT NULL DEFAULT 0,
  ssh_host                    TEXT,
  ssh_port                    INTEGER,
  ssh_username                TEXT,
  ssh_auth_method             TEXT CHECK(ssh_auth_method IN ('key','password') OR ssh_auth_method IS NULL),
  ssh_private_key_path        TEXT,
  connect_timeout_ms          INTEGER NOT NULL DEFAULT 10000,
  socket_timeout_ms           INTEGER NOT NULL DEFAULT 30000,
  server_selection_timeout_ms INTEGER NOT NULL DEFAULT 30000,
  read_preference             TEXT NOT NULL DEFAULT 'primary',
  max_pool_size               INTEGER NOT NULL DEFAULT 100,
  direct_connection           INTEGER NOT NULL DEFAULT 0,
  app_name                    TEXT,
  created_at                  TEXT NOT NULL,
  updated_at                  TEXT NOT NULL,
  last_used_at                TEXT
);

INSERT INTO connections_new SELECT * FROM connections;

DROP TABLE connections;

ALTER TABLE connections_new RENAME TO connections;

CREATE INDEX idx_connections_last_used ON connections(last_used_at DESC);
CREATE UNIQUE INDEX uq_connections_name ON connections(name);

UPDATE schema_version SET version = 4;
