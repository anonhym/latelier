import { randomUUID } from 'node:crypto';
import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';
import type { AgentCallsQuery, AgentSessionsQuery } from '@shared/types';
import { AgentReadLogRepo, capRequestJson, REQUEST_JSON_MAX_BYTES, type AgentReadLogEntry } from '../../electron/db/repositories/AgentReadLogRepo';
import { AgentSessionRepo, type AgentSessionEntry } from '../../electron/db/repositories/AgentSessionRepo';
import { createTempCipher, createTempDb, cellType, type TempDb } from '../helpers/db';
import { createAgentHarness, type AgentHarness } from '../helpers/agentHarness';
import { connectAgent, textOf, type AgentConnection } from '../helpers/agentSocket';

interface LogRow {
  id: string;
  ts: string;
  token_id: string | null;
  token_name: string | null;
  client_name: string | null;
  client_version: string | null;
  connection_id: string | null;
  connection_name: string | null;
  database: string | null;
  collection: string | null;
  tool: string;
  request_json: Buffer | null;
  doc_count: number;
  bytes: number;
  duration_ms: number;
  outcome: string;
  truncated: number;
}

function entry(over: Partial<AgentReadLogEntry> = {}): AgentReadLogEntry {
  return {
    ts: new Date().toISOString(),
    tokenId: null,
    tokenName: null,
    clientName: null,
    clientVersion: null,
    connectionId: null,
    connectionName: null,
    database: null,
    collection: null,
    tool: 'find',
    requestJson: '{"filter":{"ssn":"123-45-6789"}}',
    docCount: 0,
    bytes: 0,
    durationMs: 1,
    outcome: 'ok',
    truncated: false,
    ...over,
  };
}

