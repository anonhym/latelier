import { describe, it, expect, afterEach, vi } from 'vitest';
import fs from 'node:fs';
import net from 'node:net';
import { createAgentHarness, type AgentHarness, type AgentHarnessOptions } from '../helpers/agentHarness';
import { connectAgent, handshakeLine, openSocket, type AgentConnection, type ConnectAgentOptions } from '../helpers/agentSocket';
import { cellType } from '../helpers/db';
import { sessionRecordFailedLine } from '../../electron/agent/handshake';
import { NotFoundError } from '../../electron/errors';

const MODERN = '2026-07-28';
const SHARED_ID = '2b1f6a3e-6f0e-4c1e-9b7a-0d6f7b5e9a11';

interface SessionDbRow {
  id: string;
  token_id: string | null;
  token_name: string | null;
  client_name: string | null;
  client_version: string | null;
  folder: Buffer | null;
  started_at: string;
  ended_at: string | null;
  end_reason: string | null;
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

const initialize = (id: number, clientInfo: Record<string, unknown> = { name: 'raw-client', version: '3.1' }) =>
  `${JSON.stringify({ jsonrpc: '2.0', id, method: 'initialize', params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo } })}\n`;

/** A raw socket after the handshake: every line the app writes, and when it closes. */
async function rawSession(socketPath: string, handshake: string) {
  const socket = await openSocket(socketPath);
  const lines: string[] = [];
  let buffer = '';
  const waiters: Array<() => void> = [];
  socket.on('data', (c: Buffer) => {
    buffer += c.toString('utf8');
    for (let nl = buffer.indexOf('\n'); nl >= 0; nl = buffer.indexOf('\n')) {
      lines.push(buffer.slice(0, nl));
      buffer = buffer.slice(nl + 1);
    }
    for (const w of waiters.splice(0)) w();
  });
  socket.on('error', () => undefined);
  const closed = new Promise<void>((resolve) => socket.once('close', () => resolve()));
  socket.write(handshake);
  return {
    socket,
    lines,
    closed,
    /** Resolves once `n` lines have arrived. */
    async waitForLines(n: number): Promise<void> {
      while (lines.length < n) await new Promise<void>((resolve) => waiters.push(resolve));
    },
    send(id: number, method: string, params: Record<string, unknown>): void {
      socket.write(`${JSON.stringify({ jsonrpc: '2.0', id, method, params })}\n`);
    },
  };
}

async function until(check: () => boolean, ms = 3_000): Promise<void> {
  const end = Date.now() + ms;
  while (!check()) {
    if (Date.now() > end) throw new Error('condition not met in time');
    await new Promise((r) => setTimeout(r, 10));
  }
}

describe('Agent sessions (X27 §16.2–§16.4)', () => {
  let h: AgentHarness | null = null;
  const agents: AgentConnection[] = [];
  const sockets: net.Socket[] = [];

  afterEach(async () => {
    for (const a of agents.splice(0)) await a.close().catch(() => undefined);
    for (const s of sockets.splice(0)) s.destroy();
    await h?.cleanup();
    h = null;
  });

  async function start(options: AgentHarnessOptions = {}) {
    h = createAgentHarness(options);
    const added = h.svc.addToken('Claude Code');
    const socketPath = await h.enable();
    return { h, socketPath, token: added.token, tokenId: added.info.id };
  }

  async function agentFor(socketPath: string, token: string, options: ConnectAgentOptions = {}, clientInfo = { name: 'spec-client', version: '9.9' }) {
    const a = await connectAgent(socketPath, token, clientInfo, options);
    agents.push(a);
    return a;
  }

  const sessionRows = () => h!.tmp.db.prepare('SELECT * FROM agent_sessions ORDER BY started_at, id').all() as SessionDbRow[];

  describe('the row', () => {
    it('is written on initialize in the legacy era, with its client info, before the request is handled', async () => {
      const { socketPath, token, tokenId } = await start();
      await agentFor(socketPath, token, {}, { name: 'old-client', version: '1.5' });
      const [row] = sessionRows();
      expect(sessionRows()).toHaveLength(1);
      expect(row).toMatchObject({
        token_id: tokenId,
        token_name: 'Claude Code',
        client_name: 'old-client',
        client_version: '1.5',
        folder: null,
        ended_at: null,
        end_reason: null,
      });
      expect(Number.isNaN(Date.parse(row!.started_at))).toBe(false);
    });

    it('is written on the first request after discovery in the modern era, with the envelope client info', async () => {
      const { socketPath, token } = await start();
      const modern = await agentFor(socketPath, token, { modern: true }, { name: 'n'.repeat(300), version: '2.0' });
      await modern.client.listTools();
      expect(sessionRows()).toEqual([expect.objectContaining({ client_name: 'n'.repeat(128), client_version: '2.0', ended_at: null })]);
    });

    it('is never written for a discovery-only probe', async () => {
      const { socketPath, token } = await start();
      const raw = await rawSession(socketPath, handshakeLine(token));
      raw.send(1, 'server/discover', envelope());
      await raw.waitForLines(1);
      raw.socket.end();
      await raw.closed;
      await new Promise((r) => setTimeout(r, 50));
      expect(sessionRows()).toEqual([]);
      expect(h!.states.some((s) => s.sessions.length > 0)).toBe(false);
    });

    it('takes client info from discovery when the counted request carries none, and writes it only once', async () => {
      const { socketPath, token } = await start();
      const raw = await rawSession(socketPath, handshakeLine(token));
      sockets.push(raw.socket);
      raw.send(1, 'server/discover', envelope({ 'io.modelcontextprotocol/clientInfo': { name: 'probe', version: '1' } }));
      await raw.waitForLines(1);
      raw.send(2, 'tools/list', envelope());
      await raw.waitForLines(2);
      raw.send(3, 'tools/list', envelope({ 'io.modelcontextprotocol/clientInfo': { name: 'later', version: '2' } }));
      await raw.waitForLines(3);
      expect(sessionRows()).toEqual([expect.objectContaining({ client_name: 'probe', client_version: '1' })]);
    });

    it('records client info from the first later request that carries it', async () => {
      const { socketPath, token } = await start();
      const raw = await rawSession(socketPath, handshakeLine(token));
      sockets.push(raw.socket);
      raw.send(1, 'tools/list', envelope());
      await raw.waitForLines(1);
      expect(sessionRows()).toEqual([expect.objectContaining({ client_name: null, client_version: null })]);
      raw.send(2, 'tools/list', envelope({ 'io.modelcontextprotocol/clientInfo': { name: 'late', version: 7 } }));
      await raw.waitForLines(2);
      raw.send(3, 'tools/list', envelope({ 'io.modelcontextprotocol/clientInfo': { name: 'later', version: '2' } }));
      await raw.waitForLines(3);
      // A version that is not a string is recorded as absent, as everywhere else.
      expect(sessionRows()).toEqual([expect.objectContaining({ client_name: 'late', client_version: null })]);
      expect(h!.svc.getState().sessions[0]).toMatchObject({ clientName: 'late', clientVersion: null });
    });

    it('carries the session id on every Read Log row, and the live state counts the calls', async () => {
      const { socketPath, token } = await start();
      h!.addConnection(SHARED_ID, 'prod', { shared: false });
      const a = await agentFor(socketPath, token);
      await a.client.callTool({ name: 'list_connections', arguments: {} });
      await a.client.callTool({ name: 'find', arguments: { connectionId: SHARED_ID, database: 'd', collection: 'c' } });
      const [session] = sessionRows();
      const logged = h!.tmp.db.prepare('SELECT session_id, outcome FROM agent_read_log ORDER BY ts, rowid').all();
      expect(logged).toEqual([
        { session_id: session!.id, outcome: 'ok' },
        { session_id: session!.id, outcome: 'NOT_SHARED' },
      ]);
      const [live] = h!.svc.getState().sessions;
      expect(live).toMatchObject({ id: session!.id, callCount: 2, refusedCount: 1, clientName: 'spec-client' });
      expect(live!.lastCallAt).not.toBeNull();
      expect(h!.svc.getState().sessionCount).toBe(1);
      // One push per row, without the request.
      expect(h!.calls.map((c) => [c.sessionId, c.outcome])).toEqual([
        [session!.id, 'ok'],
        [session!.id, 'NOT_SHARED'],
      ]);
      for (const c of h!.calls) expect(c).not.toHaveProperty('request');
      // And the log reads back by session.
      expect(h!.svc.listCalls({ sessionId: session!.id, outcome: 'refused', limit: 10 }).map((r) => r.tool)).toEqual(['find']);
      expect(h!.svc.listSessions({ includeEnded: false, limit: 10 })).toEqual([
        expect.objectContaining({ id: session!.id, callCount: 2, refusedCount: 1, endedAt: null, endReason: null }),
      ]);
    });

    it('pushes the state at once when a session opens and when it closes', async () => {
      const { socketPath, token } = await start();
      const a = await agentFor(socketPath, token);
      await until(() => h!.states.at(-1)?.sessions.length === 1);
      expect(h!.states.at(-1)!.sessionCount).toBe(1);
      await a.close();
      await a.closed;
      await until(() => h!.states.at(-1)?.sessions.length === 0);
      expect(h!.states.at(-1)!.sessionCount).toBe(0);
    });
  });

  describe('the folder', () => {
    it('is stored sealed and cleaned, and the renderer only ever sees it with home as ~', async () => {
      const { socketPath, token } = await start({ homedir: '/Users/ann' });
      const raw = await rawSession(socketPath, handshakeLine(token, 2, '/Users/ann/Projects/shop\u0007-api'));
      sockets.push(raw.socket);
      raw.socket.write(initialize(1));
      await raw.waitForLines(1);
      const [row] = sessionRows();
      expect(cellType(h!.tmp.db, 'agent_sessions', 'folder', row!.id)).toBe('blob');
      expect(row!.folder!.toString('latin1')).not.toContain('Projects');
      expect(h!.sessionRepo.findById(row!.id)?.folder).toBe('/Users/ann/Projects/shop-api');
      const state = h!.svc.getState();
      expect(state.sessions).toEqual([expect.objectContaining({ folder: '~/Projects/shop-api', clientName: 'raw-client' })]);
      expect(h!.svc.listSessions({ includeEnded: true, limit: 5 })[0]!.folder).toBe('~/Projects/shop-api');
      expect(JSON.stringify(state)).not.toContain('/Users/ann');
      expect(JSON.stringify(h!.states)).not.toContain('/Users/ann');
    });

    it('is absent for a protocol 1 bridge and for a folder that cleans to nothing', async () => {
      const { socketPath, token } = await start();
      for (const handshake of [handshakeLine(token, 1), handshakeLine(token, 2, '\u0001\u0002')]) {
        const raw = await rawSession(socketPath, handshake);
        sockets.push(raw.socket);
        raw.socket.write(initialize(1));
        await raw.waitForLines(1);
      }
      expect(sessionRows().map((r) => r.folder)).toEqual([null, null]);
    });

    it('never reaches the app log', async () => {
      const { socketPath, token } = await start();
      const raw = await rawSession(socketPath, handshakeLine(token, 2, '/very/secret/project'));
      sockets.push(raw.socket);
      raw.socket.write(initialize(1));
      await raw.waitForLines(1);
      for (const level of ['debug', 'info', 'warn', 'error'] as const) {
        expect(JSON.stringify(vi.mocked(h!.log[level]).mock.calls)).not.toContain('secret');
      }
    });
  });

  describe('ending', () => {
    async function oneSession() {
      const started = await start();
      const a = await agentFor(started.socketPath, started.token);
      const [row] = sessionRows();
      return { ...started, a, id: row!.id };
    }

    const ended = (id: string) => h!.sessionRepo.findById(id);

    it('records client-closed when the client goes away', async () => {
      const { a, id } = await oneSession();
      await a.close();
      await until(() => ended(id)?.endedAt != null);
      expect(ended(id)).toMatchObject({ endReason: 'client-closed' });
      expect(h!.svc.getState().sessions).toEqual([]);
    });

    it('records user-ended when the user ends it, and refuses a session that is not live', async () => {
      const { a, id } = await oneSession();
      expect(h!.svc.endSession(id)).toEqual({ ok: true });
      await a.closed;
      await until(() => ended(id)?.endedAt != null);
      expect(ended(id)).toMatchObject({ endReason: 'user-ended' });
      expect(() => h!.svc.endSession(id)).toThrow(NotFoundError);
      expect(() => h!.svc.endSession('00000000-0000-4000-8000-000000000000')).toThrow(NotFoundError);
    });

    it('records token-revoked when its token is revoked', async () => {
      const { a, id, tokenId } = await oneSession();
      h!.svc.revokeTokenAndNotify(tokenId);
      await a.closed;
      await until(() => ended(id)?.endedAt != null);
      expect(ended(id)).toMatchObject({ endReason: 'token-revoked' });
    });

    it('records token-revoked when the runner ends it because the token row went away', async () => {
      const { a, id, tokenId } = await oneSession();
      h!.tokenRepo.deleteById(tokenId);
      await a.client.callTool({ name: 'list_connections', arguments: {} });
      await a.closed;
      await until(() => ended(id)?.endedAt != null);
      expect(ended(id)).toMatchObject({ endReason: 'token-revoked' });
    });

    it('records access-off when Agent Access goes off', async () => {
      const { a, id } = await oneSession();
      await h!.disable();
      await a.closed;
      expect(ended(id)).toMatchObject({ endReason: 'access-off' });
    });

    it('records app-quit when the app stops', async () => {
      const { a, id } = await oneSession();
      const harness = h!;
      await harness.svc.stop();
      await a.closed;
      expect(harness.sessionRepo.findById(id)).toMatchObject({ endReason: 'app-quit' });
      harness.tmp.cleanup();
      fs.rmSync(harness.tmp.dir, { recursive: true, force: true });
      h = null;
    });

    it('tells a main-process subscriber why each session ended', async () => {
      const { a, id } = await oneSession();
      const seen: Array<[string, string]> = [];
      const off = h!.svc.onSessionEnded((sessionId, reason) => seen.push([sessionId, reason]));
      h!.svc.endSession(id);
      await a.closed;
      await until(() => seen.length === 1);
      expect(seen).toEqual([[id, 'user-ended']]);
      off();
    });

    it('closes a row a crash left open as unknown, at launch, with Agent Access off', async () => {
      let orphan = '';
      h = createAgentHarness({
        beforeService: ({ sessionRepo }) => {
          orphan = '11111111-1111-4111-8111-111111111111';
          sessionRepo.insert({
            id: orphan,
            tokenId: 't',
            tokenName: 'Claude',
            clientName: null,
            clientVersion: null,
            folder: null,
            startedAt: '2026-11-26T10:00:00.000Z',
          });
        },
      });
      const row = h.sessionRepo.findById(orphan);
      expect(row).toMatchObject({ endReason: 'unknown' });
      expect(Date.parse(row!.endedAt!)).toBeGreaterThan(Date.parse('2026-11-26T10:00:00.000Z'));
    });
  });

  describe('when the row cannot be written', () => {
    const failing: AgentHarnessOptions = {
      makeSessionRepo: (real) =>
        Object.assign(Object.create(real) as typeof real, {
          insert: () => {
            throw new Error('disk full');
          },
        }),
    };

    it('answers the first request with the fixed -32003 line straight on the socket, and ends it', async () => {
      const { socketPath, token } = await start(failing);
      const raw = await rawSession(socketPath, handshakeLine(token));
      sockets.push(raw.socket);
      // A second request in the same chunk must not reach the SDK either.
      raw.socket.write(initialize(7) + `${JSON.stringify({ jsonrpc: '2.0', id: 8, method: 'tools/list', params: {} })}\n`);
      await raw.closed;
      expect(raw.lines).toEqual([sessionRecordFailedLine(7).trimEnd()]);
      expect(h!.svc.sessionCount).toBe(0);
      expect(h!.states.some((s) => s.sessions.length > 0)).toBe(false);
      expect(h!.log.info).not.toHaveBeenCalledWith('agent', 'session opened', expect.anything());
      // Once: the request behind it in the chunk was dropped unread, not tried again.
      expect(vi.mocked(h!.log.error).mock.calls.filter((c) => c[1] === 'could not record the Agent session')).toEqual([
        ['agent', 'could not record the Agent session', { errName: 'Error' }],
      ]);
      expect(JSON.stringify(vi.mocked(h!.log.error).mock.calls)).not.toContain('disk full');
    });

    it('does the same after a server/discover reply on the same socket, with that request id', async () => {
      const { socketPath, token } = await start(failing);
      const raw = await rawSession(socketPath, handshakeLine(token));
      sockets.push(raw.socket);
      raw.send(1, 'server/discover', envelope());
      await raw.waitForLines(1);
      expect(JSON.parse(raw.lines[0]!)).toMatchObject({ id: 1, result: expect.any(Object) });
      raw.send(2, 'tools/list', envelope());
      await raw.closed;
      expect(raw.lines).toHaveLength(2);
      expect(raw.lines[1]).toBe(sessionRecordFailedLine(2).trimEnd());
      expect(h!.svc.sessionCount).toBe(0);
    });

    it('keeps a string request id as the client sent it', async () => {
      const { socketPath, token } = await start(failing);
      const raw = await rawSession(socketPath, handshakeLine(token));
      sockets.push(raw.socket);
      raw.socket.write(`${JSON.stringify({ jsonrpc: '2.0', id: 'req-"1"', method: 'tools/list', params: envelope() })}\n`);
      await raw.closed;
      expect(raw.lines).toEqual([sessionRecordFailedLine('req-"1"').trimEnd()]);
    });
  });
});
