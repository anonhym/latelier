import { spawn } from 'node:child_process';
import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import { once } from 'node:events';
import { test, expect, type Page } from '@playwright/test';
import { MongoClient } from 'mongodb';
import { Client } from '@modelcontextprotocol/client';
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio';
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
}

interface AgentState {
  enabled: boolean;
  socketPath: string;
  bridgeInstalled: boolean;
  bridgePath: string;
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
    await app.evaluate(({ dialog, clipboard }) => {
      const g = globalThis as unknown as { __x27: Captured };
      g.__x27 = { boxes: [], clipboard: [] };
      dialog.showMessageBox = (async (...args: unknown[]) => {
        const box = args[args.length - 1] as { title: string; buttons: string[]; detail: string };
        g.__x27.boxes.push({ title: box.title, buttons: box.buttons, detail: box.detail });
        const pick = (label: string) => box.buttons.indexOf(label);
        let response = 0;
        if (box.title === 'Turn on Agent Access?') response = pick('Turn on');
        else if (box.title === 'Share with Agents?') response = pick('Share');
        else if (box.title === 'Agent added') {
          response = box.detail.includes('Configuration copied') ? pick('Done') : pick('Copy for Claude Code');
        }
        return { response, checkboxChecked: false };
      }) as typeof dialog.showMessageBox;
      clipboard.writeText = ((text: string) => {
        g.__x27.clipboard.push(text);
      }) as typeof clipboard.writeText;
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

    // An Agent token: main's dialog shows it once, and "Copy for Claude Code" puts the configuration on the clipboard.
    await win.evaluate(() =>
      (window as unknown as { atelier: { agentAccess: { addToken: (i: { name: string }) => Promise<unknown> } } }).atelier.agentAccess.addToken({ name: 'E2E Agent' }),
    );
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
    expect((await captured()).boxes.map((b) => b.title)).toEqual(['Turn on Agent Access?', 'Agent added', 'Agent added', 'Share with Agents?']);

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

      // Unshare in the app: the very next call is refused.
      expect((await setShared(win, connectionId, false)).shared).toBe(false);
      const refused = await client.callTool({ name: 'find', arguments: { connectionId, database: DB, collection: 'items' } });
      expect(refused.isError).toBe(true);
      expect(textOf(refused)).toContain('NOT_SHARED');
      expect(textOf(refused)).not.toContain('x27-marker');
    } finally {
      await client.close();
    }

    // A bridge speaking another protocol is refused with a JSON-RPC error line, and the socket closes.
    // The bridge always sends 1, so this speaks the socket directly.
    const raw = net.connect(on.socketPath);
    await once(raw, 'connect');
    let received = '';
    raw.on('data', (c: Buffer) => (received += c.toString('utf8')));
    raw.write(`${JSON.stringify({ agentToken: token, protocol: 2 })}\n`);
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
