import { describe, it, expect, afterEach, vi } from 'vitest';
import net from 'node:net';
import { createAgentHarness, type AgentHarness } from '../helpers/agentHarness';
import { createReadFixture, docsIn, type ReadFixture } from '../helpers/agentFixture';
import {
  connectAgent,
  envelopeBody,
  handshakeLine,
  openSocket,
  readUntilClosed,
  textOf,
  type AgentConnection,
  type ConnectAgentOptions,
  type ElicitAnswer,
} from '../helpers/agentSocket';
import { MAX_MESSAGE_BYTES } from '../../electron/agent/AgentSession';
import { SERVER_INSTRUCTIONS } from '../../electron/agent/tools';

const MODERN = '2026-07-28';
const FORM = { elicitation: { form: {} } };
const CLOSED_ID = '2b1f6a3e-6f0e-4c1e-9b7a-0d6f7b5e9a11';

interface LogRow {
  tool: string;
  outcome: string;
  doc_count: number;
  bytes: number;
  client_name: string | null;
  client_version: string | null;
}

type JsonRpc = { id?: number; result?: Record<string, unknown>; error?: { code: number; message: string } };

/** A raw socket after the handshake, for requests the SDK client would never send in that shape. */
async function rawSession(socketPath: string, token: string) {
  const socket = await openSocket(socketPath);
  const replies = new Map<number, (m: JsonRpc) => void>();
  let buffer = '';
  socket.on('data', (c: Buffer) => {
    buffer += c.toString('utf8');
    for (let nl = buffer.indexOf('\n'); nl >= 0; nl = buffer.indexOf('\n')) {
      const message = JSON.parse(buffer.slice(0, nl)) as JsonRpc;
      buffer = buffer.slice(nl + 1);
      if (typeof message.id === 'number') replies.get(message.id)?.(message);
    }
  });
  socket.write(handshakeLine(token));
  return {
    socket,
    request(id: number, method: string, params: Record<string, unknown>): Promise<JsonRpc> {
      const reply = new Promise<JsonRpc>((resolve) => replies.set(id, resolve));
      socket.write(`${JSON.stringify({ jsonrpc: '2.0', id, method, params })}\n`);
      return reply;
    },
  };
}

/** The per-request envelope of the 2026-07-28 era. */
function envelope(extra: Record<string, unknown> = {}) {
  return {
    _meta: {
      'io.modelcontextprotocol/protocolVersion': MODERN,
      'io.modelcontextprotocol/clientCapabilities': {},
      ...extra,
    },
  };
}

