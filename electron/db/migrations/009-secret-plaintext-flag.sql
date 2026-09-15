-- Migration 009: mark which `connection_secrets` rows are stored as plaintext
-- bytes (UTF-8) instead of safeStorage ciphertext. The opt-in plaintext
-- fallback (issue #4) is gated behind an app-state pref and lets users on
-- hosts without an OS keychain (Linux without libsecret, primarily) save
-- password-bearing connections at all. Existing rows are encrypted, so the
-- default of 0 is correct.

ALTER TABLE connection_secrets
  ADD COLUMN is_plaintext INTEGER NOT NULL DEFAULT 0;

UPDATE schema_version SET version = 9;
