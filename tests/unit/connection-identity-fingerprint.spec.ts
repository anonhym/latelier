import { describe, it, expect } from 'vitest';
import {
  connectionIdentityFingerprint,
  inputToRow,
  mongoRelevantFieldsChanged,
} from '../../electron/db/repositories/ConnectionRepo';
import type { ConnectionInput } from '../../shared/types';

function input(overrides: Partial<ConnectionInput> = {}): ConnectionInput {
  return {
    name: 'A',
    color: '#1A6835',
    connectionType: 'standard',
    readOnly: false,
    host: 'localhost',
    port: 27017,
    authMech: 'scram256',
    authUsername: 'alice',
    authDatabase: 'admin',
    defaultDb: 'app',
    tls: { enabled: false, verify: true, caPath: '/ca.pem', clientCertPath: '/client.pem' },
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

const base = input();
const adv = (change: Partial<ConnectionInput['advanced']>): Partial<ConnectionInput> => ({ advanced: { ...base.advanced, ...change } });
const tls = (change: Partial<ConnectionInput['tls']>): Partial<ConnectionInput> => ({ tls: { ...base.tls, ...change } });

// Every field `mongoRelevantFieldsChanged` compares, and fields it does not.
const changes: Array<[string, Partial<ConnectionInput>, boolean]> = [
  ['connectionType', { connectionType: 'srv' }, true],
  ['host', { host: 'other' }, true],
  ['port', { port: 1 }, true],
  ['defaultDb', { defaultDb: 'other' }, true],
  ['authMech', { authMech: 'none' }, true],
  ['authUsername', { authUsername: 'bob' }, true],
  ['authDatabase', { authDatabase: 'other' }, true],
  ['tls.enabled', tls({ enabled: true }), true],
  ['tls.verify', tls({ verify: false }), true],
  ['tls.caPath', tls({ caPath: '/other.pem' }), true],
  ['tls.clientCertPath', tls({ clientCertPath: '/other.pem' }), true],
  ['connectTimeoutMs', adv({ connectTimeoutMs: 1 }), true],
  ['socketTimeoutMs', adv({ socketTimeoutMs: 1 }), true],
  ['serverSelectionTimeoutMs', adv({ serverSelectionTimeoutMs: 1 }), true],
  ['maxPoolSize', adv({ maxPoolSize: 1 }), true],
  ['readPreference', adv({ readPreference: 'secondary' }), true],
  ['directConnection', adv({ directConnection: true }), true],
  ['name', { name: 'B' }, false],
  ['color', { color: '#000000' }, false],
  ['readOnly', { readOnly: true }, false],
];

describe('connectionIdentityFingerprint', () => {
  const row = inputToRow('id', base, '2026-01-01T00:00:00.000Z');

  it.each(changes)('moves with the predicate for %s', (_field, change, identity) => {
    const next = inputToRow('id', input(change), '2026-01-01T00:00:00.000Z');
    expect(mongoRelevantFieldsChanged(row, input(change))).toBe(identity);
    expect(connectionIdentityFingerprint(next) !== connectionIdentityFingerprint(row)).toBe(identity);
  });

  it('is stable for the same row', () => {
    expect(connectionIdentityFingerprint(row)).toBe(connectionIdentityFingerprint({ ...row, updated_at: 'later', last_used_at: 'now' }));
  });
});
