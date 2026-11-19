import { describe, it, expect, afterEach, vi } from 'vitest';
import { AgentReadLogRepo, capRequestJson, REQUEST_JSON_MAX_BYTES, type AgentReadLogEntry } from '../../electron/db/repositories/AgentReadLogRepo';
import { createTempCipher, cellType } from '../helpers/db';
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