describe('Agent Access on MCP 2026-07-28 (X29)', () => {
  let h: AgentHarness;
  const agents: AgentConnection[] = [];
  const sockets: net.Socket[] = [];

  afterEach(async () => {
    for (const a of agents.splice(0)) await a.close().catch(() => undefined);
    for (const s of sockets.splice(0)) s.destroy();
    await h?.cleanup();
  });

  async function start() {
    h = createAgentHarness();
    const added = h.svc.addToken('Claude Code');
    const socketPath = await h.enable();
    return { socketPath, token: added.token, tokenId: added.info.id };
  }

  async function agentFor(socketPath: string, token: string, options: ConnectAgentOptions = {}, clientInfo = { name: 'spec-client', version: '9.9' }) {
    const a = await connectAgent(socketPath, token, clientInfo, options);
    agents.push(a);
    return a;
  }

  const rows = () =>
    h.tmp.db
      .prepare('SELECT tool, outcome, doc_count, bytes, client_name, client_version FROM agent_read_log ORDER BY ts, rowid')
      .all() as LogRow[];

  /** An elicitation handler that records every question and gives one answer. */
  function answering(action: 'accept' | 'decline' | 'cancel', before?: () => void | Promise<void>) {
    const asked: string[] = [];
    const onElicit: ElicitAnswer = async (params) => {
      asked.push(params.message);
      await before?.();
      return { action };
    };
    return { asked, onElicit };
  }

  const findOn = (connectionId: string) => ({ name: 'find', arguments: { connectionId, database: 'd', collection: 'c' } });

  describe('era negotiation', () => {
    it('answers server/discover with the instructions and the 2026-07-28 revision', async () => {
      const { socketPath, token } = await start();
      const raw = await rawSession(socketPath, token);
      sockets.push(raw.socket);
      const reply = await raw.request(1, 'server/discover', envelope());
      expect(reply.result?.instructions).toBe(SERVER_INSTRUCTIONS);
      expect(reply.result?.supportedVersions).toContain(MODERN);
    });

    it('lists the same tools, annotations included, in both eras', async () => {
      const { socketPath, token } = await start();
      const legacy = await agentFor(socketPath, token);
      const modern = await agentFor(socketPath, token, { modern: true });
      expect(modern.client.getNegotiatedProtocolVersion()).toBe(MODERN);
      expect(legacy.client.getNegotiatedProtocolVersion()).not.toBe(MODERN);
      const modernTools = (await modern.client.listTools()).tools;
      expect(modernTools).toHaveLength(10);
      expect(modernTools).toEqual((await legacy.client.listTools()).tools);
      expect(modern.client.getInstructions()).toBe(SERVER_INSTRUCTIONS);
    });

    it('returns the same tool result in both eras', async () => {
      const { socketPath, token } = await start();
      h.addConnection(CLOSED_ID, 'prod', { shared: true });
      const legacy = await agentFor(socketPath, token);
      const modern = await agentFor(socketPath, token, { modern: true });
      const call = { name: 'list_connections', arguments: {} };
      const body = async (a: AgentConnection) => JSON.parse(envelopeBody(textOf(await a.client.callTool(call)))) as unknown;
      expect(await body(modern)).toEqual(await body(legacy));
    });

    it('keeps a discovery-only probe out of the Read Log, presence and every log line above debug', async () => {
      const { socketPath, token } = await start();
      const levels = ['info', 'warn', 'error'] as const;
      const before = levels.map((level) => vi.mocked(h.log[level]).mock.calls.length);
      const raw = await rawSession(socketPath, token);
      await raw.request(1, 'server/discover', envelope());
      const closed = new Promise<void>((resolve) => raw.socket.once('close', () => resolve()));
      raw.socket.end();
      await closed;
      await new Promise((r) => setTimeout(r, 50));
      expect(rows()).toHaveLength(0);
      expect(h.svc.sessionCount).toBe(0);
      expect(h.states.some((s) => s.sessionCount > 0)).toBe(false);
      expect(levels.map((level) => vi.mocked(h.log[level]).mock.calls.length)).toEqual(before);
    });

    it('counts a modern session in presence once it sends something other than discovery', async () => {
      const { socketPath, token } = await start();
      const modern = await agentFor(socketPath, token, { modern: true });
      await modern.client.listTools();
      expect(h.svc.sessionCount).toBe(1);
      expect(h.log.info).toHaveBeenCalledWith('agent', 'session opened', { agentName: 'Claude Code' });
    });
  });

  describe('oversized messages', () => {
    const oversized = () => `{"jsonrpc":"2.0","id":9,"method":"ping","params":{"pad":"${'x'.repeat(MAX_MESSAGE_BYTES)}"}}\n`;

    it('ends the socket on an oversized first message, before any era is chosen, and only that one', async () => {
      const { socketPath, token } = await start();
      const other = await agentFor(socketPath, token, { modern: true });
      const s = await openSocket(socketPath);
      sockets.push(s);
      const ended = readUntilClosed(s, 5_000);
      s.write(handshakeLine(token));
      s.write(oversized());
      expect(await ended).toBe('');
      expect(s.destroyed || s.readableEnded).toBe(true);
      expect((await other.client.listTools()).tools).toHaveLength(10);
    });

    it.each([
      ['modern', true],
      ['legacy', false],
    ])('ends a %s session on an oversized message once its era is pinned', async (_era, modern) => {
      const { socketPath, token } = await start();
      const a = await agentFor(socketPath, token, { modern });
      const other = await agentFor(socketPath, token, { modern: !modern });
      await a.client.listTools();
      a.socket.write(oversized());
      await a.closed;
      expect((await other.client.listTools()).tools).toHaveLength(10);
    });
  });

  describe('client info in the Read Log', () => {
    it('reads it from each request envelope in the modern era, cut to 128 characters', async () => {
      const { socketPath, token } = await start();
      const modern = await agentFor(socketPath, token, { modern: true }, { name: 'n'.repeat(300), version: '2.0' });
      await modern.client.callTool({ name: 'list_connections', arguments: {} });
      expect(rows()).toEqual([expect.objectContaining({ client_name: 'n'.repeat(128), client_version: '2.0' })]);
    });

    it('reads it from initialize in the legacy era', async () => {
      const { socketPath, token } = await start();
      const legacy = await agentFor(socketPath, token, {}, { name: 'old-client', version: '1.5' });
      await legacy.client.callTool({ name: 'list_connections', arguments: {} });
      expect(rows()).toEqual([expect.objectContaining({ client_name: 'old-client', client_version: '1.5' })]);
    });

    it('records null when a modern request carries no client info', async () => {
      const { socketPath, token } = await start();
      const raw = await rawSession(socketPath, token);
      sockets.push(raw.socket);
      const reply = await raw.request(1, 'tools/call', { name: 'list_connections', arguments: {}, ...envelope() });
      expect(reply.error).toBeUndefined();
      expect(rows()).toEqual([expect.objectContaining({ client_name: null, client_version: null })]);
    });

    it('leaves a malformed client info envelope to the SDK, which refuses it before any tool runs', async () => {
      const { socketPath, token } = await start();
      const raw = await rawSession(socketPath, token);
      sockets.push(raw.socket);
      const reply = await raw.request(1, 'tools/call', {
        name: 'list_connections',
        arguments: {},
        ...envelope({ 'io.modelcontextprotocol/clientInfo': { name: 'ok', version: 7 } }),
      });
      expect(reply.error?.code).toBe(-32602);
      expect(rows()).toHaveLength(0);
    });
  });

  describe('pausing for a closed Connection', () => {
    it('asks once, writes an INPUT_REQUIRED row first, and fails NOT_OPEN on decline', async () => {
      const { socketPath, token } = await start();
      h.addConnection(CLOSED_ID, 'prod', { shared: true });
      const { asked, onElicit } = answering('decline');
      const modern = await agentFor(socketPath, token, { modern: true, capabilities: FORM, onElicit });
      const result = await modern.client.callTool(findOn(CLOSED_ID));
      expect(result.isError).toBe(true);
      expect(textOf(result)).toMatch(/^NOT_OPEN: /);
      expect(asked).toEqual([`The Connection "prod" is closed. Open it in L'Atelier, then accept to continue.`]);
      expect(rows().map((r) => r.outcome)).toEqual(['INPUT_REQUIRED', 'NOT_OPEN']);
      expect(rows()[0]).toMatchObject({ tool: 'find', doc_count: 0, bytes: 0 });
      // One read, not two.
      expect(h.svc.sessionReadCount).toBe(1);
    });

    it('fails NOT_OPEN on cancel', async () => {
      const { socketPath, token } = await start();
      h.addConnection(CLOSED_ID, 'prod', { shared: true });
      const { asked, onElicit } = answering('cancel');
      const modern = await agentFor(socketPath, token, { modern: true, capabilities: FORM, onElicit });
      expect(textOf(await modern.client.callTool(findOn(CLOSED_ID)))).toMatch(/^NOT_OPEN: /);
      expect(asked).toHaveLength(1);
      expect(rows().map((r) => r.outcome)).toEqual(['INPUT_REQUIRED', 'NOT_OPEN']);
    });

    it('runs the gate again on accept and fails NOT_OPEN, without a second question, while the Connection is still closed', async () => {
      const { socketPath, token } = await start();
      h.addConnection(CLOSED_ID, 'prod', { shared: true });
      const { asked, onElicit } = answering('accept');
      const modern = await agentFor(socketPath, token, { modern: true, capabilities: FORM, onElicit });
      expect(textOf(await modern.client.callTool(findOn(CLOSED_ID)))).toMatch(/^NOT_OPEN: /);
      expect(asked).toHaveLength(1);
      expect(rows().map((r) => r.outcome)).toEqual(['INPUT_REQUIRED', 'NOT_OPEN']);
    });

    it('asks a client that declares a bare elicitation capability', async () => {
      const { socketPath, token } = await start();
      h.addConnection(CLOSED_ID, 'prod', { shared: true });
      const { asked, onElicit } = answering('decline');
      const modern = await agentFor(socketPath, token, { modern: true, capabilities: { elicitation: {} }, onElicit });
      await modern.client.callTool(findOn(CLOSED_ID));
      expect(asked).toHaveLength(1);
    });

    it('cuts a long Connection name to 256 characters and puts nothing else in the question', async () => {
      const { socketPath, token } = await start();
      const name = 'p'.repeat(300);
      h.addConnection(CLOSED_ID, name, { shared: true });
      const { asked, onElicit } = answering('decline');
      const modern = await agentFor(socketPath, token, { modern: true, capabilities: FORM, onElicit });
      await modern.client.callTool({ name: 'find', arguments: { connectionId: CLOSED_ID, database: 'secret_db', collection: 'secret_coll' } });
      expect(asked).toEqual([`The Connection "${'p'.repeat(256)}" is closed. Open it in L'Atelier, then accept to continue.`]);
    });

    it('opens no agent client and leaves no client behind for an asking round', async () => {
      const { socketPath, token } = await start();
      h.addConnection(CLOSED_ID, 'prod', { shared: true });
      const open = vi.spyOn(h.pool, 'openAgentClient');
      const { onElicit } = answering('decline');
      const modern = await agentFor(socketPath, token, { modern: true, capabilities: FORM, onElicit });
      await modern.client.callTool(findOn(CLOSED_ID));
      expect(open).not.toHaveBeenCalled();
    });

    it('refuses the retry when the token is revoked between rounds', async () => {
      const { socketPath, token, tokenId } = await start();
      h.addConnection(CLOSED_ID, 'prod', { shared: true });
      const { onElicit } = answering('accept', () => h.svc.revokeToken(tokenId));
      const modern = await agentFor(socketPath, token, { modern: true, capabilities: FORM, onElicit });
      const outcome = await modern.client.callTool(findOn(CLOSED_ID)).then(
        (result) => textOf(result),
        (err: unknown) => (err instanceof Error ? err.name : 'rejected'),
      );
      expect(outcome).not.toMatch(/^Returned|untrusted-data/);
      await modern.closed;
      expect(rows().map((r) => r.outcome)).not.toContain('ok');
      expect(rows().filter((r) => r.outcome === 'INPUT_REQUIRED')).toHaveLength(1);
    });

    it.each<[string, ConnectAgentOptions]>([
      ['a modern client without elicitation', { modern: true }],
      ['a modern client with URL elicitation only', { modern: true, capabilities: { elicitation: { url: {} } } }],
      ['a legacy client, even one that declares form elicitation', { capabilities: FORM }],
    ])('never asks %s', async (_label, options) => {
      const { socketPath, token } = await start();
      h.addConnection(CLOSED_ID, 'prod', { shared: true });
      const { asked, onElicit } = answering('accept');
      const a = await agentFor(socketPath, token, { ...options, ...(options.capabilities ? { onElicit } : {}) });
      const result = await a.client.callTool(findOn(CLOSED_ID));
      expect(textOf(result)).toMatch(/^NOT_OPEN: /);
      expect(asked).toHaveLength(0);
      expect(rows().map((r) => r.outcome)).toEqual(['NOT_OPEN']);
    });

    it('never asks about a Connection that is not shared', async () => {
      const { socketPath, token } = await start();
      h.addConnection(CLOSED_ID, 'prod', { shared: false });
      const { asked, onElicit } = answering('accept');
      const modern = await agentFor(socketPath, token, { modern: true, capabilities: FORM, onElicit });
      expect(textOf(await modern.client.callTool(findOn(CLOSED_ID)))).toMatch(/^NOT_SHARED: /);
      expect(asked).toHaveLength(0);
    });

    it('never asks on list_connections, which names no Connection', async () => {
      const { socketPath, token } = await start();
      h.addConnection(CLOSED_ID, 'prod', { shared: true });
      const { asked, onElicit } = answering('decline');
      const modern = await agentFor(socketPath, token, { modern: true, capabilities: FORM, onElicit });
      const result = await modern.client.callTool({ name: 'list_connections', arguments: {} });
      expect(result.isError).toBeFalsy();
      expect(asked).toHaveLength(0);
      expect(rows().map((r) => r.outcome)).toEqual(['ok']);
    });
  });
});

