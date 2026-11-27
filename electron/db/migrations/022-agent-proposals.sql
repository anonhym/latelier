-- Migration 022: Agent Proposals (X28 §2).
-- Append-only; never edit after merge. Fixes go in a new migration.

-- One row per Proposal an Agent filed: a Reference Rule the user may add, set
-- aside or decline. No foreign keys, like the Agent Read Log: a Proposal
-- outlives its tokens, sessions and Connection, so the Connection's name is
-- copied at write time. Names are plaintext, as in the Read Log. pair_key is
-- X26's key for the pair, so the Never list and discovery read the same one.
-- decided_at stays null while the Proposal is open (pending or later); rule_id
-- and saved_for are set once it is accepted.
CREATE TABLE agent_proposals (
  id                TEXT PRIMARY KEY,
  kind              TEXT NOT NULL CHECK (kind IN ('reference_rule')),
  status            TEXT NOT NULL CHECK (status IN ('pending','later','accepted','declined','expired','obsolete')),
  connection_id     TEXT NOT NULL,
  connection_name   TEXT NOT NULL,
  source_db         TEXT NOT NULL,
  source_collection TEXT NOT NULL,
  source_field      TEXT NOT NULL,
  target_db         TEXT NOT NULL,
  target_collection TEXT NOT NULL,
  target_field      TEXT NOT NULL,
  pair_key          TEXT NOT NULL,
  created_at        TEXT NOT NULL,
  decided_at        TEXT,
  expires_at        TEXT NOT NULL,
  rule_id           TEXT,
  saved_for         TEXT CHECK (saved_for IN ('connection','family'))
);

-- One open Proposal per pair: a second Agent joins it as a backer.
CREATE UNIQUE INDEX idx_agent_proposals_open_pair ON agent_proposals(pair_key) WHERE status IN ('pending','later');
CREATE INDEX idx_agent_proposals_status ON agent_proposals(status, created_at, id);
CREATE INDEX idx_agent_proposals_created ON agent_proposals(created_at, id);
CREATE INDEX idx_agent_proposals_conn ON agent_proposals(connection_id, status);

-- Each Agent that proposed the pair. reason is the Agent's own text, which can
-- carry values copied from documents: sealed by ColumnCipher against the
-- row's own id, hence BLOB.
CREATE TABLE agent_proposal_backers (
  id          TEXT NOT NULL UNIQUE,
  proposal_id TEXT NOT NULL,
  token_id    TEXT NOT NULL,
  token_name  TEXT,
  session_id  TEXT,
  client_name TEXT,
  reason      BLOB NOT NULL,
  created_at  TEXT NOT NULL,
  PRIMARY KEY (proposal_id, token_id)
);

CREATE INDEX idx_agent_proposal_backers_token ON agent_proposal_backers(token_id);
CREATE INDEX idx_agent_proposal_backers_session ON agent_proposal_backers(session_id);

-- schema_version is a one-row table by design, so no WHERE.
UPDATE schema_version SET version = 22;