describe('Agent Read Log', () => {
  let h: AgentHarness | null = null;
  let agent: AgentConnection | null = null;

  afterEach(async () => {
    await agent?.close().catch(() => undefined);
    agent = null;
    await h?.cleanup();
    h = null;
  });

  async function start() {
    h = createAgentHarness();
    h.addConnection('c1', 'Orders', { shared: true, status: 'connected' });
    const { token, info } = h.svc.addToken('Claude Code, laptop');
    const path = await h.enable();
    agent = await connectAgent(path, token);
    return { h, info, agent };
  }

  const rows = (db: AgentHarness['tmp']['db']) => db.prepare('SELECT * FROM agent_read_log ORDER BY ts, rowid').all() as LogRow[];

  it('writes one row per call, refusals included, with who asked and what', async () => {
    const { h, info, agent } = await start();
    await agent.client.callTool({ name: 'list_connections', arguments: {} });
    await agent.client.callTool({ name: 'list_connections', arguments: { unexpected: 1 } });
    await agent.client.callTool({ name: 'no_such_tool', arguments: { connectionId: 'c1', database: 'shop', collection: 'orders' } });

    const log = rows(h.tmp.db);
    expect(log.map((r) => [r.tool, r.outcome])).toEqual([
      ['list_connections', 'ok'],
      ['list_connections', 'INVALID_INPUT'],
      ['no_such_tool', 'INVALID_INPUT'],
    ]);
    expect(log[0]).toMatchObject({
      token_id: info.id,
      token_name: 'Claude Code, laptop',
      client_name: 'spec-client',
      client_version: '9.9',
      connection_id: null,
      doc_count: 1,
      truncated: 0,
    });
    expect(log[0]!.bytes).toBeGreaterThan(0);
    expect(log[0]!.duration_ms).toBeGreaterThanOrEqual(0);
    // A refused call still records what it named, and the Connection's name as it was then.
    expect(log[2]).toMatchObject({ connection_id: 'c1', connection_name: 'Orders', database: 'shop', collection: 'orders', doc_count: 0 });
    expect(h.svc.sessionReadCount).toBe(3);
  });

  it('cuts what the client calls itself before it reaches a log row', async () => {
    h = createAgentHarness();
    h.addConnection('c1', 'Orders', { shared: true, status: 'connected' });
    const { token } = h.svc.addToken('Claude Code');
    const path = await h.enable();
    agent = await connectAgent(path, token, { name: 'n'.repeat(500), version: 'v'.repeat(500) });
    await agent.client.callTool({ name: 'list_connections', arguments: {} });
    const [row] = rows(h.tmp.db);
    expect(row!.client_name).toBe('n'.repeat(128));
    expect(row!.client_version).toBe('v'.repeat(128));
  });

  it('records a refused call whose token vanished under a live session, then ends the session', async () => {
    const { h, info, agent } = await start();
    // Deleted behind the service's back, so only the per-call re-check can notice.
    h.tokenRepo.deleteById(info.id);
    const result = await agent.client.callTool({ name: 'list_connections', arguments: {} });
    expect(result.isError).toBe(true);
    expect(textOf(result)).toMatch(/^ACCESS_OFF: /);
    await agent.closed;
    expect(rows(h.tmp.db).map((r) => [r.tool, r.outcome, r.token_name])).toEqual([['list_connections', 'ACCESS_OFF', 'Claude Code, laptop']]);
  });

  it('seals request_json at rest and keeps the literals out of the file', async () => {
    const { h, agent } = await start();
    await agent.client.callTool({ name: 'list_connections', arguments: { filter: { ssn: '123-45-6789' } } });
    const [row] = rows(h.tmp.db);
    expect(cellType(h.tmp.db, 'agent_read_log', 'request_json', row!.id)).toBe('blob');
    expect(row!.request_json!.includes(Buffer.from('123-45-6789'))).toBe(false);
    const cipher = createTempCipher();
    expect(cipher.open('agent_read_log', 'request_json', row!.id, row!.request_json!)).toBe('{"filter":{"ssn":"123-45-6789"}}');
  });

  it('survives the deletion of its Connection and its token', async () => {
    const { h, info, agent } = await start();
    await agent.client.callTool({ name: 'list_connections', arguments: { connectionId: 'c1' } });
    h.tmp.db.prepare("DELETE FROM connections WHERE id = 'c1'").run();
    h.tokenRepo.deleteById(info.id);
    const [row] = rows(h.tmp.db);
    expect(row).toMatchObject({ connection_id: 'c1', connection_name: 'Orders', token_id: info.id, token_name: 'Claude Code, laptop' });
  });

  it('fails closed: a row that cannot be written returns DB_ERROR and no data', async () => {
    const { h, agent } = await start();
    vi.spyOn(h.readLogRepo, 'insert').mockImplementation(() => {
      throw new Error('disk full: Orders');
    });
    const result = await agent.client.callTool({ name: 'list_connections', arguments: {} });
    expect(result.isError).toBe(true);
    expect(result.structuredContent).toBeUndefined();
    const text = textOf(result);
    expect(text).toMatch(/^DB_ERROR: /);
    expect(text).not.toContain('Orders');
    expect(text).not.toContain('disk full');
    expect(h.svc.sessionReadCount).toBe(0);
    expect(h.log.error).toHaveBeenCalledWith('agent', expect.stringContaining('Agent Read Log'), expect.anything());
  });

  it('counts a read only once its row is written', async () => {
    const { h, agent } = await start();
    await agent.client.callTool({ name: 'list_connections', arguments: {} });
    expect(h.svc.sessionReadCount).toBe(1);
  });

  it('prunes rows older than 90 days and keeps the rest', () => {
    h = createAgentHarness();
    const day = 86_400_000;
    h.readLogRepo.insert(entry({ ts: new Date(Date.now() - 91 * day).toISOString() }));
    h.readLogRepo.insert(entry({ ts: new Date(Date.now() - 89 * day).toISOString() }));
    expect(h.readLogRepo.deleteOlderThan(90)).toBe(1);
    expect(h.readLogRepo.count()).toBe(1);
  });

  it('rejects an outcome that is not ok or a known code, and writes nothing', () => {
    h = createAgentHarness();
    expect(() => h!.readLogRepo.insert(entry({ outcome: 'MADE_UP' as never }))).toThrow(/outcome/);
    expect(h.readLogRepo.count()).toBe(0);
  });

  it('stores a null request as null and an object request sealed', () => {
    h = createAgentHarness();
    const none = h.readLogRepo.insert(entry({ requestJson: null }));
    expect(cellType(h.tmp.db, 'agent_read_log', 'request_json', none)).toBe('null');
    const some = h.readLogRepo.insert(entry());
    expect(cellType(h.tmp.db, 'agent_read_log', 'request_json', some)).toBe('blob');
  });

  it('refuses a plaintext cell planted in request_json', () => {
    h = createAgentHarness();
    const id = h.readLogRepo.insert(entry());
    h.tmp.db.prepare('UPDATE agent_read_log SET request_json = ? WHERE id = ?').run('planted', id);
    const planted = h.tmp.db.prepare('SELECT request_json FROM agent_read_log WHERE id = ?').get(id) as { request_json: string };
    expect(() => createTempCipher().open('agent_read_log', 'request_json', id, planted.request_json)).toThrow(/decrypted/);
  });
});

