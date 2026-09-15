import { describe, it, expect, afterEach, beforeEach } from 'vitest';
import {
  ConnectionRepo,
  inputToRow,
  rowToConnection,
} from '../../electron/db/repositories/ConnectionRepo';
import { ConflictError } from '../../electron/errors';
import type { ConnectionInput } from '@shared/types';
import { createTempDb, type TempDb } from '../helpers/db';

function validInput(overrides: Partial<ConnectionInput> = {}): ConnectionInput {
  return {
    name: 'Test',
    color: '#1A6835',
    connectionType: 'standard',
    readOnly: false,
    host: 'localhost',
    port: 27017,
    authMech: 'none',
    tls: { enabled: false, verify: true },
    advanced: {
      connectTimeoutMs: 10_000,
      socketTimeoutMs: 30_000,
      serverSelectionTimeoutMs: 30_000,
      readPreference: 'primary',
      maxPoolSize: 100,
      directConnection: false,
    },
    ...overrides,
  };
}

describe('ConnectionRepo', () => {
  let tmp: TempDb;
  let repo: ConnectionRepo;

  beforeEach(() => {
    tmp = createTempDb();
    repo = new ConnectionRepo(tmp.db);
  });

  afterEach(() => {
    tmp.cleanup();
  });

  it('insert + findById round-trips', () => {
    const now = new Date().toISOString();
    const row = inputToRow('c1', validInput({ name: 'A' }), now);
    repo.insert(row);
    const fetched = repo.findById('c1');
    expect(fetched).not.toBeNull();
    expect(fetched!.name).toBe('A');
  });

  it('findByName returns the matching row or null', () => {
    const now = new Date().toISOString();
    repo.insert(inputToRow('c1', validInput({ name: 'Unique' }), now));
    expect(repo.findByName('Unique')).not.toBeNull();
    expect(repo.findByName('Other')).toBeNull();
  });

  it('duplicate name raises ConflictError', () => {
    const now = new Date().toISOString();
    repo.insert(inputToRow('c1', validInput({ name: 'Dup' }), now));
    expect(() => repo.insert(inputToRow('c2', validInput({ name: 'Dup' }), now))).toThrow(
      ConflictError,
    );
  });

  it('update modifies fields in place', () => {
    const now = new Date().toISOString();
    repo.insert(inputToRow('c1', validInput({ name: 'A' }), now));
    const row = repo.findById('c1')!;
    row.name = 'A renamed';
    row.updated_at = new Date().toISOString();
    repo.update(row);
    expect(repo.findById('c1')!.name).toBe('A renamed');
  });

  it('deleteById removes the row and returns 1', () => {
    const now = new Date().toISOString();
    repo.insert(inputToRow('c1', validInput({ name: 'A' }), now));
    expect(repo.deleteById('c1')).toBe(1);
    expect(repo.findById('c1')).toBeNull();
  });

  it('deleteById returns 0 for an unknown id', () => {
    expect(repo.deleteById('nope')).toBe(0);
  });

  it('list orders by last_used_at DESC with nulls last, then name ASC', () => {
    const now = new Date().toISOString();
    repo.insert(inputToRow('a', validInput({ name: 'A' }), now));
    repo.insert(inputToRow('b', validInput({ name: 'B' }), now));
    repo.insert(inputToRow('c', validInput({ name: 'C' }), now));

    // touch 'a' (now) and 'b' (earlier)
    tmp.db.prepare('UPDATE connections SET last_used_at = ? WHERE id = ?').run(
      '2026-04-20T12:00:00.000Z',
      'b',
    );
    tmp.db.prepare('UPDATE connections SET last_used_at = ? WHERE id = ?').run(
      '2026-04-20T15:00:00.000Z',
      'a',
    );

    const ids = repo.list().map((r) => r.id);
    expect(ids[0]).toBe('a'); // most recent
    expect(ids[1]).toBe('b');
    expect(ids[2]).toBe('c'); // null last_used_at, alphabetic
  });

  it('touchLastUsed updates last_used_at', () => {
    const now = new Date().toISOString();
    repo.insert(inputToRow('c1', validInput({ name: 'A' }), now));
    expect(repo.findById('c1')!.last_used_at).toBeNull();
    repo.touchLastUsed('c1');
    expect(repo.findById('c1')!.last_used_at).not.toBeNull();
  });

  it('rowToConnection maps all fields correctly', () => {
    const now = new Date().toISOString();
    const row = inputToRow(
      'c1',
      validInput({
        authMech: 'scram256',
        authUsername: 'alice',
        authDatabase: 'admin',
        tls: { enabled: true, verify: true, caPath: '/abs/ca.pem' },
      }),
      now,
    );
    row.last_used_at = '2026-04-20T15:00:00.000Z';
    const conn = rowToConnection(row, {
      hasPasswordStored: true,
      hasSshPasswordStored: false,
      hasSshPassphraseStored: false,
    });
    expect(conn.authMech).toBe('scram256');
    expect(conn.authUsername).toBe('alice');
    expect(conn.tls.caPath).toBe('/abs/ca.pem');
    expect(conn.hasPasswordStored).toBe(true);
    expect(conn.lastUsedAt).toBe('2026-04-20T15:00:00.000Z');
  });
});
