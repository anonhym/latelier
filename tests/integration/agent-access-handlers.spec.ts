import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import net from 'node:net';
import type { EventEmitter } from 'node:events';
import { randomUUID } from 'node:crypto';
import { createRouter } from '../../electron/ipc/router';
import { registerAgentAccessChannels } from '../../electron/ipc/handlers/agentAccess';
import { registerConnChannels } from '../../electron/ipc/handlers/conn';
import { registerPrefsChannels } from '../../electron/ipc/handlers/prefs';
import { ConnectionService, connectionReader } from '../../electron/mongo/ConnectionService';
import { MongoPool } from '../../electron/mongo/MongoPool';
import { SecretsVault } from '../../electron/secrets/SecretsVault';
import { createPickedCredentialPaths } from '../../electron/security/credentialPaths';
import { AGENT_ACCESS_KEY } from '../../electron/ipc/prefKeys';
import { TOKEN_RE, hashToken } from '../../electron/agent/token';
import { IPC_CHANNELS, type Envelope } from '../../shared/ipc';
import type { AgentAccessState, AgentCallSummary, AgentCopyResult, AgentTokenInfo, Connection, ConnectionInput } from '../../shared/types';
import { CLIPBOARD_CLEAR_MS } from '../../electron/services/AgentAccessService';
import type { ConnectionRequests } from '../../electron/agent/connectionRequests';
import { NOT_OPEN_DECLINED_MESSAGE } from '../../electron/agent/errorMap';
import { createAgentHarness, type AgentHarness } from '../helpers/agentHarness';
import { connectAgent, handshakeLine, openSocket, readUntilClosed, textOf } from '../helpers/agentSocket';
import { createIpcShim } from '../helpers/ipcShim';
import { createSafeStorageMock } from '../helpers/safeStorageMock';

const TURN_ON = 1;
const COPY = 1;

/** The token in a copied JSON setup. */
function tokenInSetup(text: string): string {
  return (JSON.parse(text) as { mcpServers: { latelier: { env: { LATELIER_AGENT_TOKEN: string } } } }).mcpServers.latelier.env
    .LATELIER_AGENT_TOKEN;
}