describe('capRequestJson', () => {
  it('leaves a request of up to 16 KiB alone', () => {
    const exact = JSON.stringify({ a: 'x'.repeat(REQUEST_JSON_MAX_BYTES - 8) });
    expect(Buffer.byteLength(exact)).toBe(REQUEST_JSON_MAX_BYTES);
    expect(capRequestJson(exact)).toBe(exact);
  });

  it('replaces a larger request with a marker holding its size and head', () => {
    const big = JSON.stringify({ a: 'y'.repeat(REQUEST_JSON_MAX_BYTES) });
    const capped = JSON.parse(capRequestJson(big)) as { truncated: boolean; bytes: number; head: string };
    expect(capped.truncated).toBe(true);
    expect(capped.bytes).toBe(Buffer.byteLength(big));
    expect(capped.head).toBe(big.slice(0, 16_000));
  });

  it('keeps the marker under the cap even when the head is full of characters JSON must escape', () => {
    const big = JSON.stringify({ a: '"\\\n'.repeat(REQUEST_JSON_MAX_BYTES) });
    const capped = capRequestJson(big);
    expect(Buffer.byteLength(capped)).toBeLessThanOrEqual(REQUEST_JSON_MAX_BYTES);
    const parsed = JSON.parse(capped) as { truncated: boolean; bytes: number; head: string };
    expect(parsed.truncated).toBe(true);
    expect(parsed.bytes).toBe(Buffer.byteLength(big));
    expect(big.startsWith(parsed.head)).toBe(true);
  });

  it('counts bytes, not characters', () => {
    const wide = 'é'.repeat(REQUEST_JSON_MAX_BYTES / 2);
    expect(wide.length).toBe(REQUEST_JSON_MAX_BYTES / 2);
    expect(JSON.parse(capRequestJson(wide + 'é')).truncated).toBe(true);
  });
});

describe('AgentReadLogRepo.insert size cap', () => {
  it('stores an oversized request as the marker', () => {
    const h = createAgentHarness();
    try {
      const repo = new AgentReadLogRepo(h.tmp.db, createTempCipher());
      const id = repo.insert(entry({ requestJson: JSON.stringify({ pipeline: 'z'.repeat(40_000) }) }));
      const cell = (h.tmp.db.prepare('SELECT request_json FROM agent_read_log WHERE id = ?').get(id) as { request_json: Buffer }).request_json;
      const plain = createTempCipher().open('agent_read_log', 'request_json', id, cell);
      expect(Buffer.byteLength(plain)).toBeLessThanOrEqual(REQUEST_JSON_MAX_BYTES);
      expect(JSON.parse(plain)).toMatchObject({ truncated: true });
    } finally {
      void h.cleanup();
    }
  });
});

