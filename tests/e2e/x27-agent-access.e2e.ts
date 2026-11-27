import { spawn } from 'node:child_process';
import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import { once } from 'node:events';
import { test, expect, type Page } from '@playwright/test';
import { MongoClient } from 'mongodb';
import { Client } from '@modelcontextprotocol/client';
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio';
import { displayFolder } from '../../electron/agent/folderDisplay';
import { assertBridgeBuiltOnCi, bridgeBinaryPresent } from '../helpers/bridgeBinary';
import { isCi } from '../helpers/ci';
import { baseConnInput, startMemoryServer, stopAllMemoryServers, withApp } from '../helpers/e2eApp';

test.afterAll(stopAllMemoryServers);

/**
 * X27, end to end: the path an Agent client takes. Main's own dialogs are
 * native, so Playwright cannot click them; they are stubbed in main and the
 * clipboard is captured there rather than read, so a run never touches the
 * developer's real clipboard. Everything else is real: the app, the bridge
 * copy it installs, the socket, and an MCP client over the bridge's stdio.
 *
 * Needs the built bridge (`scripts/build-bridge.mjs`, which `npm run build`
 * runs). A developer machine without a Rust toolchain skips; CI fails.
 */
test.skip(!bridgeBinaryPresent() && !isCi(), 'the Agent Bridge is not built (no Rust toolchain: scripts/build-bridge.mjs only warned)');

const NOT_RUNNING = "L'Atelier is not running or Agent Access is off\n";
const TOKEN_REFUSED = "L'Atelier refused this Agent token\n";
const DB = 'x27_e2e';
const CONNECTION_NAME = 'X27 Target';

interface Captured {
  boxes: Array<{ title: string; buttons: string[]; detail: string }>;
  clipboard: string[];
  /** What the stubbed clipboard holds now. */
  current: string;
}

interface AgentState {
  enabled: boolean;
  socketPath: string;
  bridgeInstalled: boolean;
  bridgePath: string;
  connectionRequests: Array<{ connectionId: string; lastOutcome: string; lastTool: string }>;
}

interface Snippet {
  mcpServers: { latelier: { type?: string; command: string; args: string[]; env: Record<string, string> } };
}

