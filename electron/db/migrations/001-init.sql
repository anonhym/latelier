-- 001-init.sql — initial schema per F02 §3.
-- Append-only: never edit after merge. Fixes go in a new migration.

CREATE TABLE IF NOT EXISTS schema_version (
  version INTEGER NOT NULL
);

INSERT INTO schema_version (version) VALUES (0);

-- Connections -----------------------------------------------------

CREATE TABLE connections (
  id                          TEXT PRIMARY KEY,
  name                        TEXT NOT NULL,
  color                       TEXT NOT NULL DEFAULT '#1A6835',
  connection_type             TEXT NOT NULL CHECK(connection_type IN ('srv','standard')),
  host                        TEXT NOT NULL,
  port                        INTEGER NOT NULL,
  default_db                  TEXT,
  auth_mech                   TEXT NOT NULL CHECK(auth_mech IN ('scram256','scram1','x509','awsiam','none')),
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

CREATE INDEX idx_connections_last_used ON connections(last_used_at DESC);

CREATE TABLE connection_secrets (
  connection_id TEXT NOT NULL,
  field         TEXT NOT NULL,
  ciphertext    BLOB NOT NULL,
  updated_at    TEXT NOT NULL,
  PRIMARY KEY (connection_id, field),
  FOREIGN KEY (connection_id) REFERENCES connections(id) ON DELETE CASCADE
);

-- Saved queries --------------------------------------------------

CREATE TABLE saved_queries (
  id            TEXT PRIMARY KEY,
  connection_id TEXT NOT NULL,
  db_name       TEXT NOT NULL,
  collection    TEXT NOT NULL,
  kind          TEXT NOT NULL CHECK(kind IN ('find','aggregation','script')),
  name          TEXT NOT NULL,
  payload_json  TEXT NOT NULL,
  created_at    TEXT NOT NULL,
  updated_at    TEXT NOT NULL,
  FOREIGN KEY (connection_id) REFERENCES connections(id) ON DELETE CASCADE
);

CREATE INDEX idx_saved_by_target ON saved_queries(connection_id, db_name, collection);

-- Recent queries -------------------------------------------------

CREATE TABLE recent_queries (
  id             TEXT PRIMARY KEY,
  connection_id  TEXT NOT NULL,
  db_name        TEXT NOT NULL,
  collection     TEXT NOT NULL,
  kind           TEXT NOT NULL CHECK(kind IN ('find','aggregation')),
  payload_json   TEXT NOT NULL,
  ran_at         TEXT NOT NULL,
  duration_ms    INTEGER NOT NULL,
  result_count   INTEGER,
  error_code     TEXT,
  FOREIGN KEY (connection_id) REFERENCES connections(id) ON DELETE CASCADE
);

CREATE INDEX idx_recent_by_conn_time ON recent_queries(connection_id, ran_at DESC);

-- Workspace tabs -------------------------------------------------

CREATE TABLE workspace_tabs (
  id            TEXT PRIMARY KEY,
  connection_id TEXT NOT NULL,
  kind          TEXT NOT NULL CHECK(kind IN ('collection','aggregation')),
  db_name       TEXT NOT NULL,
  collection    TEXT NOT NULL,
  state_json    TEXT NOT NULL,
  position      INTEGER NOT NULL,
  is_active     INTEGER NOT NULL DEFAULT 0,
  opened_at     TEXT NOT NULL,
  FOREIGN KEY (connection_id) REFERENCES connections(id) ON DELETE CASCADE
);

CREATE INDEX idx_tabs_position ON workspace_tabs(position);

-- Preview field prefs --------------------------------------------

CREATE TABLE preview_fields (
  connection_id TEXT NOT NULL,
  db_name       TEXT NOT NULL,
  collection    TEXT NOT NULL,
  fields_json   TEXT NOT NULL,
  updated_at    TEXT NOT NULL,
  PRIMARY KEY (connection_id, db_name, collection),
  FOREIGN KEY (connection_id) REFERENCES connections(id) ON DELETE CASCADE
);

-- Global app state -----------------------------------------------

CREATE TABLE app_state (
  key        TEXT PRIMARY KEY,
  value_json TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

UPDATE schema_version SET version = 1;