describe('AgentReadLogRepo.listCalls', () => {
  let tmp: TempDb;
  let repo: AgentReadLogRepo;

  beforeEach(() => {
    tmp = createTempDb();
    repo = new AgentReadLogRepo(tmp.db, createTempCipher());
  });
  afterEach(() => tmp.cleanup());

  const all = (over: Partial<AgentCallsQuery> = {}) => repo.listCalls({ outcome: 'all', limit: 200, ...over });

  it('returns every column, camelCase, with the session and the request opened for this answer', () => {
    const id = repo.insert(
      entry({
        sessionId: 's1',
        ts: '2026-11-27T10:00:00.000Z',
        tokenId: 't1',
        tokenName: 'Claude',
        clientName: 'claude-code',
        clientVersion: '2.1',
        connectionId: 'c1',
        connectionName: 'prod',
        database: 'shop',
        collection: 'orders',
        tool: 'find',
        docCount: 3,
        bytes: 120,
        durationMs: 9,
        truncated: true,
      }),
    );
    expect(all()).toEqual([
      {
        id,
        sessionId: 's1',
        ts: '2026-11-27T10:00:00.000Z',
        tokenId: 't1',
        tokenName: 'Claude',
        clientName: 'claude-code',
        clientVersion: '2.1',
        connectionId: 'c1',
        connectionName: 'prod',
        database: 'shop',
        collection: 'orders',
        tool: 'find',
        docCount: 3,
        bytes: 120,
        durationMs: 9,
        outcome: 'ok',
        truncated: true,
        request: '{"filter":{"ssn":"123-45-6789"}}',
        requestTruncated: false,
      },
    ]);
    // Still sealed at rest: only the answer holds the text.
    expect(cellType(tmp.db, 'agent_read_log', 'request_json', id)).toBe('blob');
  });

  it('gives a row written outside a session a null session, and a null request as null', () => {
    repo.insert(entry({ requestJson: null }));
    expect(all()).toEqual([expect.objectContaining({ sessionId: null, request: null, requestTruncated: false })]);
  });

  it('flags a request stored as the over-cap marker', () => {
    repo.insert(entry({ requestJson: JSON.stringify({ pipeline: 'z'.repeat(40_000) }) }));
    const [row] = all();
    expect(row!.requestTruncated).toBe(true);
    expect(JSON.parse(row!.request!)).toMatchObject({ truncated: true });
  });

  it('does not flag an Agent request that merely says truncated', () => {
    repo.insert(entry({ requestJson: '{"truncated":true,"bytes":99999,"head":"x","x":1}' }));
    expect(all()[0]!.requestTruncated).toBe(false);
  });

  it('reads a request that cannot be opened as none, and keeps the other rows', () => {
    const good = repo.insert(entry({ ts: '2026-11-27T10:00:01.000Z' }));
    const bad = repo.insert(entry({ ts: '2026-11-27T10:00:00.000Z' }));
    // A cell sealed for another row: authentic, but bound to the wrong id.
    const other = (tmp.db.prepare('SELECT request_json FROM agent_read_log WHERE id = ?').get(good) as { request_json: Buffer }).request_json;
    tmp.db.prepare('UPDATE agent_read_log SET request_json = ? WHERE id = ?').run(other, bad);
    expect(all().map((r) => [r.id, r.request === null])).toEqual([
      [good, false],
      [bad, true],
    ]);
  });

  it('filters by session, token, Connection, database, collection and tool', () => {
    const base = { ts: '2026-11-27T10:00:00.000Z' };
    const a = repo.insert(entry({ ...base, sessionId: 's1', tokenId: 't1', connectionId: 'c1', database: 'd1', collection: 'k1', tool: 'find' }));
    const b = repo.insert(entry({ ...base, sessionId: 's2', tokenId: 't2', connectionId: 'c2', database: 'd2', collection: 'k2', tool: 'count' }));
    const ids = (q: Partial<AgentCallsQuery>) => all(q).map((r) => r.id);
    expect(ids({ sessionId: 's1' })).toEqual([a]);
    expect(ids({ tokenId: 't2' })).toEqual([b]);
    expect(ids({ connectionId: 'c1' })).toEqual([a]);
    expect(ids({ database: 'd2' })).toEqual([b]);
    expect(ids({ collection: 'k1' })).toEqual([a]);
    expect(ids({ tool: 'count' })).toEqual([b]);
    expect(ids({ database: 'd1', collection: 'k2' })).toEqual([]);
    expect(ids({}).sort((x, y) => x.localeCompare(y))).toEqual([a, b].sort((x, y) => x.localeCompare(y)));
  });

  it('filters ok and refused; the asking round of a paused call is neither', () => {
    const ok = repo.insert(entry({ ts: '2026-11-27T10:00:03.000Z', outcome: 'ok' }));
    const notOpen = repo.insert(entry({ ts: '2026-11-27T10:00:02.000Z', outcome: 'NOT_OPEN' }));
    const asking = repo.insert(entry({ ts: '2026-11-27T10:00:01.000Z', outcome: 'INPUT_REQUIRED' }));
    const off = repo.insert(entry({ ts: '2026-11-27T10:00:00.000Z', outcome: 'ACCESS_OFF' }));
    expect(all({ outcome: 'ok' }).map((r) => r.id)).toEqual([ok]);
    expect(all({ outcome: 'refused' }).map((r) => r.id)).toEqual([notOpen, off]);
    expect(all({ outcome: 'all' }).map((r) => r.id)).toEqual([ok, notOpen, asking, off]);
  });

  it('pages newest first on (ts, id) with no gap and no repeat, rows sharing a ts included', () => {
    const ids: string[] = [];
    for (let i = 0; i < 25; i++) {
      // Five rows per timestamp, so most page edges fall inside a run of equal ts.
      ids.push(repo.insert(entry({ ts: new Date(Date.UTC(2026, 10, 27, 10, 0, Math.floor(i / 5))).toISOString() })));
    }
    const seen: string[] = [];
    let before: AgentCallsQuery['before'];
    for (;;) {
      const page = repo.listCalls({ outcome: 'all', limit: 7, ...(before ? { before } : {}) });
      seen.push(...page.map((r) => r.id));
      if (page.length < 7) break;
      const last = page.at(-1)!;
      before = { ts: last.ts, id: last.id };
    }
    const expected = tmp.db.prepare('SELECT id FROM agent_read_log ORDER BY ts DESC, id DESC').all() as { id: string }[];
    expect(seen).toEqual(expected.map((r) => r.id));
    expect(new Set(seen).size).toBe(25);
  });

  it('caps the page at the limit', () => {
    for (let i = 0; i < 5; i++) repo.insert(entry());
    expect(repo.listCalls({ outcome: 'all', limit: 2 })).toHaveLength(2);
  });
});

