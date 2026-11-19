import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { ConnectionRepo, inputToRow, rowToConnection } from '../../electron/db/repositories/ConnectionRepo';
import type { ConnectionInput } from '@shared/types';
import { createTempDb, insertConnectionRow, type TempDb } from '../helpers/db';

const input: ConnectionInput = {
  name: 'A',
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
};

describe('migration 020: Agent Access', () => {
  let tmp: TempDb;

  beforeEach(() => {
    tmp = createTempDb();
  });
  afterEach(() => tmp.cleanup());

  it('creates the two tables and the log index, and records version 20', () => {
    const names = (tmp.db.prepare("SELECT name FROM sqlite_master WHERE type IN ('table','index')").all() as { name: string }[]).map((r) => r.name);
    expect(names).toEqual(expect.arrayContaining(['agent_tokens', 'agent_read_log', 'idx_agent_read_log_ts']));
    expect((tmp.db.prepare('SELECT version FROM schema_version').get() as { version: number }).version).toBe(20);
  });

  it('adds share_with_agents defaulting to 0 for an existing row', () => {
    insertConnectionRow(tmp.db, 'c1');
    const row = tmp.db.prepare('SELECT share_with_agents FROM connections WHERE id = ?').get('c1') as { share_with_agents: number };
    expect(row.share_with_agents).toBe(0);
  });

  it('refuses a share flag outside 0 and 1', () => {
    insertConnectionRow(tmp.db, 'c1');
    expect(() => tmp.db.prepare('UPDATE connections SET share_with_agents = 2').run()).toThrow(/CHECK/);
  });

  it('refuses an empty or over-long token name and a repeated hash', () => {
    const insert = (id: string, name: string, hash: string) =>
      tmp.db.prepare('INSERT INTO agent_tokens (id, name, token_hash, created_at) VALUES (?, ?, ?, ?)').run(id, name, hash, 'now');
    expect(() => insert('a', '', 'h1')).toThrow(/CHECK/);
    expect(() => insert('a', 'x'.repeat(65), 'h1')).toThrow(/CHECK/);
    insert('a', 'x'.repeat(64), 'h1');
    expect(() => insert('b', 'other', 'h1')).toThrow(/UNIQUE/);
  });

  it('has no foreign keys on the read log, so a row outlives its Connection and token', () => {
    expect(tmp.db.prepare("PRAGMA foreign_key_list('agent_read_log')").all()).toEqual([]);
    insertConnectionRow(tmp.db, 'c1');
    tmp.db
      .prepare("INSERT INTO agent_read_log (id, ts, connection_id, tool, duration_ms, outcome) VALUES ('r', ?, 'c1', 'find', 1, 'ok')")
      .run(new Date().toISOString());
    tmp.db.prepare("DELETE FROM connections WHERE id = 'c1'").run();
    expect((tmp.db.prepare('SELECT COUNT(*) AS n FROM agent_read_log').get() as { n: number }).n).toBe(1);
  });
});

describe('the share flag on ConnectionRepo', () => {
  let tmp: TempDb;
  let repo: ConnectionRepo;

  beforeEach(() => {
    tmp = createTempDb();
    repo = new ConnectionRepo(tmp.db);
  });
  afterEach(() => tmp.cleanup());

  const flag = (id: string) => repo.findById(id)!.share_with_agents;

  it('is off after an insert, and rowToConnection reads it as false', () => {
    repo.insert(inputToRow('c1', input, new Date().toISOString()));
    expect(flag('c1')).toBe(0);
    const conn = rowToConnection(repo.findById('c1')!, { hasPasswordStored: false, hasSshPasswordStored: false, hasSshPassphraseStored: false });
    expect(conn.shareWithAgents).toBe(false);
  });

  it('setShared turns it on and off, and reports whether a row matched', () => {
    repo.insert(inputToRow('c1', input, new Date().toISOString()));
    expect(repo.setShared('c1', true)).toBe(true);
    expect(flag('c1')).toBe(1);
    expect(rowToConnection(repo.findById('c1')!, { hasPasswordStored: false, hasSshPasswordStored: false, hasSshPassphraseStored: false }).shareWithAgents).toBe(true);
    expect(repo.setShared('c1', false)).toBe(true);
    expect(flag('c1')).toBe(0);
    expect(repo.setShared('missing', true)).toBe(false);
  });

  it('an ordinary update leaves the flag as it was, even when the row carries a value for it', () => {
    repo.insert(inputToRow('c1', input, new Date().toISOString()));
    repo.setShared('c1', true);
    repo.update(inputToRow('c1', { ...input, name: 'Renamed' }, new Date().toISOString()));
    expect(flag('c1')).toBe(1);
    repo.update({ ...inputToRow('c1', input, new Date().toISOString()), share_with_agents: 0 });
    expect(flag('c1')).toBe(1);
  });

  it('an insert cannot set the flag even when the row carries one', () => {
    repo.insert({ ...inputToRow('c1', input, new Date().toISOString()), share_with_agents: 1 });
    expect(flag('c1')).toBe(0);
  });

  it('listShared returns only shared Connections, by name', () => {
    const now = new Date().toISOString();
    repo.insert(inputToRow('c1', { ...input, name: 'Zed' }, now));
    repo.insert(inputToRow('c2', { ...input, name: 'Alpha' }, now));
    repo.insert(inputToRow('c3', { ...input, name: 'Hidden' }, now));
    repo.setShared('c1', true);
    repo.setShared('c2', true);
    expect(repo.listShared().map((r) => r.name)).toEqual(['Alpha', 'Zed']);
  });
});