/** Runs the bridge to its exit with stdin closed. HOME is a throwaway so the real profile can never be read. */
async function runToExit(command: string, env: Record<string, string>, home: string) {
  const child = spawn(command, [], {
    env: { PATH: process.env.PATH ?? '', HOME: home, USERPROFILE: home, APPDATA: home, ...env },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let stdout = '';
  let stderr = '';
  child.stdout.on('data', (c: Buffer) => (stdout += c.toString('utf8')));
  child.stderr.on('data', (c: Buffer) => (stderr += c.toString('utf8')));
  const [code] = (await once(child, 'close')) as [number | null];
  return { code, stdout, stderr };
}

const state = (win: Page): Promise<AgentState> =>
  win.evaluate(() => (window as unknown as { atelier: { agentAccess: { getState: () => Promise<AgentState> } } }).atelier.agentAccess.getState());

const setShared = (win: Page, connectionId: string, shared: boolean): Promise<{ shared: boolean }> =>
  win.evaluate(
    ({ connectionId, shared }) =>
      (window as unknown as { atelier: { agentAccess: { setShared: (i: unknown) => Promise<{ shared: boolean }> } } }).atelier.agentAccess.setShared({
        connectionId,
        shared,
      }),
    { connectionId, shared },
  );

test('an Agent reads a shared Connection through the bridge, and every gate holds', async () => {
  test.setTimeout(120_000);
  assertBridgeBuiltOnCi();
  const mongo = await startMemoryServer();
  const seed = new MongoClient(mongo.server.getUri());
  await seed.connect();
  try {
    await seed.db(DB).collection('items').insertMany([
      { _id: 1, label: 'x27-marker-alpha', n: 1 },
      { _id: 2, label: 'x27-marker-beta', n: 2 },
    ] as never);
  } finally {
    await seed.close();
  }

  await withApp(async (app, userDataDir) => {
    const win = await app.firstWindow();
    await win.waitForLoadState('domcontentloaded');
    const captured = () => app.evaluate(() => (globalThis as unknown as { __x27: Captured }).__x27);

    // Answers main's native dialogs by title and button label, and records every box and clipboard write.
    // Reading and clearing are stubbed too, so the clear at quit never touches the developer's clipboard.
    await app.evaluate(({ dialog, clipboard }) => {
      const g = globalThis as unknown as { __x27: Captured };
      g.__x27 = { boxes: [], clipboard: [], current: '' };
      dialog.showMessageBox = (async (...args: unknown[]) => {
        const box = args[args.length - 1] as { title: string; buttons: string[]; detail: string };
        g.__x27.boxes.push({ title: box.title, buttons: box.buttons, detail: box.detail });
        const pick = (label: string) => box.buttons.indexOf(label);
        let response = 0;
        if (box.title === 'Turn on Agent Access?') response = pick('Turn on');
        else if (box.title === 'Share with Agents?') response = pick('Share');
        else if (box.title === 'Copy setup') response = pick('Copy setup');
        return { response, checkboxChecked: false };
      }) as typeof dialog.showMessageBox;
      clipboard.writeText = (async (text: string) => {
        g.__x27.clipboard.push(text);
        g.__x27.current = text;
      }) as typeof clipboard.writeText;
      clipboard.readText = (async () => g.__x27.current) as typeof clipboard.readText;
      clipboard.clear = (() => {
        g.__x27.current = '';
      }) as typeof clipboard.clear;
    });

    // The Connection exists and is open, but is not shared.
    const connectionId = await win.evaluate(
      async ({ input }) => {
        const api = (window as unknown as { atelier: { conn: { create: (i: unknown) => Promise<{ id: string }> }; mongo: { connect: (id: string) => Promise<unknown> } } }).atelier;
        const created = await api.conn.create(input);
        await api.mongo.connect(created.id);
        return created.id;
      },
      { input: { ...baseConnInput(mongo.host, mongo.port), name: CONNECTION_NAME } },
    );

    // Turn on: main's dialog, then the server and the bridge copy.
    const enabled = await win.evaluate(() =>
      (window as unknown as { atelier: { agentAccess: { requestEnable: () => Promise<{ enabled: boolean }> } } }).atelier.agentAccess.requestEnable(),
    );
    expect(enabled.enabled).toBe(true);
    const on = await state(win);
    expect(on.enabled).toBe(true);
    expect(on.bridgeInstalled).toBe(true);
    expect(fs.existsSync(on.bridgePath)).toBe(true);
    expect(on.socketPath).not.toBe('');

    // An Agent: main confirms, then puts the Claude Code (JSON) setup, holding its new token, on the clipboard.
    const copied = await win.evaluate(() =>
      (window as unknown as { atelier: { agentAccess: { connectClient: (i: unknown) => Promise<{ tokenId?: string; cancelled?: true }> } } }).atelier.agentAccess.connectClient({
        name: 'E2E Agent',
        client: 'claude-code',
      }),
    );
    expect(copied.tokenId).toEqual(expect.any(String));
    const afterToken = await captured();
    expect(afterToken.clipboard).toHaveLength(1);
    const server = (JSON.parse(afterToken.clipboard[0]!) as Snippet).mcpServers.latelier;
    const token = server.env.LATELIER_AGENT_TOKEN!;
    expect(token).toMatch(/^[A-Za-z0-9_-]{20,}$/);
    expect(server.type).toBe('stdio');
    expect(server.args).toEqual([]);
    // The installed copy is what a client runs, so it is what runs here.
    expect(server.command).toBe(on.bridgePath);
    // The renderer never learns the token.
    expect(JSON.stringify(await state(win))).not.toContain(token);

    // Share it: the privilege check, then main's dialog.
    expect((await setShared(win, connectionId, true)).shared).toBe(true);
    expect((await captured()).boxes.map((b) => b.title)).toEqual(['Turn on Agent Access?', 'Copy setup', 'Share with Agents?']);

    const bridgeEnv = { LATELIER_AGENT_TOKEN: token, LATELIER_AGENT_SOCKET: on.socketPath };
    const transport = new StdioClientTransport({
      command: server.command,
      args: server.args,
      env: { ...bridgeEnv, HOME: userDataDir, USERPROFILE: userDataDir, APPDATA: userDataDir },
      stderr: 'pipe',
    });
    const client = new Client({ name: 'x27-e2e', version: '1.0' });
    await client.connect(transport);
    const textOf = (r: { content?: unknown }) => (r.content as Array<{ text?: string }>)[0]?.text ?? '';
    try {
      // list_connections names the shared Connection and its readable database, and no host.
      const listed = textOf(await client.callTool({ name: 'list_connections', arguments: {} }));
      expect(listed).toContain(CONNECTION_NAME);
      expect(listed).toContain('available');
      expect(listed).toContain(DB);
      expect(listed).not.toContain(String(mongo.port));

      // find returns the documents, and only inside the untrusted-data envelope.
      const found = await client.callTool({
        name: 'find',
        arguments: { connectionId, database: DB, collection: 'items', filter: { n: { $lte: 2 } }, sort: { n: 1 } },
      });
      expect(found.isError).toBeUndefined();
      expect(textOf(found)).toMatch(/<untrusted-data-[0-9a-f]{32}>/);
      expect(textOf(found)).toContain('x27-marker-alpha');
      expect(textOf(found)).toContain('x27-marker-beta');
      expect(Object.keys(found)).not.toContain('structuredContent');

      // X27 §16.6: the Connection closes, so a 2025-era client is refused, and the app shows a request.
      const mongoApi = (op: 'connect' | 'disconnect') =>
        win.evaluate(
          ({ id, op }) => (window as unknown as { atelier: { mongo: Record<string, (id: string) => Promise<unknown>> } }).atelier.mongo[op]!(id),
          { id: connectionId, op },
        );
      await mongoApi('disconnect');
      const notOpen = await client.callTool({ name: 'find', arguments: { connectionId, database: DB, collection: 'items' } });
      expect(notOpen.isError).toBe(true);
      expect(textOf(notOpen)).toBe("NOT_OPEN: This Connection is not open. L'Atelier has asked the user to open it; try again after they do.");
      expect((await state(win)).connectionRequests).toEqual([expect.objectContaining({ connectionId, lastOutcome: 'refused', lastTool: 'find' })]);
      // Opening it, as the user would from the request, ends the request, and the Agent's retry reads.
      await mongoApi('connect');
      await expect.poll(async () => (await state(win)).connectionRequests).toEqual([]);
      const retried = await client.callTool({ name: 'find', arguments: { connectionId, database: DB, collection: 'items', sort: { n: 1 } } });
      expect(retried.isError).toBeUndefined();
      expect(textOf(retried)).toContain('x27-marker-alpha');

      // X28: the Agent proposes a Reference Rule through the bridge; the app lists it, the user accepts it, and the Agent sees the decision.
      const proposed = await client.callTool({
        name: 'propose_reference_rule',
        arguments: {
          connectionId,
          sourceDb: DB,
          sourceCollection: 'orders',
          sourceField: 'customerId',
          targetDb: DB,
          targetCollection: 'customers',
          reason: 'orders.customerId holds customers._id values',
        },
      });
      expect(proposed.isError).toBeUndefined();
      const proposalId = (JSON.parse(textOf(proposed).split('\n')[1]!) as { proposalId: string }).proposalId;
      type ProposalsApi = {
        list: (q: unknown) => Promise<Array<{ id: string; status: string; sourceField: string; backers: Array<{ reason: string | null }> }>>;
        accept: (q: unknown) => Promise<{ ruleId: string; savedFor: string }>;
      };
      const proposals = await win.evaluate(() =>
        (window as unknown as { atelier: { agentProposals: ProposalsApi } }).atelier.agentProposals.list({ status: 'open', limit: 10 }),
      );
      expect(proposals).toEqual([
        expect.objectContaining({ id: proposalId, status: 'pending', sourceField: 'customerId', backers: [expect.objectContaining({ reason: 'orders.customerId holds customers._id values' })] }),
      ]);
      const accepted = await win.evaluate(
        (id) => (window as unknown as { atelier: { agentProposals: ProposalsApi } }).atelier.agentProposals.accept({ id, savedFor: 'connection' }),
        proposalId,
      );
      expect(accepted.savedFor).toBe('connection');
      const rules = await win.evaluate(
        (id) => (window as unknown as { atelier: { refs: { list: (q: unknown) => Promise<Array<{ id: string; sourceField: string; targetCollection: string }>> } } }).atelier.refs.list({ connectionId: id }),
        connectionId,
      );
      expect(rules).toEqual([expect.objectContaining({ id: accepted.ruleId, sourceField: 'customerId', targetCollection: 'customers' })]);
      const decided = await client.callTool({ name: 'get_proposal', arguments: { proposalId } });
      expect(textOf(decided).split('\n')[0]).toBe(JSON.stringify({ proposalId, status: 'accepted', savedFor: 'connection' }));

      // Unshare in the app: the very next call is refused.
      expect((await setShared(win, connectionId, false)).shared).toBe(false);
      const refused = await client.callTool({ name: 'find', arguments: { connectionId, database: DB, collection: 'items' } });
      expect(refused.isError).toBe(true);
      expect(textOf(refused)).toContain('NOT_SHARED');
      expect(textOf(refused)).not.toContain('x27-marker');
    } finally {
      await client.close();
    }

    // X27 §16.3: a bridge started in a known folder records it, and the renderer reads the session and its calls back.
    const projectDir = path.join(userDataDir, 'agent-project');
    fs.mkdirSync(projectDir);
    const inFolder = new Client({ name: 'x27-folder', version: '1.0' });
    await inFolder.connect(
      new StdioClientTransport({
        command: server.command,
        args: server.args,
        env: { ...bridgeEnv, HOME: userDataDir, USERPROFILE: userDataDir, APPDATA: userDataDir },
        cwd: projectDir,
        stderr: 'pipe',
      }),
    );
    try {
      await inFolder.callTool({ name: 'list_connections', arguments: {} });
      // Main shows home as ~, with its own home directory; the OS may report the folder resolved.
      const mainHome = await app.evaluate(() => (process.platform === 'win32' ? process.env.USERPROFILE : process.env.HOME) ?? '');
      const shown = [projectDir, fs.realpathSync.native(projectDir)].map((d) => displayFolder(d, mainHome, process.platform));
      type SessionRow = { id: string; folder: string | null; clientName: string | null; endedAt: string | null };
      const sessions = await win.evaluate(() =>
        (window as unknown as { atelier: { agentAccess: { listSessions: (q: unknown) => Promise<SessionRow[]> } } }).atelier.agentAccess.listSessions({
          includeEnded: false,
          limit: 10,
        }),
      );
      const mine = sessions.find((s) => s.clientName === 'x27-folder');
      expect(mine).toBeDefined();
      expect(shown).toContain(mine!.folder);
      expect(mine!.endedAt).toBeNull();
      const calls = await win.evaluate(
        (sessionId) =>
          (window as unknown as { atelier: { agentAccess: { listCalls: (q: unknown) => Promise<Array<{ tool: string; sessionId: string }>> } } }).atelier.agentAccess.listCalls({
            sessionId,
            outcome: 'all',
            limit: 10,
          }),
        mine!.id,
      );
      expect(calls.map((c) => [c.tool, c.sessionId])).toEqual([['list_connections', mine!.id]]);
    } finally {
      await inFolder.close();
    }

    // X29: a 2026-07-28 client on a shared Connection that is closed is asked to open it, and gets the documents
    // once the user opens it in the app between the two rounds.
    expect((await setShared(win, connectionId, true)).shared).toBe(true);
    await win.evaluate((id) => (window as unknown as { atelier: { mongo: { disconnect: (id: string) => Promise<unknown> } } }).atelier.mongo.disconnect(id), connectionId);
    const modern = new Client(
      { name: 'x29-e2e', version: '1.0' },
      { capabilities: { elicitation: { form: {} } }, versionNegotiation: { mode: { pin: '2026-07-28' } } },
    );
    const asked: string[] = [];
    modern.setRequestHandler('elicitation/create', async (request) => {
      asked.push((request.params as { message: string }).message);
      await win.evaluate((id) => (window as unknown as { atelier: { mongo: { connect: (id: string) => Promise<unknown> } } }).atelier.mongo.connect(id), connectionId);
      return { action: 'accept' };
    });
    await modern.connect(
      new StdioClientTransport({
        command: server.command,
        args: server.args,
        env: { ...bridgeEnv, HOME: userDataDir, USERPROFILE: userDataDir, APPDATA: userDataDir },
        stderr: 'pipe',
      }),
    );
    try {
      expect(modern.getNegotiatedProtocolVersion()).toBe('2026-07-28');
      const paused = await modern.callTool({ name: 'find', arguments: { connectionId, database: DB, collection: 'items', sort: { n: 1 } } });
      expect(paused.isError).toBeUndefined();
      expect(textOf(paused)).toContain('x27-marker-alpha');
      expect(asked).toEqual([`The Connection "${CONNECTION_NAME}" is closed. Open it in L'Atelier, then accept to continue.`]);
    } finally {
      await modern.close();
    }

    // A bridge speaking another protocol is refused with a JSON-RPC error line, and the socket closes.
    // The bridge always sends 2, so this speaks the socket directly.
    const raw = net.connect(on.socketPath);
    await once(raw, 'connect');
    let received = '';
    raw.on('data', (c: Buffer) => (received += c.toString('utf8')));
    raw.write(`${JSON.stringify({ agentToken: token, protocol: 3 })}\n`);
    await once(raw, 'close');
    expect((JSON.parse(received.trim()) as { error: { code: number } }).error.code).toBe(-32002);
    expect(received).not.toContain(token);

    // A token the app does not know: it refuses, and the bridge says so on stderr and exits 4.
    const refused = await runToExit(server.command, { ...bridgeEnv, LATELIER_AGENT_TOKEN: 'not-a-real-token' }, userDataDir);
    expect(refused.code).toBe(4);
    expect(refused.stderr).toBe(TOKEN_REFUSED);

    // No token: exit 2.
    const noToken = await runToExit(server.command, { LATELIER_AGENT_SOCKET: on.socketPath }, userDataDir);
    expect(noToken.code).toBe(2);
    expect(noToken.stdout).toBe('');

    // Access off: the socket is gone, so the bridge exits 3 with the one line.
    const off = await win.evaluate(() =>
      (window as unknown as { atelier: { agentAccess: { disable: () => Promise<{ enabled: boolean }> } } }).atelier.agentAccess.disable(),
    );
    expect(off.enabled).toBe(false);
    const closed = await runToExit(server.command, bridgeEnv, userDataDir);
    expect(closed.code).toBe(3);
    expect(closed.stderr).toBe(NOT_RUNNING);
    expect(closed.stdout).toBe('');
    expect(fs.existsSync(path.join(userDataDir, 'agent', 'endpoint'))).toBe(false);
  });
});