describe('X29 pause on a real Connection', () => {
  let f: ReadFixture;

  afterEach(async () => {
    await f?.cleanup();
  });

  it('returns documents when the user opens the Connection between the rounds', async () => {
    f = await createReadFixture({ connect: false });
    await f.db.collection('orders').insertMany([{ _id: 1, n: 1 }, { _id: 2, n: 2 }] as never);
    const asked: string[] = [];
    const modern = await connectAgent(f.socketPath, f.token, { name: 'modern', version: '1' }, {
      modern: true,
      capabilities: FORM,
      onElicit: async (params) => {
        asked.push(params.message);
        await f.m.pool.connect(f.connectionId);
        return { action: 'accept' };
      },
    });
    try {
      const result = await modern.client.callTool({ name: 'find', arguments: f.on('orders') });
      expect(result.isError).toBeFalsy();
      expect(docsIn(result)).toEqual([{ _id: 1, n: 1 }, { _id: 2, n: 2 }]);
      expect(asked).toHaveLength(1);
      expect(f.rows().map((r) => r.outcome)).toEqual(['INPUT_REQUIRED', 'ok']);
      expect(f.h.svc.sessionReadCount).toBe(1);
    } finally {
      await modern.close();
    }
  });

  it('gives a 2026-07-28 client the same result as a 2025-era client for every tool', async () => {
    f = await createReadFixture();
    await f.db.collection('orders').insertMany([{ _id: 1, n: 1, g: 'a' }, { _id: 2, n: 2, g: 'b' }] as never);
    await f.db.collection('orders').createIndex({ n: 1 });
    const modern = await connectAgent(f.socketPath, f.token, { name: 'modern', version: '1' }, { modern: true });
    const on = f.on('orders');
    const calls: Array<[string, Record<string, unknown>]> = [
      ['list_connections', {}],
      ['list_databases', { connectionId: f.connectionId }],
      ['list_collections', { connectionId: f.connectionId, database: f.dbName }],
      ['list_indexes', on],
      ['collection_schema', on],
      ['find', { ...on, sort: { n: 1 } }],
      ['count', on],
      ['aggregate', { ...on, pipeline: [{ $sort: { n: 1 } }] }],
      ['explain_find', on],
      ['explain_aggregate', { ...on, pipeline: [{ $match: { n: 1 } }] }],
    ];
    // The last line carries the duration, the envelope tag is random per call, and explain output carries the server's own timings. None is the era's doing.
    const stable = (result: { content?: unknown; isError?: boolean }) => ({
      isError: result.isError === true,
      text: textOf(result).split('\n').slice(0, -1).join('\n').replaceAll(/untrusted-data-[0-9a-f]{32}/g, 'untrusted-data-TAG').replace(/"(executionTimeMillis\w*|millis|works|advanced|needTime|saveState|restoreState)":\s*\d+/g, '"$1":0'),
    });
    try {
      expect(calls).toHaveLength(10);
      for (const [name, args] of calls) {
        const legacy = stable(await f.call(name, args));
        const current = stable(await modern.client.callTool({ name, arguments: args }));
        expect(legacy.isError, name).toBe(false);
        expect(current, name).toEqual(legacy);
      }
    } finally {
      await modern.close();
    }
  });

  it('lets a legacy client on the same socket server see the same NOT_OPEN it always did', async () => {
    f = await createReadFixture({ connect: false });
    const result = await f.call('find', f.on('orders'));
    expect(textOf(result)).toMatch(/^NOT_OPEN: /);
    expect(f.rows().map((r) => r.outcome)).toEqual(['NOT_OPEN']);
  });
});

