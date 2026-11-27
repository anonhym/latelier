import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createTempDb, type TempDb } from '../helpers/db';

describe('migration 021: Agent sessions', () => {
  let tmp: TempDb;

  beforeEach(() => {
    tmp = createTempDb();
  });
  afterEach(() => tmp.cleanup());

  const names = () =>
    (tmp.db.prepare("SELECT name FROM sqlite_master WHERE type IN ('table','index')").all() as { name: string }[]).map((r) => r.name);

  it('creates the sessions table and its indexes, and records version 21', () => {
    expect(names()).toEqual(
      expect.arrayContaining([
        'agent_sessions',
        'idx_agent_sessions_token',
        'idx_agent_sessions_open',
        'idx_agent_read_log_session',
        'idx_agent_read_log_conn',
      ]),
    );
    expect((tmp.db.prepare('SELECT version FROM schema_version').get() as { version: number }).version).toBe(21);
  });

  it('adds a nullable session_id to the read log', () => {
    const cols = tmp.db.prepare("PRAGMA table_info('agent_read_log')").all() as Array<{ name: string; notnull: number }>;
    expect(cols.find((c) => c.name === 'session_id')).toMatchObject({ notnull: 0 });
    tmp.db
      .prepare("INSERT INTO agent_read_log (id, ts, tool, duration_ms, outcome) VALUES ('r', ?, 'find', 1, 'ok')")
      .run(new Date().toISOString());
    expect(tmp.db.prepare("SELECT session_id FROM agent_read_log WHERE id = 'r'").get()).toEqual({ session_id: null });
  });

  it('accepts each end reason and null, and refuses any other', () => {
    const insert = tmp.db.prepare('INSERT INTO agent_sessions (id, started_at, end_reason) VALUES (?, ?, ?)');
    const now = new Date().toISOString();
    for (const reason of ['client-closed', 'user-ended', 'token-revoked', 'access-off', 'app-quit', 'unknown', null]) {
      insert.run(`s-${String(reason)}`, now, reason);
    }
    expect(() => insert.run('bad', now, 'crashed')).toThrow(/CHECK/);
  });

  it('needs a start time', () => {
    expect(() => tmp.db.prepare("INSERT INTO agent_sessions (id) VALUES ('s')").run()).toThrow(/NOT NULL/);
  });

  it('has no foreign keys, so a session outlives its token', () => {
    expect(tmp.db.prepare("PRAGMA foreign_key_list('agent_sessions')").all()).toEqual([]);
  });
});