function connInput(name: string): ConnectionInput {
  return {
    name,
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
}

describe('agentAccess:* channels', () => {
  let h: AgentHarness;
  let shim: ReturnType<typeof createIpcShim>;
  let pool: MongoPool;
  const sessions: Array<() => Promise<void>> = [];

  function setup(platform: NodeJS.Platform = 'darwin', now?: () => number) {
    h = createAgentHarness({ platform, ...(now ? { now } : {}) });
    shim = createIpcShim();
    const router = createRouter(shim.ipcMain, () => true);
    registerAgentAccessChannels(router, h.svc);
    const vault = new SecretsVault(h.tmp.db, createSafeStorageMock());
    pool = new MongoPool({ repo: connectionReader(h.connRepo, vault), vault });
    vi.spyOn(pool, 'disconnect').mockResolvedValue(undefined);
    registerConnChannels(router, new ConnectionService({ repo: h.connRepo, vault, pool }), createPickedCredentialPaths());
    registerPrefsChannels(router, h.appState, () => null);
  }

  const invoke = <T>(channel: string, payload?: unknown): Promise<Envelope<T>> => shim.invoke<T>(channel, payload);

  async function ok<T>(channel: string, payload?: unknown): Promise<T> {
    const env = await invoke<T>(channel, payload);
    if (!env.ok) throw new Error(`${channel} failed: ${env.error.code} ${env.error.message}`);
    return env.data;
  }

  async function turnOn(): Promise<string> {
    h.answers.push(TURN_ON);
    const out = await ok<{ enabled: boolean }>(IPC_CHANNELS.agentAccessRequestEnable, {});
    expect(out).toEqual({ enabled: true });
    return h.svc.socketPath!;
  }

  beforeEach(() => setup());

  afterEach(async () => {
    for (const close of sessions.splice(0)) await close();
    vi.restoreAllMocks();
    await h.cleanup();
  });

  describe('validation', () => {
    it.each([IPC_CHANNELS.agentAccessGetState, IPC_CHANNELS.agentAccessRequestEnable, IPC_CHANNELS.agentAccessDisable, IPC_CHANNELS.agentAccessRemoveBridge])(
      '%s takes nothing: undefined, null and {} are fine, anything else is refused',
      async (channel) => {
        h.answers.push(0);
        expect((await invoke(channel, undefined)).ok).toBe(true);
        expect((await invoke(channel, null)).ok).toBe(true);
        expect((await invoke(channel, {})).ok).toBe(true);
        const env = await invoke(channel, { surprise: 1 });
        expect(env.ok).toBe(false);
        if (!env.ok) expect(env.error.code).toBe('VALIDATION');
      },
    );

    it.each([
      ['no connectionId', { shared: true }],
      ['a connectionId that is not a uuid', { connectionId: 'c1', shared: true }],
      ['no shared flag', { connectionId: randomUUID() }],
      ['a shared flag that is not a boolean', { connectionId: randomUUID(), shared: 'yes' }],
      ['an extra key', { connectionId: randomUUID(), shared: true, force: true }],
      ['no payload', undefined],
    ])('set-shared refuses %s', async (_name, payload) => {
      const env = await invoke(IPC_CHANNELS.agentAccessSetShared, payload);
      expect(env.ok).toBe(false);
      if (!env.ok) expect(env.error.code).toBe('VALIDATION');
    });

    it.each([
      ['no name', { client: 'cursor' }],
      ['an empty name', { name: '', client: 'cursor' }],
      ['a blank name', { name: '   ', client: 'cursor' }],
      ['a name over 64 characters', { name: 'x'.repeat(65), client: 'cursor' }],
      ['a name that is not a string', { name: 7, client: 'cursor' }],
      ['a name with a newline', { name: 'Claude\nTurn on?', client: 'cursor' }],
      ['a name with a control character', { name: 'a\u0007b', client: 'cursor' }],
      ['a name with a bidi override', { name: 'Claude\u202EedoC', client: 'cursor' }],
      ['a name with a line separator', { name: 'Claude\u2028Turn on?', client: 'cursor' }],
      ['a name with a paragraph separator', { name: 'Claude\u2029Turn on?', client: 'cursor' }],
      ['a name with a zero-width space', { name: 'Clau\u200Bde', client: 'cursor' }],
      ['a name with a private-use character', { name: 'Clau\uE000de', client: 'cursor' }],
      ['no client', { name: 'ok' }],
      ['an unknown client', { name: 'ok', client: 'vim' }],
      ['an extra key', { name: 'ok', client: 'cursor', token: 'abc' }],
      ['no payload', undefined],
    ])('connect-client refuses %s', async (_name, payload) => {
      const env = await invoke(IPC_CHANNELS.agentAccessConnectClient, payload);
      expect(env.ok).toBe(false);
      if (!env.ok) expect(env.error.code).toBe('VALIDATION');
      expect(h.tokenRepo.list()).toHaveLength(0);
      expect(h.boxes).toHaveLength(0);
    });

    it.each([
      ['an id that is not a uuid', { id: 'abc', client: 'cursor' }],
      ['no client', { id: randomUUID() }],
      ['an unknown client', { id: randomUUID(), client: 'vim' }],
      ['an extra key', { id: randomUUID(), client: 'cursor', extra: 1 }],
      ['no payload', undefined],
    ])('copy-setup refuses %s', async (_name, payload) => {
      const env = await invoke(IPC_CHANNELS.agentAccessCopySetup, payload);
      expect(env.ok).toBe(false);
      if (!env.ok) expect(env.error.code).toBe('VALIDATION');
      expect(h.boxes).toHaveLength(0);
    });

    it.each([
      ['an id that is not a uuid', { id: 'abc', name: 'ok' }],
      ['no name', { id: randomUUID() }],
      ['a blank name', { id: randomUUID(), name: '  ' }],
      ['a name over 64 characters', { id: randomUUID(), name: 'x'.repeat(65) }],
      ['a name with a newline', { id: randomUUID(), name: 'a\nb' }],
      ['a name with a bidi override', { id: randomUUID(), name: 'a\u202Eb' }],
      ['an extra key', { id: randomUUID(), name: 'ok', extra: 1 }],
      ['no payload', undefined],
    ])('rename-token refuses %s', async (_name, payload) => {
      const env = await invoke(IPC_CHANNELS.agentAccessRenameToken, payload);
      expect(env.ok).toBe(false);
      if (!env.ok) expect(env.error.code).toBe('VALIDATION');
    });

    it.each([
      ['a session id that is not a uuid', { sessionId: 's', connectionId: randomUUID() }],
      ['a Connection id that is not a uuid', { sessionId: randomUUID(), connectionId: 'c' }],
      ['no Connection id', { sessionId: randomUUID() }],
      ['an extra key', { sessionId: randomUUID(), connectionId: randomUUID(), open: true }],
      ['no payload', undefined],
    ])('dismiss-request refuses %s', async (_name, payload) => {
      const env = await invoke(IPC_CHANNELS.agentAccessDismissRequest, payload);
      expect(env.ok).toBe(false);
      if (!env.ok) expect(env.error.code).toBe('VALIDATION');
    });

    it('revoke-token refuses an id that is not a uuid and an extra key', async () => {
      for (const payload of [{ id: 'abc' }, {}, { id: randomUUID(), extra: 1 }, undefined]) {
        const env = await invoke(IPC_CHANNELS.agentAccessRevokeToken, payload);
        expect(env.ok).toBe(false);
        if (!env.ok) expect(env.error.code).toBe('VALIDATION');
      }
    });

    it('accepts a name of exactly 64 characters', async () => {
      await addTokenAndCopy('n'.repeat(64));
      expect(h.tokenRepo.list()[0]!.name).toHaveLength(64);
    });

    it('accepts an ordinary Unicode name as it is, and names it in the confirm', async () => {
      await addTokenAndCopy('Café 笔记本');
      expect(h.tokenRepo.list()[0]!.name).toBe('Café 笔记本');
      expect(h.boxes[0]!.detail).toBe('It contains a new Agent Token named “Café 笔记本”. Paste it into Claude Code (JSON) straight away.');
    });

    it('prints a stored name that is not safe with the unsafe characters taken out', async () => {
      h.tokenRepo.insert({ id: randomUUID(), name: 'Evil\n\u202EDone?', token_hash: hashToken('x'), created_at: 'now', last_used_at: null });
      const id = h.tokenRepo.list()[0]!.id;
      expect(await ok(IPC_CHANNELS.agentAccessCopySetup, { id, client: 'cursor' })).toEqual({ cancelled: true });
      expect(h.boxes[0]!.message).toBe('Copy the Cursor setup for “Evil Done?”?');
    });

    it('trims the name it stores', async () => {
      await addTokenAndCopy('  Claude Code  ');
      expect(h.tokenRepo.list()[0]!.name).toBe('Claude Code');
    });
  });

  describe('reading the log and the sessions', () => {
    const uuid = () => randomUUID();

    it.each([
      ['no outcome', { limit: 10 }],
      ['an unknown outcome', { outcome: 'denied', limit: 10 }],
      ['no limit', { outcome: 'all' }],
      ['a limit of 0', { outcome: 'all', limit: 0 }],
      ['a limit of 201', { outcome: 'all', limit: 201 }],
      ['a fractional limit', { outcome: 'all', limit: 1.5 }],
      ['a session id that is not a uuid', { outcome: 'all', limit: 10, sessionId: 's1' }],
      ['a token id that is not a uuid', { outcome: 'all', limit: 10, tokenId: 't1' }],
      ['a Connection id that is not a uuid', { outcome: 'all', limit: 10, connectionId: 'c1' }],
      ['a database name over 256 characters', { outcome: 'all', limit: 10, database: 'd'.repeat(257) }],
      ['a collection name over 256 characters', { outcome: 'all', limit: 10, collection: 'c'.repeat(257) }],
      ['a tool name over 256 characters', { outcome: 'all', limit: 10, tool: 't'.repeat(257) }],
      ['a cursor without an id', { outcome: 'all', limit: 10, before: { ts: '2026-11-27T00:00:00.000Z' } }],
      ['a cursor id that is not a uuid', { outcome: 'all', limit: 10, before: { ts: 'x', id: 'y' } }],
      ['a cursor ts over 64 characters', { outcome: 'all', limit: 10, before: { ts: 'x'.repeat(65), id: uuid() } }],
      ['a cursor with an extra key', { outcome: 'all', limit: 10, before: { ts: 'x', id: uuid(), more: 1 } }],
      ['an extra key', { outcome: 'all', limit: 10, request: true }],
      ['no payload', undefined],
    ])('list-calls refuses %s', async (_name, payload) => {
      const env = await invoke(IPC_CHANNELS.agentAccessListCalls, payload);
      expect(env.ok).toBe(false);
      if (!env.ok) expect(env.error.code).toBe('VALIDATION');
    });

    it.each([
      ['no includeEnded', { limit: 10 }],
      ['an includeEnded that is not a boolean', { includeEnded: 'yes', limit: 10 }],
      ['a limit of 201', { includeEnded: true, limit: 201 }],
      ['a limit of 0', { includeEnded: true, limit: 0 }],
      ['a token id that is not a uuid', { includeEnded: true, limit: 10, tokenId: 't1' }],
      ['a cursor without startedAt', { includeEnded: true, limit: 10, before: { id: uuid() } }],
      ['a cursor startedAt over 64 characters', { includeEnded: true, limit: 10, before: { startedAt: 's'.repeat(65), id: uuid() } }],
      ['an extra key', { includeEnded: true, limit: 10, folder: '/' }],
    ])('list-sessions refuses %s', async (_name, payload) => {
      const env = await invoke(IPC_CHANNELS.agentAccessListSessions, payload);
      expect(env.ok).toBe(false);
      if (!env.ok) expect(env.error.code).toBe('VALIDATION');
    });

    it('end-session refuses a session id that is not a uuid, a missing one and an extra key', async () => {
      for (const payload of [{ sessionId: 'abc' }, {}, { sessionId: uuid(), reason: 'x' }, undefined]) {
        const env = await invoke(IPC_CHANNELS.agentAccessEndSession, payload);
        expect(env.ok).toBe(false);
        if (!env.ok) expect(env.error.code).toBe('VALIDATION');
      }
    });

    it('end-session answers NOT_FOUND for a session that is not live', async () => {
      const env = await invoke(IPC_CHANNELS.agentAccessEndSession, { sessionId: uuid() });
      expect(env.ok).toBe(false);
      if (!env.ok) expect(env.error.code).toBe('NOT_FOUND');
    });

    it('accepts the limits at their edges and every filter, and answers the rows', async () => {
      const full = {
        sessionId: uuid(),
        tokenId: uuid(),
        connectionId: uuid(),
        database: 'd'.repeat(256),
        collection: 'c'.repeat(256),
        tool: 't'.repeat(256),
        outcome: 'refused',
        before: { ts: 'x'.repeat(64), id: uuid() },
        limit: 200,
      };
      expect(await ok(IPC_CHANNELS.agentAccessListCalls, full)).toEqual([]);
      expect(await ok(IPC_CHANNELS.agentAccessListCalls, { outcome: 'ok', limit: 1 })).toEqual([]);
      expect(await ok(IPC_CHANNELS.agentAccessListSessions, { includeEnded: false, limit: 1 })).toEqual([]);
      expect(
        await ok(IPC_CHANNELS.agentAccessListSessions, { tokenId: uuid(), includeEnded: true, before: { startedAt: 's'.repeat(64), id: uuid() }, limit: 200 }),
      ).toEqual([]);
    });

    it('lists a live session and its calls, and ends it through the channel', async () => {
      const socketPath = await turnOn();
      const token = await addTokenAndCopy();
      const info = { id: h.tokenRepo.list()[0]!.id };
      const agent = await connectAgent(socketPath, token);
      sessions.push(() => agent.close());
      await agent.client.callTool({ name: 'list_connections', arguments: {} });
      const [session] = await ok<Array<{ id: string; tokenId: string; endedAt: string | null }>>(IPC_CHANNELS.agentAccessListSessions, {
        includeEnded: false,
        limit: 10,
      });
      expect(session).toMatchObject({ tokenId: info.id, endedAt: null });
      const calls = await ok<Array<{ tool: string; sessionId: string; request: string }>>(IPC_CHANNELS.agentAccessListCalls, {
        sessionId: session!.id,
        outcome: 'all',
        limit: 10,
      });
      expect(calls).toEqual([expect.objectContaining({ tool: 'list_connections', sessionId: session!.id, request: '{}' })]);
      expect(await ok(IPC_CHANNELS.agentAccessEndSession, { sessionId: session!.id })).toEqual({ ok: true });
      await agent.closed;
    });
  });

  describe('the switch', () => {
    it('starts off, with nothing listening', async () => {
      const state = await ok<AgentAccessState>(IPC_CHANNELS.agentAccessGetState, {});
      expect(state).toMatchObject({ enabled: false, socketPath: '', sessionReadCount: 0, sessionCount: 0, tokens: [], privilege: {} });
      expect(state.platformCaveat).toBeNull();
    });

    it('leaves the switch off when the dialog is cancelled', async () => {
      h.answers.push(0);
      expect(await ok(IPC_CHANNELS.agentAccessRequestEnable, {})).toEqual({ enabled: false });
      expect(h.appState.get(AGENT_ACCESS_KEY)).not.toBe(true);
      expect(h.svc.socketPath).toBeNull();
      expect(h.bridge.copies).toBe(0);
    });

    it('asks first, with Cancel as the default, and only a confirmed dialog turns it on', async () => {
      await turnOn();

      expect(h.boxes).toHaveLength(1);
      const box = h.boxes[0]!;
      expect(box.buttons).toEqual(['Cancel', 'Turn on']);
      expect([box.defaultId, box.cancelId]).toEqual([0, 0]);
      expect(box.detail).toContain('They cannot write or delete anything');
      expect(box.detail).toContain('read-only database user');
      expect(box.detail).not.toContain('Agent Token');
      expect(h.appState.get(AGENT_ACCESS_KEY)).toBe(true);
    });

    it('answers only once the server listens, so the state it returns agrees', async () => {
      await turnOn();
      const state = await ok<AgentAccessState>(IPC_CHANNELS.agentAccessGetState, {});
      expect(state.enabled).toBe(true);
      expect(state.socketPath).toBe(h.svc.socketPath);
      expect(state.socketPath).not.toBe('');
    });

    it('installs the bridge copy when it turns on', async () => {
      await turnOn();
      expect(h.bridge.copies).toBe(1);
      expect((await ok<AgentAccessState>(IPC_CHANNELS.agentAccessGetState, {})).bridgeInstalled).toBe(true);
    });

    it('does not ask again, or copy again, when it is already on', async () => {
      await turnOn();
      expect(await ok(IPC_CHANNELS.agentAccessRequestEnable, {})).toEqual({ enabled: true });
      expect(h.boxes).toHaveLength(1);
      expect(h.bridge.copies).toBe(1);
    });

    it('treats two clicks while the dialog is open as one question', async () => {
      h.answers.push(TURN_ON);
      const [a, b] = await Promise.all([
        invoke(IPC_CHANNELS.agentAccessRequestEnable, {}),
        invoke(IPC_CHANNELS.agentAccessRequestEnable, {}),
      ]);
      expect(a).toEqual({ ok: true, data: { enabled: true } });
      expect(b).toEqual({ ok: true, data: { enabled: true } });
      expect(h.boxes).toHaveLength(1);
    });

    it('states the token-only caveat in plain words on Windows, and not on other platforms', async () => {
      await h.cleanup();
      setup('win32');
      await turnOn();
      expect(h.boxes[0]!.detail).toContain('the only protection against other users of this computer is the Agent Token');
      expect((await ok<AgentAccessState>(IPC_CHANNELS.agentAccessGetState, {})).platformCaveat).toBe('windows-pipe');
    });

    it('turns off without a dialog, closes the listener and refuses new connections', async () => {
      const socketPath = await turnOn();
      const boxes = h.boxes.length;

      expect(await ok(IPC_CHANNELS.agentAccessDisable, {})).toEqual({ enabled: false });

      expect(h.boxes).toHaveLength(boxes);
      expect(h.appState.get(AGENT_ACCESS_KEY)).toBe(false);
      expect(h.svc.socketPath).toBeNull();
      await expect(
        new Promise((resolve, reject) => {
          const socket = net.connect(socketPath);
          socket.once('connect', () => resolve('connected'));
          socket.once('error', reject);
        }),
      ).rejects.toMatchObject({ code: expect.stringMatching(/ENOENT|ECONNREFUSED/) });
    });

    it('closes a live session when it turns off', async () => {
      const socketPath = await turnOn();
      const token = await addTokenAndCopy();
      const agent = await connectAgent(socketPath, token);
      sessions.push(() => agent.close().catch(() => undefined));
      expect(h.svc.sessionCount).toBe(1);

      await ok(IPC_CHANNELS.agentAccessDisable, {});

      await agent.closed;
      expect(h.svc.sessionCount).toBe(0);
    });

    it('cannot be written or read through the preferences channels', async () => {
      for (const env of [
        await invoke(IPC_CHANNELS.prefsSet, { key: AGENT_ACCESS_KEY, value: true }),
        await invoke(IPC_CHANNELS.prefsGet, { key: AGENT_ACCESS_KEY }),
      ]) {
        expect(env.ok).toBe(false);
      }
      expect(h.appState.get(AGENT_ACCESS_KEY)).not.toBe(true);
    });
  });

  /** Adds an Agent through the channel, confirming main's question, and returns the token its copied setup holds. */
  async function addTokenAndCopy(name = 'Claude Code'): Promise<string> {
    h.answers.push(COPY);
    const out = await ok<AgentCopyResult>(IPC_CHANNELS.agentAccessConnectClient, { name, client: 'claude-code' });
    if ('cancelled' in out) throw new Error('the copy confirm was not answered');
    return tokenInSetup(h.clipboard.at(-1)!);
  }

  describe('copying a setup (X27 §16.8)', () => {
    it('asks first, with Cancel as the default, and Cancel creates and copies nothing', async () => {
      h.answers.push(0);
      expect(await ok(IPC_CHANNELS.agentAccessConnectClient, { name: 'Claude Code', client: 'cursor' })).toEqual({ cancelled: true });
      expect(h.boxes).toHaveLength(1);
      const box = h.boxes[0]!;
      expect(box.buttons).toEqual(['Cancel', 'Copy setup']);
      expect([box.defaultId, box.cancelId]).toEqual([0, 0]);
      expect(box.message).toBe('Copy the setup for Cursor?');
      expect(box.detail).toBe('It contains a new Agent Token named “Claude Code”. Paste it into Cursor straight away.');
      expect(h.tokenRepo.list()).toHaveLength(0);
      expect(h.clipboard).toEqual([]);
    });

    it('treats a button it does not know as Cancel', async () => {
      h.answers.push(9);
      expect(await ok(IPC_CHANNELS.agentAccessConnectClient, { name: 'Claude Code', client: 'cursor' })).toEqual({ cancelled: true });
      expect(h.tokenRepo.list()).toHaveLength(0);
    });

    it('on confirm creates the token, copies its setup, and answers only once the write has returned', async () => {
      let release!: () => void;
      h.clipboardHold = new Promise<void>((resolve) => {
        release = resolve;
      });
      h.answers.push(COPY);
      let settled = false;
      const pending = invoke<AgentCopyResult>(IPC_CHANNELS.agentAccessConnectClient, { name: 'Claude Code', client: 'claude-code' }).then((env) => {
        settled = true;
        return env;
      });
      await vi.waitFor(() => expect(h.tokenRepo.list()).toHaveLength(1));
      await new Promise((resolve) => setTimeout(resolve, 20));
      expect(settled).toBe(false);
      release();
      const env = await pending;
      if (!env.ok) throw new Error(env.error.message);
      const row = h.tokenRepo.list()[0]!;
      expect(env.data).toEqual({ tokenId: row.id, copiedAt: expect.stringMatching(/^\d{4}-\d\d-\d\dT/) });
      const token = tokenInSetup(h.clipboard[0]!);
      expect(token).toMatch(TOKEN_RE);
      expect(token).toHaveLength(43);
      expect(row.token_hash).toBe(hashToken(token));
      expect(JSON.stringify(row)).not.toContain(token);
    });

    it("copies each client's own setup", async () => {
      for (const client of ['claude-code-cli', 'claude-code', 'claude-desktop', 'cursor'] as const) {
        h.answers.push(COPY);
        await ok(IPC_CHANNELS.agentAccessConnectClient, { name: client, client });
      }
      const [cli, code, desktop, cursor] = h.clipboard;
      // The harness path is plain characters, so it stays a bare word; quoting is unit-tested against a real shell.
      expect(cli).toMatch(new RegExp(`^claude mcp add latelier --scope user -e LATELIER_AGENT_TOKEN=[A-Za-z0-9_-]{43} -- ${h.bridge.installedPath}$`));
      const parsed = [code, desktop, cursor].map((c) => JSON.parse(c!).mcpServers.latelier);
      expect(parsed[0]).toEqual({ type: 'stdio', command: h.bridge.installedPath, args: [], env: { LATELIER_AGENT_TOKEN: expect.any(String) } });
      expect(parsed[1]).toEqual({ command: h.bridge.installedPath, args: [], env: { LATELIER_AGENT_TOKEN: expect.any(String) } });
      expect(parsed[2]).toEqual({ command: h.bridge.installedPath, args: [], env: { LATELIER_AGENT_TOKEN: expect.any(String) } });
      expect(h.boxes.map((b) => b.message)).toEqual([
        'Copy the setup for Claude Code (command)?',
        'Copy the setup for Claude Code (JSON)?',
        'Copy the setup for Claude Desktop?',
        'Copy the setup for Cursor?',
      ]);
    });

    it('leaves no token behind and says so when the clipboard write fails', async () => {
      h.clipboardFails = true;
      h.answers.push(COPY);
      const env = await invoke(IPC_CHANNELS.agentAccessConnectClient, { name: 'Claude Code', client: 'cursor' });
      expect(env.ok).toBe(false);
      if (!env.ok) {
        expect(env.error.code).toBe('INTERNAL');
        expect(env.error.message).toBe('The setup could not be copied, so the Agent was not added. Try again.');
      }
      expect(h.tokenRepo.list()).toEqual([]);
      expect(vi.mocked(h.log.warn)).toHaveBeenCalledWith('agent', 'could not copy the Agent setup', { errName: 'Error' });
    });

    it('states every setup with a placeholder, never a token', async () => {
      const token = await addTokenAndCopy();
      const state = await ok<AgentAccessState>(IPC_CHANNELS.agentAccessGetState, {});
      expect(state.claudeCodeCommand).toContain('LATELIER_AGENT_TOKEN=YOUR_TOKEN');
      expect(Object.keys(state.snippetTemplates)).toEqual(['claude-code-cli', 'claude-code', 'claude-desktop', 'cursor']);
      expect(state.snippetTemplates['claude-code-cli']).toBe(state.claudeCodeCommand);
      expect(tokenInSetup(state.snippetTemplates.cursor)).toBe('YOUR_TOKEN');
      expect(JSON.stringify(state)).not.toContain(token);
    });

    it('lets the token it copied connect', async () => {
      const socketPath = await turnOn();
      const token = await addTokenAndCopy();
      const agent = await connectAgent(socketPath, token);
      sessions.push(() => agent.close().catch(() => undefined));
      expect(textOf(await agent.client.callTool({ name: 'list_connections', arguments: {} }))).toContain('untrusted-data');
    });

    it('copy-setup: the confirm says the token is regenerated and the live session ends; Cancel changes nothing', async () => {
      const socketPath = await turnOn();
      const token = await addTokenAndCopy();
      const row = h.tokenRepo.list()[0]!;
      const agent = await connectAgent(socketPath, token);
      sessions.push(() => agent.close().catch(() => undefined));
      await vi.waitFor(() => expect(h.svc.sessionCount).toBe(1));

      h.answers.push(0);
      expect(await ok(IPC_CHANNELS.agentAccessCopySetup, { id: row.id, client: 'claude-desktop' })).toEqual({ cancelled: true });

      const box = h.boxes.at(-1)!;
      expect(box.buttons).toEqual(['Cancel', 'Copy setup']);
      expect([box.defaultId, box.cancelId]).toEqual([0, 0]);
      expect(box.message).toBe('Copy the Claude Desktop setup for “Claude Code”?');
      expect(box.detail).toBe(
        "It contains this Agent's token. Anything that can read your clipboard can use it until you revoke or regenerate it.\n\n" +
          'Copying it regenerates the token: a setup that holds the old one stops working. This Agent’s live session ends.',
      );
      expect(h.tokenRepo.findById(row.id)!.token_hash).toBe(row.token_hash);
      expect(h.clipboard).toHaveLength(1);
      expect(h.svc.sessionCount).toBe(1);
    });

    it('copy-setup counts the live sessions it will end, and names none when there are none', async () => {
      const socketPath = await turnOn();
      const token = await addTokenAndCopy();
      const id = h.tokenRepo.list()[0]!.id;
      h.answers.push(0);
      await ok(IPC_CHANNELS.agentAccessCopySetup, { id, client: 'cursor' });
      expect(h.boxes.at(-1)!.detail).toMatch(/stops working\.$/);
      const a = await connectAgent(socketPath, token);
      const b = await connectAgent(socketPath, token);
      sessions.push(() => a.close().catch(() => undefined), () => b.close().catch(() => undefined));
      await vi.waitFor(() => expect(h.svc.sessionCount).toBe(2));
      h.answers.push(0);
      await ok(IPC_CHANNELS.agentAccessCopySetup, { id, client: 'cursor' });
      expect(h.boxes.at(-1)!.detail).toMatch(/This Agent’s 2 live sessions end\.$/);
    });

    it('copy-setup on confirm regenerates: the old token stops, its session ends, and the copied one connects', async () => {
      const socketPath = await turnOn();
      const oldToken = await addTokenAndCopy();
      const id = h.tokenRepo.list()[0]!.id;
      const agent = await connectAgent(socketPath, oldToken);
      sessions.push(() => agent.close().catch(() => undefined));
      await vi.waitFor(() => expect(h.svc.sessionCount).toBe(1));

      h.answers.push(COPY);
      const out = await ok<AgentCopyResult>(IPC_CHANNELS.agentAccessCopySetup, { id, client: 'claude-code' });

      expect(out).toEqual({ tokenId: id, copiedAt: expect.any(String) });
      await agent.closed;
      const [ended] = await ok<Array<{ endReason: string }>>(IPC_CHANNELS.agentAccessListSessions, { includeEnded: true, limit: 10 });
      expect(ended!.endReason).toBe('token-revoked');
      const newToken = tokenInSetup(h.clipboard.at(-1)!);
      expect(newToken).not.toBe(oldToken);
      const refused = await openSocket(socketPath);
      refused.write(handshakeLine(oldToken));
      expect(await readUntilClosed(refused)).toContain('Agent token refused');
      const fresh = await connectAgent(socketPath, newToken);
      sessions.push(() => fresh.close().catch(() => undefined));
    });

    it('copy-setup says the token was regenerated when the clipboard write fails', async () => {
      await addTokenAndCopy();
      const row = h.tokenRepo.list()[0]!;
      h.clipboardFails = true;
      h.answers.push(COPY);
      const env = await invoke(IPC_CHANNELS.agentAccessCopySetup, { id: row.id, client: 'cursor' });
      expect(env.ok).toBe(false);
      if (!env.ok) {
        expect(env.error.code).toBe('INTERNAL');
        expect(env.error.message).toBe('The token was regenerated, but the setup could not be copied. Copy the setup again.');
      }
      expect(h.tokenRepo.findById(row.id)!.token_hash).not.toBe(row.token_hash);
    });

    it('answers NOT_FOUND for a token that does not exist, without showing a dialog', async () => {
      const id = randomUUID();
      for (const [channel, payload] of [
        [IPC_CHANNELS.agentAccessCopySetup, { id, client: 'cursor' }],
        [IPC_CHANNELS.agentAccessRenameToken, { id, name: 'x' }],
        [IPC_CHANNELS.agentAccessRevokeToken, { id }],
      ] as const) {
        const env = await invoke(channel, payload);
        expect(env.ok).toBe(false);
        if (!env.ok) expect(env.error.code).toBe('NOT_FOUND');
      }
      expect(h.boxes).toHaveLength(0);
    });

    it('never lets a token reach an envelope, a pushed state, a log line or the state', async () => {
      await turnOn();
      const envelopes: unknown[] = [];
      h.answers.push(COPY);
      const addEnv = await invoke<AgentCopyResult>(IPC_CHANNELS.agentAccessConnectClient, { name: 'Claude Code', client: 'claude-code' });
      envelopes.push(addEnv);
      const token = tokenInSetup(h.clipboard.at(-1)!);
      // Not vacuous: the token really is on the clipboard and valid.
      expect(token).toMatch(TOKEN_RE);

      const id = h.tokenRepo.list()[0]!.id;
      h.answers.push(COPY);
      envelopes.push(await invoke(IPC_CHANNELS.agentAccessCopySetup, { id, client: 'claude-code' }));
      const regenerated = tokenInSetup(h.clipboard.at(-1)!);
      expect(regenerated).toMatch(TOKEN_RE);
      expect(regenerated).not.toBe(token);
      envelopes.push(await invoke(IPC_CHANNELS.agentAccessRenameToken, { id, name: 'Renamed' }));
      envelopes.push(await invoke(IPC_CHANNELS.agentAccessGetState, {}));
      envelopes.push(await invoke(IPC_CHANNELS.agentAccessRevokeToken, { id }));
      envelopes.push(await invoke(IPC_CHANNELS.agentAccessRevokeToken, { id }));
      envelopes.push(await invoke(IPC_CHANNELS.agentAccessCopySetup, { id, client: 'cursor' }));
      await ok(IPC_CHANNELS.agentAccessDisable, {});

      const everything = JSON.stringify([envelopes, h.states, h.boxes, vi.mocked(h.log.info).mock.calls, vi.mocked(h.log.warn).mock.calls, vi.mocked(h.log.error).mock.calls, vi.mocked(h.log.debug).mock.calls]);
      for (const secret of [token, regenerated, hashToken(token), hashToken(regenerated)]) {
        expect(everything).not.toContain(secret);
      }
      expect(h.states.length).toBeGreaterThan(0);
    });

    it('revokes: the row goes, the live session closes and the list shrinks', async () => {
      const socketPath = await turnOn();
      const token = await addTokenAndCopy();
      const id = h.tokenRepo.list()[0]!.id;
      const agent = await connectAgent(socketPath, token);
      sessions.push(() => agent.close().catch(() => undefined));

      expect(await ok(IPC_CHANNELS.agentAccessRevokeToken, { id })).toEqual({ ok: true });

      await agent.closed;
      expect(h.tokenRepo.findById(id)).toBeNull();
      expect((await ok<AgentAccessState>(IPC_CHANNELS.agentAccessGetState, {})).tokens).toEqual([]);
    });

    it('lists tokens by name, creation and last use, never by token or hash', async () => {
      await addTokenAndCopy('One');
      const state = await ok<AgentAccessState>(IPC_CHANNELS.agentAccessGetState, {});
      expect(state.tokens).toHaveLength(1);
      for (const key of Object.keys(state.tokens[0]!)) expect(['id', 'name', 'createdAt', 'lastUsedAt']).toContain(key);
    });
  });

  describe('renaming an Agent', () => {
    it('renames it, trimmed, and pushes the state', async () => {
      await addTokenAndCopy('Old');
      const id = h.tokenRepo.list()[0]!.id;
      const info = await ok<AgentTokenInfo>(IPC_CHANNELS.agentAccessRenameToken, { id, name: '  New name  ' });
      expect(info).toMatchObject({ id, name: 'New name' });
      expect(h.tokenRepo.findById(id)!.name).toBe('New name');
      expect(h.states.at(-1)!.tokens).toEqual([expect.objectContaining({ id, name: 'New name' })]);
    });

    it('keeps the name each log row was written with, and a live session writes the new one from its next call', async () => {
      const socketPath = await turnOn();
      const token = await addTokenAndCopy('Old');
      const id = h.tokenRepo.list()[0]!.id;
      const agent = await connectAgent(socketPath, token);
      sessions.push(() => agent.close().catch(() => undefined));
      await agent.client.callTool({ name: 'list_connections', arguments: {} });

      await ok(IPC_CHANNELS.agentAccessRenameToken, { id, name: 'New' });
      // Two rows in one millisecond would page in id order, not call order.
      await new Promise((resolve) => setTimeout(resolve, 5));
      await agent.client.callTool({ name: 'list_connections', arguments: {} });

      const calls = await ok<Array<{ tokenName: string }>>(IPC_CHANNELS.agentAccessListCalls, { outcome: 'all', limit: 10 });
      expect(calls.map((c) => c.tokenName)).toEqual(['New', 'Old']);
      expect(h.svc.liveSessions()[0]!.tokenName).toBe('New');
      // The session row is a copy taken when the session was counted.
      const [session] = await ok<Array<{ tokenName: string }>>(IPC_CHANNELS.agentAccessListSessions, { includeEnded: true, limit: 10 });
      expect(session!.tokenName).toBe('Old');
    });

    it("renames the Agent on its open Connection requests, and pushes them", async () => {
      const socketPath = await turnOn();
      const token = await addTokenAndCopy('Old');
      const id = h.tokenRepo.list()[0]!.id;
      const connectionId = randomUUID();
      h.addConnection(connectionId, 'prod', { shared: true });
      const agent = await connectAgent(socketPath, token);
      sessions.push(() => agent.close().catch(() => undefined));
      await agent.client.callTool({ name: 'find', arguments: { connectionId, database: 'shop', collection: 'orders' } });

      await ok(IPC_CHANNELS.agentAccessRenameToken, { id, name: 'New' });
      expect(h.states.at(-1)!.connectionRequests).toEqual([expect.objectContaining({ connectionId, tokenName: 'New' })]);
      const state = await ok<AgentAccessState>(IPC_CHANNELS.agentAccessGetState, {});
      expect(state.connectionRequests).toEqual([expect.objectContaining({ connectionId, tokenName: 'New' })]);
    });
  });

  describe('clearing the copied setup', () => {
    afterEach(() => {
      vi.useRealTimers();
    });

    it('clears it five minutes after the copy when the clipboard still holds it, and not before', async () => {
      vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
      await addTokenAndCopy();
      await vi.advanceTimersByTimeAsync(CLIPBOARD_CLEAR_MS - 1);
      expect(h.clipboardClears).toBe(0);
      await vi.advanceTimersByTimeAsync(1);
      expect(h.clipboardClears).toBe(1);
      expect(h.clipboardText).toBe('');
    });

    it('leaves the clipboard alone when the user copied something else since', async () => {
      vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
      await addTokenAndCopy();
      h.clipboardText = 'something the user copied';
      await vi.advanceTimersByTimeAsync(CLIPBOARD_CLEAR_MS);
      expect(h.clipboardClears).toBe(0);
      expect(h.clipboardText).toBe('something the user copied');
    });

    it('times a second copy from its own write, and clears only that one', async () => {
      vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
      await addTokenAndCopy('One');
      await vi.advanceTimersByTimeAsync(CLIPBOARD_CLEAR_MS - 1000);
      await addTokenAndCopy('Two');
      await vi.advanceTimersByTimeAsync(1000);
      expect(h.clipboardClears).toBe(0);
      await vi.advanceTimersByTimeAsync(CLIPBOARD_CLEAR_MS - 1000);
      expect(h.clipboardClears).toBe(1);
    });

    it('clears it at quit when it still holds the setup, and leaves it otherwise', async () => {
      await addTokenAndCopy();
      await h.svc.stop();
      expect(h.clipboardClears).toBe(1);

      await h.cleanup();
      setup();
      await addTokenAndCopy();
      h.clipboardText = 'mine';
      await h.svc.stop();
      expect(h.clipboardClears).toBe(0);
      expect(h.clipboardText).toBe('mine');
    });

    it('still quits when the clipboard cannot be read, and logs it by class', async () => {
      await addTokenAndCopy();
      h.clipboardReadFails = true;
      await h.svc.stop();
      expect(h.clipboardClears).toBe(0);
      expect(vi.mocked(h.log.warn)).toHaveBeenCalledWith('agent', 'could not clear the copied Agent setup', { errName: 'Error' });
    });

    it('does nothing at quit when nothing was copied', async () => {
      await h.svc.stop();
      expect(h.clipboardClears).toBe(0);
    });
  });

  describe('Connection requests (X27 §16.6)', () => {
    const find = (connectionId: string) => ({ name: 'find', arguments: { connectionId, database: 'shop', collection: 'orders' } });

    async function agentOnClosedShare() {
      const socketPath = await turnOn();
      const token = await addTokenAndCopy();
      const connectionId = randomUUID();
      h.addConnection(connectionId, 'prod', { shared: true });
      const agent = await connectAgent(socketPath, token);
      sessions.push(() => agent.close().catch(() => undefined));
      const sessionId = h.svc.liveSessions()[0]!.id;
      return { agent, connectionId, sessionId };
    }

    const requests = async () => (await ok<AgentAccessState>(IPC_CHANNELS.agentAccessGetState, {})).connectionRequests;

    it('turns a NOT_OPEN refusal into one request, pushed at once, and tells the Agent the user was asked', async () => {
      const { agent, connectionId, sessionId } = await agentOnClosedShare();
      const before = h.states.length;
      const result = await agent.client.callTool(find(connectionId));
      expect(textOf(result)).toBe("NOT_OPEN: This Connection is not open. L'Atelier has asked the user to open it; try again after they do.");
      // Not the coalesced push: a new request goes out with the row.
      expect(h.states.slice(before).some((s) => s.connectionRequests.length === 1)).toBe(true);
      expect(await requests()).toEqual([
        {
          sessionId,
          tokenName: 'Claude Code',
          clientName: 'spec-client',
          folder: null,
          connectionId,
          connectionName: 'prod',
          firstAt: expect.any(String),
          lastAt: expect.any(String),
          count: 1,
          lastTool: 'find',
          database: 'shop',
          collection: 'orders',
          lastOutcome: 'refused',
        },
      ]);
      await agent.client.callTool({ name: 'count', arguments: { connectionId, database: 'crm', collection: 'leads' } });
      expect(await requests()).toEqual([expect.objectContaining({ count: 2, lastTool: 'count', database: 'crm', collection: 'leads' })]);
    });

    it('ends the request when the Connection opens', async () => {
      const { agent, connectionId } = await agentOnClosedShare();
      await agent.client.callTool(find(connectionId));
      (h.pool as unknown as EventEmitter).emit('status', { id: connectionId, status: 'connecting' });
      expect(await requests()).toHaveLength(1);
      (h.pool as unknown as EventEmitter).emit('status', { id: connectionId, status: 'connected' });
      expect(h.states.at(-1)!.connectionRequests).toEqual([]);
      expect(await requests()).toEqual([]);
    });

    it('ends it on dismiss, and the pair makes no new one in that session while the refusal is still logged', async () => {
      const { agent, connectionId, sessionId } = await agentOnClosedShare();
      await agent.client.callTool(find(connectionId));
      expect(await ok(IPC_CHANNELS.agentAccessDismissRequest, { sessionId, connectionId })).toEqual({ ok: true });
      expect(h.states.at(-1)!.connectionRequests).toEqual([]);
      // The Agent is told the user chose not to open it, so it stops retrying.
      expect(textOf(await agent.client.callTool(find(connectionId)))).toBe(`NOT_OPEN: ${NOT_OPEN_DECLINED_MESSAGE}`);
      expect(await requests()).toEqual([]);
      const calls = await ok<Array<{ outcome: string }>>(IPC_CHANNELS.agentAccessListCalls, { connectionId, outcome: 'all', limit: 10 });
      expect(calls.map((c) => c.outcome)).toEqual(['NOT_OPEN', 'NOT_OPEN']);
    });

    it('answers a dismiss for a session that is not live without remembering it', async () => {
      const sessionId = randomUUID();
      const connectionId = randomUUID();
      expect(await ok(IPC_CHANNELS.agentAccessDismissRequest, { sessionId, connectionId })).toEqual({ ok: true });
      const held = (h.svc as unknown as { requests: ConnectionRequests }).requests;
      expect(held.isDismissed(sessionId, connectionId)).toBe(false);
    });

    it('makes none for a row whose session is no longer live', async () => {
      const { connectionId } = await agentOnClosedShare();
      const row: AgentCallSummary = {
        id: randomUUID(),
        sessionId: randomUUID(),
        ts: new Date().toISOString(),
        tokenId: null,
        tokenName: 'Claude Code',
        clientName: 'spec-client',
        clientVersion: '1.0.0',
        connectionId,
        connectionName: 'prod',
        database: 'shop',
        collection: 'orders',
        tool: 'find',
        docCount: 0,
        bytes: 0,
        durationMs: 1,
        outcome: 'NOT_OPEN',
        truncated: false,
      };
      // The row a call writes after its session closed: nothing reaches it through the socket.
      (h.svc as unknown as { onRowWritten(r: AgentCallSummary): void }).onRowWritten(row);
      expect(await requests()).toEqual([]);
    });

    it('ends it when its session ends', async () => {
      const { agent, connectionId } = await agentOnClosedShare();
      await agent.client.callTool(find(connectionId));
      await agent.close();
      await vi.waitFor(() => expect(h.states.at(-1)!.connectionRequests).toEqual([]));
    });

    it('ends it when the Connection is unshared', async () => {
      const { agent, connectionId } = await agentOnClosedShare();
      await agent.client.callTool(find(connectionId));
      await ok(IPC_CHANNELS.agentAccessSetShared, { connectionId, shared: false });
      expect(await requests()).toEqual([]);
    });

    it('ends it when the Connection is deleted or edited elsewhere', async () => {
      const { agent, connectionId } = await agentOnClosedShare();
      await agent.client.callTool(find(connectionId));
      (h.pool as unknown as EventEmitter).emit('connection-identity-changed', connectionId);
      expect(await requests()).toEqual([]);
    });

    it('makes none for NOT_SHARED: an unshared Connection or an id the Agent guessed', async () => {
      const { agent } = await agentOnClosedShare();
      const unshared = randomUUID();
      h.addConnection(unshared, 'stage');
      for (const id of [unshared, randomUUID()]) {
        expect(textOf(await agent.client.callTool(find(id)))).toMatch(/^NOT_SHARED: /);
      }
      expect(await requests()).toEqual([]);
    });
  });

  describe('Connection requests on a clock', () => {
    it('drops a request 30 minutes after its last refusal', async () => {
      let now = Date.parse('2026-11-27T10:00:00.000Z');
      await h.cleanup();
      setup('darwin', () => now);
      const socketPath = await turnOn();
      const token = await addTokenAndCopy();
      const connectionId = randomUUID();
      h.addConnection(connectionId, 'prod', { shared: true });
      const agent = await connectAgent(socketPath, token);
      sessions.push(() => agent.close().catch(() => undefined));
      await agent.client.callTool({ name: 'find', arguments: { connectionId, database: 'd', collection: 'c' } });
      now += 30 * 60 * 1000 - 1;
      expect((await ok<AgentAccessState>(IPC_CHANNELS.agentAccessGetState, {})).connectionRequests).toHaveLength(1);
      now += 1;
      expect((await ok<AgentAccessState>(IPC_CHANNELS.agentAccessGetState, {})).connectionRequests).toEqual([]);
    });
  });

  describe('sharing through the channel', () => {
    it('shares an open Connection after the dialog, and reports the verdict', async () => {
      const id = randomUUID();
      h.addConnection(id, 'prod', { status: 'connected' });
      const client = { db: () => ({ command: async () => ({ authInfo: { authenticatedUsers: [], authenticatedUserRoles: [], authenticatedUserPrivileges: [] } }) }) };
      vi.spyOn(h.pool, 'readClient').mockResolvedValue(client as never);
      h.answers.push(1);

      const out = await ok<{ shared: boolean; privilege?: { kind: string } }>(IPC_CHANNELS.agentAccessSetShared, { connectionId: id, shared: true });

      expect(out.shared).toBe(true);
      expect(out.privilege?.kind).toBe('no-auth');
      expect(h.connRepo.findById(id)?.share_with_agents).toBe(1);
    });

    it('while off, one "Turn on and share" dialog turns Agent Access on and shares, and the server listens', async () => {
      const id = randomUUID();
      h.addConnection(id, 'prod', { status: 'connected' });
      const client = { db: () => ({ command: async () => ({ authInfo: { authenticatedUsers: [], authenticatedUserRoles: [], authenticatedUserPrivileges: [] } }) }) };
      vi.spyOn(h.pool, 'readClient').mockResolvedValue(client as never);
      h.answers.push(1);

      const out = await ok<{ shared: boolean }>(IPC_CHANNELS.agentAccessSetShared, { connectionId: id, shared: true });

      expect(out.shared).toBe(true);
      expect(h.boxes.map((b) => b.buttons)).toEqual([['Cancel', 'Turn on and share']]);
      const state = await ok<AgentAccessState>(IPC_CHANNELS.agentAccessGetState, {});
      expect(state.enabled).toBe(true);
      expect(state.socketPath).not.toBe('');
      const sock = await openSocket(state.socketPath);
      sock.destroy();
    });

    it('while off, cancelling the combined dialog leaves the switch off and the Connection unshared', async () => {
      const id = randomUUID();
      h.addConnection(id, 'prod', { status: 'connected' });
      const client = { db: () => ({ command: async () => ({ authInfo: { authenticatedUsers: [], authenticatedUserRoles: [], authenticatedUserPrivileges: [] } }) }) };
      vi.spyOn(h.pool, 'readClient').mockResolvedValue(client as never);

      expect((await ok<{ shared: boolean }>(IPC_CHANNELS.agentAccessSetShared, { connectionId: id, shared: true })).shared).toBe(false);
      expect((await ok<AgentAccessState>(IPC_CHANNELS.agentAccessGetState, {})).enabled).toBe(false);
      expect(h.connRepo.findById(id)?.share_with_agents).toBe(0);
    });

    it('unshares through the channel at once, with no dialog', async () => {
      const id = randomUUID();
      h.addConnection(id, 'prod', { shared: true });
      expect(await ok(IPC_CHANNELS.agentAccessSetShared, { connectionId: id, shared: false })).toEqual({ shared: false });
      expect(h.connRepo.findById(id)?.share_with_agents).toBe(0);
      expect(h.boxes).toHaveLength(0);
    });

    it('treats two share clicks on one Connection as one question', async () => {
      const id = randomUUID();
      h.addConnection(id, 'prod');
      const [a, b] = await Promise.all([
        invoke(IPC_CHANNELS.agentAccessSetShared, { connectionId: id, shared: true }),
        invoke(IPC_CHANNELS.agentAccessSetShared, { connectionId: id, shared: true }),
      ]);
      expect(a).toEqual(b);
      expect(h.boxes).toHaveLength(1);
    });

    it('answers {shared:false} and asks to open a Connection that is not open', async () => {
      const id = randomUUID();
      h.addConnection(id, 'prod');
      expect(await ok(IPC_CHANNELS.agentAccessSetShared, { connectionId: id, shared: true })).toEqual({ shared: false });
      expect(h.boxes[0]!.title).toBe('Open this Connection first');
    });

    it('prints a Connection name with unsafe characters taken out in the share dialogs', async () => {
      const id = randomUUID();
      h.addConnection(id, 'prod\n\u202Ex');
      await ok(IPC_CHANNELS.agentAccessSetShared, { connectionId: id, shared: true });
      expect(h.boxes[0]!.message).toBe('Open "prod x" first');
    });

    it('answers VALIDATION with a clear message for an SSH-tunnelled Connection', async () => {
      const id = randomUUID();
      h.addConnection(id, 'tunnelled', { status: 'connected' });
      h.tmp.db.prepare('UPDATE connections SET ssh_enabled = 1 WHERE id = ?').run(id);
      const env = await invoke(IPC_CHANNELS.agentAccessSetShared, { connectionId: id, shared: true });
      expect(env.ok).toBe(false);
      if (!env.ok) {
        expect(env.error.code).toBe('VALIDATION');
        expect(env.error.message).toContain('SSH tunnel');
      }
    });

    it('answers NOT_FOUND for a Connection that does not exist', async () => {
      const env = await invoke(IPC_CHANNELS.agentAccessSetShared, { connectionId: randomUUID(), shared: false });
      expect(env.ok).toBe(false);
      if (!env.ok) expect(env.error.code).toBe('NOT_FOUND');
    });
  });

  describe('the share flag through the general Connection channels', () => {
    const payload = (name: string, extra: Record<string, unknown> = {}) => ({ ...connInput(name), ...extra });

    it('conn:create strips shareWithAgents: the stored flag stays 0', async () => {
      const conn = await ok<Connection>(IPC_CHANNELS.connCreate, payload('A', { shareWithAgents: true }));
      expect(h.connRepo.findById(conn.id)?.share_with_agents).toBe(0);
      expect(conn.shareWithAgents).toBe(false);
    });

    it('conn:update strips shareWithAgents in both directions, leaving the stored flag as it was', async () => {
      const conn = await ok<Connection>(IPC_CHANNELS.connCreate, payload('A'));
      await ok(IPC_CHANNELS.connUpdate, { id: conn.id, patch: { shareWithAgents: true } });
      expect(h.connRepo.findById(conn.id)?.share_with_agents).toBe(0);

      h.connRepo.setShared(conn.id, true);
      await ok(IPC_CHANNELS.connUpdate, { id: conn.id, patch: { name: 'A2', shareWithAgents: false } });
      const row = h.connRepo.findById(conn.id)!;
      expect(row.name).toBe('A2');
      expect(row.share_with_agents).toBe(1);
    });

    it('an ordinary edit does not unshare a shared Connection', async () => {
      const conn = await ok<Connection>(IPC_CHANNELS.connCreate, payload('A'));
      h.connRepo.setShared(conn.id, true);
      await ok(IPC_CHANNELS.connUpdate, { id: conn.id, patch: { color: '#112233' } });
      expect(h.connRepo.findById(conn.id)?.share_with_agents).toBe(1);
    });
  });

  describe('a share that does not survive a change of identity', () => {
    const okClient = { db: () => ({ command: async () => ({ authInfo: { authenticatedUsers: [], authenticatedUserRoles: [], authenticatedUserPrivileges: [] } }) }) };

    it('conn:update to another host ends the share', async () => {
      const conn = await ok<Connection>(IPC_CHANNELS.connCreate, connInput('A'));
      h.connRepo.setShared(conn.id, true);
      await ok(IPC_CHANNELS.connUpdate, { id: conn.id, patch: { host: 'elsewhere.example' } });
      expect(h.connRepo.findById(conn.id)?.share_with_agents).toBe(0);
    });

    it('refuses to share a Connection that was edited while the question was open, and writes no flag', async () => {
      const id = randomUUID();
      h.addConnection(id, 'prod', { status: 'connected' });
      vi.spyOn(h.pool, 'readClient').mockResolvedValue(okClient as never);
      h.answers.push(1);
      h.onBox = () => void h.tmp.db.prepare("UPDATE connections SET host = 'elsewhere.example' WHERE id = ?").run(id);
      const env = await invoke(IPC_CHANNELS.agentAccessSetShared, { connectionId: id, shared: true });
      expect(env.ok).toBe(false);
      if (!env.ok) expect(env.error.code).toBe('CONFLICT');
      expect(h.connRepo.findById(id)?.share_with_agents).toBe(0);
    });

    it('refuses when the Connection moved to an SSH tunnel, or was deleted, while the question was open', async () => {
      const tunnelled = randomUUID();
      h.addConnection(tunnelled, 'tunnelled', { status: 'connected' });
      vi.spyOn(h.pool, 'readClient').mockResolvedValue(okClient as never);
      h.answers.push(1);
      h.onBox = () => void h.tmp.db.prepare('UPDATE connections SET ssh_enabled = 1 WHERE id = ?').run(tunnelled);
      const first = await invoke(IPC_CHANNELS.agentAccessSetShared, { connectionId: tunnelled, shared: true });
      expect(first.ok).toBe(false);
      expect(h.connRepo.findById(tunnelled)?.share_with_agents).toBe(0);

      const gone = randomUUID();
      h.addConnection(gone, 'gone', { status: 'connected' });
      h.answers.push(1);
      h.onBox = () => h.connRepo.deleteById(gone);
      const second = await invoke(IPC_CHANNELS.agentAccessSetShared, { connectionId: gone, shared: true });
      expect(second.ok).toBe(false);
      if (!second.ok) expect(second.error.code).toBe('NOT_FOUND');
    });

    it('still shares when only something a server does not see changed during the question', async () => {
      const id = randomUUID();
      h.addConnection(id, 'prod', { status: 'connected' });
      vi.spyOn(h.pool, 'readClient').mockResolvedValue(okClient as never);
      h.answers.push(1);
      h.onBox = () => void h.tmp.db.prepare("UPDATE connections SET color = '#112233', last_used_at = ? WHERE id = ?").run(new Date().toISOString(), id);
      expect(await ok(IPC_CHANNELS.agentAccessSetShared, { connectionId: id, shared: true })).toMatchObject({ shared: true });
    });

    it('drops the privilege verdict of a Connection whose identity changed', async () => {
      const id = randomUUID();
      h.addConnection(id, 'prod', { status: 'connected' });
      vi.spyOn(h.pool, 'readClient').mockResolvedValue(okClient as never);
      h.answers.push(1);
      await ok(IPC_CHANNELS.agentAccessSetShared, { connectionId: id, shared: true });
      expect((await ok<AgentAccessState>(IPC_CHANNELS.agentAccessGetState, {})).privilege[id]).toBeDefined();

      (h.pool as unknown as NodeJS.EventEmitter).emit('connection-identity-changed', id);
      // Shared again without the dialog, as a stale verdict would be shown for it.
      h.connRepo.setShared(id, false);
      h.connRepo.setShared(id, true);
      expect((await ok<AgentAccessState>(IPC_CHANNELS.agentAccessGetState, {})).privilege[id]).toBeUndefined();
    });
  });

  describe('the bridge copy', () => {
    it('refuses to remove the bridge while Agent Access is on, and leaves it installed', async () => {
      await turnOn();
      const env = await invoke(IPC_CHANNELS.agentAccessRemoveBridge, {});
      expect(env.ok).toBe(false);
      if (!env.ok) expect(env.error.code).toBe('CONFLICT');
      expect(h.bridge.installed).toBe(true);
    });

    it('removes it once Agent Access is off, and says whether it was there', async () => {
      await turnOn();
      await ok(IPC_CHANNELS.agentAccessDisable, {});
      expect(await ok(IPC_CHANNELS.agentAccessRemoveBridge, {})).toEqual({ removed: true });
      expect(await ok(IPC_CHANNELS.agentAccessRemoveBridge, {})).toEqual({ removed: false });
      expect(h.bridge.installed).toBe(false);
    });

    it('does not put the copy back behind the user back after it was removed while off', async () => {
      await turnOn();
      await ok(IPC_CHANNELS.agentAccessDisable, {});
      await ok(IPC_CHANNELS.agentAccessRemoveBridge, {});
      expect(h.bridge.copies).toBe(1);
    });
  });

  describe('state pushed to the renderer', () => {
    it('pushes on turning on and off, with the right socket path and session count', async () => {
      await turnOn();
      const on = h.states.at(-1)!;
      expect(on.enabled).toBe(true);
      expect(on.socketPath).toBe(h.svc.socketPath);

      await ok(IPC_CHANNELS.agentAccessDisable, {});
      const off = h.states.at(-1)!;
      expect(off.enabled).toBe(false);
      expect(off.socketPath).toBe('');
    });

    it('pushes when a session opens and when it closes', async () => {
      const socketPath = await turnOn();
      const token = await addTokenAndCopy();
      const agent = await connectAgent(socketPath, token);
      await vi.waitFor(() => expect(h.states.at(-1)!.sessionCount).toBe(1));
      await agent.close();
      await vi.waitFor(() => expect(h.states.at(-1)!.sessionCount).toBe(0));
    });

    it('pushes after a token is added and after it is revoked', async () => {
      const before = h.states.length;
      await addTokenAndCopy();
      expect(h.states.length).toBeGreaterThan(before);
      expect(h.states.at(-1)!.tokens).toHaveLength(1);
      await ok(IPC_CHANNELS.agentAccessRevokeToken, { id: h.tokenRepo.list()[0]!.id });
      expect(h.states.at(-1)!.tokens).toHaveLength(0);
    });

    it('pushes nothing after stop, even when something later changes', async () => {
      await h.svc.stop();
      const after = h.states.length;
      h.answers.push(COPY);
      expect(await h.svc.connectClient('Late', 'cursor')).toEqual({ cancelled: true });
      expect(h.states).toHaveLength(after);
      expect(h.tokenRepo.list()).toEqual([]);
      expect(h.clipboard).toEqual([]);
    });

    it('creates no Agent when the app starts quitting while the copy question is open', async () => {
      h.onBox = () => void h.svc.stop();
      h.answers.push(COPY);
      expect(await h.svc.connectClient('Late', 'cursor')).toEqual({ cancelled: true });
      expect(h.tokenRepo.list()).toEqual([]);
      expect(h.clipboard).toEqual([]);
    });

    it('keeps the old token when the app starts quitting while the copy-setup question is open', async () => {
      await addTokenAndCopy();
      const before = h.tokenRepo.list()[0]!;
      const copies = h.clipboard.length;
      h.onBox = () => void h.svc.stop();
      h.answers.push(COPY);
      expect(await h.svc.copySetup(before.id, 'cursor')).toEqual({ cancelled: true });
      expect(h.tokenRepo.list()).toEqual([before]);
      expect(h.clipboard).toHaveLength(copies);
    });

    it('folds a burst of reads into one push of the count, and pushes nothing once stopped', async () => {
      const socketPath = await turnOn();
      const token = await addTokenAndCopy();
      const agent = await connectAgent(socketPath, token);
      sessions.push(() => agent.close().catch(() => undefined));
      const call = () => agent.client.callTool({ name: 'list_connections', arguments: {} });

      await call();
      await call();
      await call();

      await vi.waitFor(() => expect(h.states.at(-1)!.sessionReadCount).toBe(3), { timeout: 2_000 });
      const counts = h.states.map((s) => s.sessionReadCount);
      expect(counts).not.toContain(1);
      expect(counts).not.toContain(2);

      await call();
      await h.svc.stop();
      const after = h.states.length;
      await new Promise((resolve) => setTimeout(resolve, 400));
      expect(h.states).toHaveLength(after);
    });
  });
});