describe('AgentSessionRepo', () => {
  let tmp: TempDb;
  let repo: AgentSessionRepo;
  let logRepo: AgentReadLogRepo;

  beforeEach(() => {
    tmp = createTempDb();
    repo = new AgentSessionRepo(tmp.db, createTempCipher());
    logRepo = new AgentReadLogRepo(tmp.db, createTempCipher());
  });
  afterEach(() => tmp.cleanup());

  const session = (over: Partial<AgentSessionEntry> = {}): AgentSessionEntry => ({
    id: randomUUID(),
    tokenId: 't1',
    tokenName: 'Claude',
    clientName: null,
    clientVersion: null,
    folder: '/Users/ann/Projects/shop',
    startedAt: '2026-11-27T10:00:00.000Z',
    ...over,
  });

  it('stores the folder sealed and opens it on read', () => {
    const s = session();
    repo.insert(s);
    expect(cellType(tmp.db, 'agent_sessions', 'folder', s.id)).toBe('blob');
    const raw = (tmp.db.prepare('SELECT folder FROM agent_sessions WHERE id = ?').get(s.id) as { folder: Buffer }).folder;
    expect(raw.toString('latin1')).not.toContain('shop');
    expect(repo.findById(s.id)).toMatchObject({ id: s.id, folder: '/Users/ann/Projects/shop', endedAt: null, endReason: null });
  });

  it('stores no folder as null', () => {
    const s = session({ folder: null });
    repo.insert(s);
    expect(cellType(tmp.db, 'agent_sessions', 'folder', s.id)).toBe('null');
    expect(repo.findById(s.id)?.folder).toBeNull();
    expect(repo.findById('nope')).toBeNull();
  });

  it('refuses a plaintext folder planted in the sealed column', () => {
    const s = session();
    repo.insert(s);
    tmp.db.prepare("UPDATE agent_sessions SET folder = '/planted' WHERE id = ?").run(s.id);
    expect(() => repo.findById(s.id)).toThrow();
  });

  it('throws when the row cannot be written, so the caller can refuse the session', () => {
    const s = session();
    repo.insert(s);
    expect(() => repo.insert(s)).toThrow(/UNIQUE/);
  });

  it('writes client info once', () => {
    const s = session();
    repo.insert(s);
    expect(repo.setClientInfoOnce(s.id, 'claude-code', '2.1')).toBe(true);
    expect(repo.setClientInfoOnce(s.id, 'other', '9')).toBe(false);
    expect(repo.findById(s.id)).toMatchObject({ clientName: 'claude-code', clientVersion: '2.1' });
    const named = session({ clientName: 'cursor', clientVersion: null });
    repo.insert(named);
    expect(repo.setClientInfoOnce(named.id, 'other', '9')).toBe(false);
    const versioned = session({ clientName: null, clientVersion: '1' });
    repo.insert(versioned);
    expect(repo.setClientInfoOnce(versioned.id, 'other', '9')).toBe(false);
  });

  it('closes once: the first reason stays', () => {
    const s = session();
    repo.insert(s);
    expect(repo.close(s.id, '2026-11-27T11:00:00.000Z', 'user-ended')).toBe(true);
    expect(repo.close(s.id, '2026-11-27T12:00:00.000Z', 'client-closed')).toBe(false);
    expect(repo.findById(s.id)).toMatchObject({ endedAt: '2026-11-27T11:00:00.000Z', endReason: 'user-ended' });
  });

  it('closes every row a crash left open as unknown, and leaves closed ones alone', () => {
    const open1 = session();
    const open2 = session();
    const done = session();
    for (const s of [open1, open2, done]) repo.insert(s);
    repo.close(done.id, '2026-11-27T11:00:00.000Z', 'app-quit');
    expect(repo.closeOrphans('2026-11-28T08:00:00.000Z')).toBe(2);
    expect(repo.findById(open1.id)).toMatchObject({ endedAt: '2026-11-28T08:00:00.000Z', endReason: 'unknown' });
    expect(repo.findById(done.id)).toMatchObject({ endedAt: '2026-11-27T11:00:00.000Z', endReason: 'app-quit' });
  });

  it('prunes sessions that ended over 90 days ago; a live session is never pruned', () => {
    const day = 86_400_000;
    const iso = (ms: number) => new Date(ms).toISOString();
    const old = session({ startedAt: iso(Date.now() - 200 * day) });
    const recent = session({ startedAt: iso(Date.now() - 200 * day) });
    const live = session({ startedAt: iso(Date.now() - 200 * day) });
    for (const s of [old, recent, live]) repo.insert(s);
    repo.close(old.id, iso(Date.now() - 91 * day), 'client-closed');
    repo.close(recent.id, iso(Date.now() - 89 * day), 'client-closed');
    expect(repo.deleteEndedOlderThan(90)).toBe(1);
    expect(repo.findById(old.id)).toBeNull();
    expect(repo.findById(recent.id)).not.toBeNull();
    expect(repo.findById(live.id)).not.toBeNull();
  });

  it('counts calls and refusals per session; the asking round counts as neither', () => {
    const s = session();
    repo.insert(s);
    for (const [outcome, ts] of [
      ['ok', '2026-11-27T10:00:01.000Z'],
      ['INPUT_REQUIRED', '2026-11-27T10:00:05.000Z'],
      ['NOT_OPEN', '2026-11-27T10:00:02.000Z'],
      ['ok', '2026-11-27T10:00:03.000Z'],
    ] as const) {
      logRepo.insert(entry({ sessionId: s.id, outcome, ts }));
    }
    logRepo.insert(entry({ sessionId: 'another', outcome: 'ok' }));
    expect(repo.findById(s.id)).toMatchObject({ callCount: 3, refusedCount: 1, lastCallAt: '2026-11-27T10:00:03.000Z' });
    expect(repo.list({ includeEnded: true, limit: 10 })[0]).toMatchObject({ callCount: 3, refusedCount: 1 });
  });

  it('a session with no calls has zero counts and no last call', () => {
    const s = session();
    repo.insert(s);
    expect(repo.findById(s.id)).toMatchObject({ callCount: 0, refusedCount: 0, lastCallAt: null });
  });

  it('lists live sessions only unless ended ones are asked for, and filters by token', () => {
    const live = session({ tokenId: 't1' });
    const ended = session({ tokenId: 't1' });
    const otherToken = session({ tokenId: 't2' });
    for (const s of [live, ended, otherToken]) repo.insert(s);
    repo.close(ended.id, '2026-11-27T11:00:00.000Z', 'client-closed');
    const ids = (q: AgentSessionsQuery) => repo.list(q).map((r) => r.id).sort((a, b) => a.localeCompare(b));
    expect(ids({ includeEnded: false, limit: 10 })).toEqual([live.id, otherToken.id].sort((a, b) => a.localeCompare(b)));
    expect(ids({ includeEnded: true, tokenId: 't1', limit: 10 })).toEqual([live.id, ended.id].sort((a, b) => a.localeCompare(b)));
  });

  it('pages past 200 sessions of one token on (started_at, id), sessions sharing a start included', () => {
    for (let i = 0; i < 230; i++) {
      // Ten sessions per start time.
      repo.insert(session({ startedAt: new Date(Date.UTC(2026, 10, 27, 10, 0, Math.floor(i / 10))).toISOString() }));
    }
    const seen: string[] = [];
    let before: AgentSessionsQuery['before'];
    for (;;) {
      const page = repo.list({ tokenId: 't1', includeEnded: true, limit: 200, ...(before ? { before } : {}) });
      seen.push(...page.map((r) => r.id));
      if (page.length < 200) break;
      const last = page.at(-1)!;
      before = { startedAt: last.startedAt, id: last.id };
    }
    const expected = tmp.db.prepare('SELECT id FROM agent_sessions ORDER BY started_at DESC, id DESC').all() as { id: string }[];
    expect(seen).toEqual(expected.map((r) => r.id));
    expect(new Set(seen).size).toBe(230);
  });

  it('reads a listed folder that cannot be opened as none, and keeps the row', () => {
    const a = session();
    const b = session({ startedAt: '2026-11-27T09:00:00.000Z' });
    repo.insert(a);
    repo.insert(b);
    const cellA = (tmp.db.prepare('SELECT folder FROM agent_sessions WHERE id = ?').get(a.id) as { folder: Buffer }).folder;
    tmp.db.prepare('UPDATE agent_sessions SET folder = ? WHERE id = ?').run(cellA, b.id);
    expect(repo.list({ includeEnded: true, limit: 10 }).map((r) => [r.id, r.folder])).toEqual([
      [a.id, '/Users/ann/Projects/shop'],
      [b.id, null],
    ]);
  });
});
