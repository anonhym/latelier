import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import net from 'node:net';
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
import type { AgentAccessState, AgentTokenInfo, Connection, ConnectionInput } from '../../shared/types';
import { createAgentHarness, type AgentHarness } from '../helpers/agentHarness';
import { connectAgent, handshakeLine, openSocket, readUntilClosed, textOf } from '../helpers/agentSocket';
import { createIpcShim } from '../helpers/ipcShim';
import { createSafeStorageMock } from '../helpers/safeStorageMock';

const TURN_ON = 1;
const COPY_CLAUDE_CODE_COMMAND = 1;
const COPY_CLAUDE_CODE = 2;
const COPY_CLAUDE_DESKTOP = 3;
const COPY_CURSOR = 4;

/** The token in a token dialog is the last paragraph of its detail. */
function tokenIn(detail: string): string {
  return detail.split('\n\n').at(-1)!;
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

  function setup(platform: NodeJS.Platform = 'darwin') {
    h = createAgentHarness({ platform });
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
      ['no name', {}],
      ['an empty name', { name: '' }],
      ['a blank name', { name: '   ' }],
      ['a name over 64 characters', { name: 'x'.repeat(65) }],
      ['a name that is not a string', { name: 7 }],
      ['a name with a newline', { name: 'Claude\nTurn on?' }],
      ['a name with a control character', { name: 'a\u0007b' }],
      ['a name with a bidi override', { name: 'Claude\u202EedoC' }],
      ['a name with a line separator', { name: 'Claude\u2028Turn on?' }],
      ['a name with a paragraph separator', { name: 'Claude\u2029Turn on?' }],
      ['a name with a zero-width space', { name: 'Clau\u200Bde' }],
      ['a name with a private-use character', { name: 'Clau\uE000de' }],
      ['an extra key', { name: 'ok', token: 'abc' }],
    ])('add-token refuses %s', async (_name, payload) => {
      const env = await invoke(IPC_CHANNELS.agentAccessAddToken, payload);
      expect(env.ok).toBe(false);
      if (!env.ok) expect(env.error.code).toBe('VALIDATION');
      expect(h.tokenRepo.list()).toHaveLength(0);
      expect(h.boxes).toHaveLength(0);
    });

    it.each([IPC_CHANNELS.agentAccessRegenerateToken, IPC_CHANNELS.agentAccessRevokeToken])(
      '%s refuses an id that is not a uuid and an extra key',
      async (channel) => {
        for (const payload of [{ id: 'abc' }, {}, { id: randomUUID(), extra: 1 }, undefined]) {
          const env = await invoke(channel, payload);
          expect(env.ok).toBe(false);
          if (!env.ok) expect(env.error.code).toBe('VALIDATION');
        }
      },
    );

    it('accepts a name of exactly 64 characters', async () => {
      const info = await ok<AgentTokenInfo>(IPC_CHANNELS.agentAccessAddToken, { name: 'n'.repeat(64) });
      expect(info.name).toHaveLength(64);
    });

    it('accepts an ordinary Unicode name as it is', async () => {
      const info = await ok<AgentTokenInfo>(IPC_CHANNELS.agentAccessAddToken, { name: 'Café 笔记本' });
      expect(info.name).toBe('Café 笔记本');
      expect(h.boxes[0]!.message).toBe('Token for "Café 笔记本"');
    });

    it('prints a stored name that is not safe with the unsafe characters taken out', async () => {
      h.tokenRepo.insert({ id: randomUUID(), name: 'Evil\n\u202EDone?', token_hash: hashToken('x'), created_at: 'now', last_used_at: null });
      const id = h.tokenRepo.list()[0]!.id;
      await ok(IPC_CHANNELS.agentAccessRegenerateToken, { id });
      expect(h.boxes[0]!.message).toBe('New token for "Evil Done?"');
    });

    it('trims the name it stores', async () => {
      const info = await ok<AgentTokenInfo>(IPC_CHANNELS.agentAccessAddToken, { name: '  Claude Code  ' });
      expect(info.name).toBe('Claude Code');
      expect(h.tokenRepo.findById(info.id)?.name).toBe('Claude Code');
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

  /** Adds a token through the channel and returns the plaintext the dialog showed. */
  async function addTokenAndCopy(name = 'Claude Code'): Promise<string> {
    await ok<AgentTokenInfo>(IPC_CHANNELS.agentAccessAddToken, { name });
    return tokenIn(h.boxes.at(-1)!.detail);
  }

  describe('tokens', () => {
    it('creates the row before the dialog opens, and ends with Done', async () => {
      let rowsWhileOpen = -1;
      h.onBox = () => {
        rowsWhileOpen = h.tokenRepo.list().length;
      };

      const info = await ok<AgentTokenInfo>(IPC_CHANNELS.agentAccessAddToken, { name: 'Claude Code' });

      expect(rowsWhileOpen).toBe(1);
      expect(info).toEqual({ id: expect.any(String), name: 'Claude Code', createdAt: expect.any(String) });
      expect(h.boxes).toHaveLength(1);
      expect(h.boxes[0]!.buttons).toEqual(['Done', 'Copy Claude Code command', 'Copy for Claude Code (JSON)', 'Copy for Claude Desktop', 'Copy for Cursor']);
      expect([h.boxes[0]!.defaultId, h.boxes[0]!.cancelId]).toEqual([0, 0]);
      expect(h.clipboard).toEqual([]);
    });

    it('shows a well-formed token once, and stores only its hash', async () => {
      await ok(IPC_CHANNELS.agentAccessAddToken, { name: 'Claude Code' });
      const token = tokenIn(h.boxes[0]!.detail);

      expect(token).toMatch(TOKEN_RE);
      expect(token).toHaveLength(43);
      const row = h.tokenRepo.list()[0]!;
      expect(row.token_hash).toBe(hashToken(token));
      expect(JSON.stringify(row)).not.toContain(token);
    });

    it('copies the configuration for each client and shows the box again until Done', async () => {
      h.answers.push(COPY_CLAUDE_CODE, COPY_CURSOR, COPY_CLAUDE_DESKTOP, 0);

      await ok(IPC_CHANNELS.agentAccessAddToken, { name: 'Claude Code' });

      expect(h.boxes).toHaveLength(4);
      const token = tokenIn(h.boxes[0]!.detail);
      expect(h.boxes.map((b) => tokenIn(b.detail))).toEqual([token, token, token, token]);
      expect(h.boxes[0]!.detail).not.toContain('Configuration copied');
      expect(h.boxes[1]!.detail).toContain('Configuration copied for Claude Code (JSON).');
      expect(h.boxes[2]!.detail).toContain('Configuration copied for Cursor.');
      expect(h.boxes[3]!.detail).toContain('Configuration copied for Claude Desktop.');

      expect(h.clipboard).toHaveLength(3);
      const [code, cursor, desktop] = h.clipboard.map((c) => JSON.parse(c).mcpServers.latelier);
      expect(code).toEqual({ type: 'stdio', command: h.bridge.installedPath, args: [], env: { LATELIER_AGENT_TOKEN: token } });
      expect(cursor).toEqual({ command: h.bridge.installedPath, args: [], env: { LATELIER_AGENT_TOKEN: token } });
      expect(desktop).toEqual(cursor);
    });

    it('says so in the box, still open to the token, when the clipboard write fails', async () => {
      h.clipboardFails = true;
      h.answers.push(COPY_CURSOR, 0);

      const info = await ok<AgentTokenInfo>(IPC_CHANNELS.agentAccessAddToken, { name: 'Claude Code' });

      expect(info.name).toBe('Claude Code');
      expect(h.boxes).toHaveLength(2);
      expect(h.boxes[1]!.detail).toContain('Could not copy it (Copy for Cursor). Copy the token by hand, or regenerate it.');
      expect(tokenIn(h.boxes[1]!.detail)).toBe(tokenIn(h.boxes[0]!.detail));
      expect(h.boxes[1]!.detail).not.toContain('Configuration copied');
      expect(vi.mocked(h.log.warn)).toHaveBeenCalledWith('agent', 'could not copy the Agent configuration', { errName: 'Error' });
    });

    it('copies the claude mcp add command, names it in the note, and tells Claude Code users how in the box', async () => {
      h.answers.push(COPY_CLAUDE_CODE_COMMAND, 0);

      await ok(IPC_CHANNELS.agentAccessAddToken, { name: 'Claude Code' });

      const token = tokenIn(h.boxes[0]!.detail);
      expect(h.boxes[0]!.detail).toContain('Claude Code: copy the command, paste it into a terminal and run it.');
      expect(h.clipboard).toEqual([
        // The harness path is plain characters, so it stays a bare word; quoting is unit-tested against a real shell.
        `claude mcp add latelier --scope user -e LATELIER_AGENT_TOKEN=${token} -- ${h.bridge.installedPath}`,
      ]);
      expect(h.boxes[1]!.detail).toContain('Claude Code command copied. Paste it into a terminal and run it, then check with: claude mcp list');
      expect(tokenIn(h.boxes[1]!.detail)).toBe(token);
    });

    it('states the Claude Code command with a placeholder, never a token', async () => {
      h.answers.push(0);
      await ok(IPC_CHANNELS.agentAccessAddToken, { name: 'Claude Code' });
      const token = tokenIn(h.boxes[0]!.detail);
      const state = await ok<AgentAccessState>(IPC_CHANNELS.agentAccessGetState, {});
      expect(state.claudeCodeCommand).toContain('LATELIER_AGENT_TOKEN=YOUR_TOKEN');
      expect(state.claudeCodeCommand).toContain(h.bridge.installedPath);
      expect(JSON.stringify(state)).not.toContain(token);
    });

    it('ends the loop when the box is dismissed with Escape', async () => {
      h.answers.push(0);
      await ok(IPC_CHANNELS.agentAccessAddToken, { name: 'Claude Code' });
      expect(h.boxes).toHaveLength(1);
    });

    it('ends the loop on a button it does not know, rather than spinning', async () => {
      h.answers.push(9);
      await ok(IPC_CHANNELS.agentAccessAddToken, { name: 'Claude Code' });
      expect(h.boxes).toHaveLength(1);
      expect(h.clipboard).toEqual([]);
    });

    it('lets the token it showed connect, and nothing else', async () => {
      const socketPath = await turnOn();
      const token = await addTokenAndCopy();

      const agent = await connectAgent(socketPath, token);
      sessions.push(() => agent.close().catch(() => undefined));
      expect(textOf(await agent.client.callTool({ name: 'list_connections', arguments: {} }))).toContain('untrusted-data');
    });

    it('never lets the token reach an envelope, a pushed state, a log line or the state', async () => {
      await turnOn();
      h.answers.push(COPY_CLAUDE_CODE, 0);
      const envelopes: unknown[] = [];
      const addEnv = await invoke<AgentTokenInfo>(IPC_CHANNELS.agentAccessAddToken, { name: 'Claude Code' });
      envelopes.push(addEnv);
      const token = tokenIn(h.boxes.at(-1)!.detail);
      // Not vacuous: the token really is in the dialog, on the clipboard and valid.
      expect(token).toMatch(TOKEN_RE);
      expect(h.clipboard[0]).toContain(token);

      const id = (addEnv as { ok: true; data: AgentTokenInfo }).data.id;
      h.answers.push(0);
      const regenEnv = await invoke(IPC_CHANNELS.agentAccessRegenerateToken, { id });
      const regenerated = tokenIn(h.boxes.at(-1)!.detail);
      expect(regenerated).toMatch(TOKEN_RE);
      expect(regenerated).not.toBe(token);
      envelopes.push(regenEnv);
      envelopes.push(await invoke(IPC_CHANNELS.agentAccessGetState, {}));
      envelopes.push(await invoke(IPC_CHANNELS.agentAccessRevokeToken, { id }));
      envelopes.push(await invoke(IPC_CHANNELS.agentAccessRevokeToken, { id }));
      envelopes.push(await invoke(IPC_CHANNELS.agentAccessRegenerateToken, { id }));
      await ok(IPC_CHANNELS.agentAccessDisable, {});

      const everything = JSON.stringify([envelopes, h.states, vi.mocked(h.log.info).mock.calls, vi.mocked(h.log.warn).mock.calls, vi.mocked(h.log.error).mock.calls, vi.mocked(h.log.debug).mock.calls]);
      for (const secret of [token, regenerated, hashToken(token), hashToken(regenerated)]) {
        expect(everything).not.toContain(secret);
      }
      expect(h.states.length).toBeGreaterThan(0);
    });

    it('regenerates: the dialog says so, the old token stops and the new one connects', async () => {
      const socketPath = await turnOn();
      const oldToken = await addTokenAndCopy();
      const id = h.tokenRepo.list()[0]!.id;

      const info = await ok<AgentTokenInfo>(IPC_CHANNELS.agentAccessRegenerateToken, { id });

      expect(info).toMatchObject({ id, name: 'Claude Code' });
      const box = h.boxes.at(-1)!;
      expect(box.title).toBe('Token regenerated');
      expect(box.detail).toContain('The previous token for this Agent no longer works.');
      const newToken = tokenIn(box.detail);
      expect(newToken).not.toBe(oldToken);
      const refused = await openSocket(socketPath);
      refused.write(handshakeLine(oldToken));
      expect(await readUntilClosed(refused)).toContain('Agent token refused');
      const agent = await connectAgent(socketPath, newToken);
      sessions.push(() => agent.close().catch(() => undefined));
    });

    it('answers NOT_FOUND for a token that does not exist, without showing a dialog', async () => {
      for (const channel of [IPC_CHANNELS.agentAccessRegenerateToken, IPC_CHANNELS.agentAccessRevokeToken]) {
        const env = await invoke(channel, { id: randomUUID() });
        expect(env.ok).toBe(false);
        if (!env.ok) expect(env.error.code).toBe('NOT_FOUND');
      }
      expect(h.boxes).toHaveLength(0);
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
      await h.svc.addTokenWithDialog('Late');
      expect(h.states).toHaveLength(after);
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
