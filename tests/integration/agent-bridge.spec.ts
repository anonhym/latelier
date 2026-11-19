import { afterEach, describe, expect, it } from 'vitest';
import { spawn, type ChildProcess } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Client } from '@modelcontextprotocol/client';
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio';
import { createAgentHarness, type AgentHarness } from '../helpers/agentHarness';
import { assertBridgeBuiltOnCi, bridgeBinaryPath, bridgeBinaryPresent } from '../helpers/bridgeBinary';
import { textOf } from '../helpers/agentSocket';

/**
 * The built bridge against the real `AgentServer`: the handshake bytes, the
 * endpoint file as the server writes it, and what happens when the app closes
 * the session. It needs `scripts/build-bridge.mjs` to have run; a developer
 * machine without Rust skips, CI fails (the first test).
 */

const NOT_RUNNING = "L'Atelier is not running or Agent Access is off\n";
const TOKEN_REFUSED = "L'Atelier refused this Agent token\n";
const present = bridgeBinaryPresent();
const posix = process.platform !== 'win32';

interface Exited {
  code: number | null;
  stdout: string;
  stderr: string;
}

/** Runs the bridge with a stdin that stays open, and resolves when it exits. */
function runBridge(env: Record<string, string>): { child: ChildProcess; exited: Promise<Exited> } {
  const child = spawn(bridgeBinaryPath(), [], {
    env: { PATH: process.env.PATH ?? '', ...env },
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  let stdout = '';
  let stderr = '';
  child.stdout?.on('data', (c: Buffer) => (stdout += c.toString('utf8')));
  child.stderr?.on('data', (c: Buffer) => (stderr += c.toString('utf8')));
  const exited = new Promise<Exited>((resolve, reject) => {
    child.once('error', reject);
    child.once('close', (code) => resolve({ code, stdout, stderr }));
  });
  return { child, exited };
}

/** Fails a test that waits for an exit that never comes, instead of hanging it. */
function within<T>(promise: Promise<T>, ms: number, what: string): Promise<T> {
  let timer: NodeJS.Timeout;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`timed out after ${ms}ms: ${what}`)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

describe('the Agent Bridge binary is built', () => {
  it('is present on CI', () => {
    assertBridgeBuiltOnCi();
    expect(true).toBe(true);
  });
});

describe.skipIf(!present)('Agent Bridge against the Agent server', () => {
  let h: AgentHarness;
  const children: ChildProcess[] = [];
  const temps: string[] = [];

  afterEach(async () => {
    for (const c of children.splice(0)) c.kill();
    for (const t of temps.splice(0)) fs.rmSync(t, { recursive: true, force: true });
    await h?.cleanup();
  });

  async function start(shared = true) {
    h = createAgentHarness();
    const { token, info } = h.svc.addToken('Claude Code');
    if (shared) h.addConnection('conn-1', 'prod', { shared: true, status: 'connected' });
    const socketPath = await h.enable();
    return { token, tokenId: info.id, socketPath };
  }

  async function mcpClient(token: string, socketPath: string): Promise<{ client: Client; transport: StdioClientTransport }> {
    const transport = new StdioClientTransport({
      command: bridgeBinaryPath(),
      env: { LATELIER_AGENT_TOKEN: token, LATELIER_AGENT_SOCKET: socketPath },
      stderr: 'pipe',
    });
    const client = new Client({ name: 'bridge-spec', version: '1.0' });
    await client.connect(transport);
    return { client, transport };
  }

  it('carries a real MCP session: initialize, list_connections, and a clean close', async () => {
    const { token, socketPath } = await start();
    const { client } = await mcpClient(token, socketPath);
    const result = await client.callTool({ name: 'list_connections', arguments: {} });
    expect(textOf(result)).toContain('prod');
    expect(h.svc.sessionCount).toBe(1);
    await client.close();
  });

  it('records the Agent token name and client name from the stdio session', async () => {
    const { token, socketPath } = await start();
    const { client } = await mcpClient(token, socketPath);
    await client.callTool({ name: 'list_connections', arguments: {} });
    const rows = h.tmp.db.prepare('select tool, token_name from agent_read_log').all() as Array<{ tool: string; token_name: string }>;
    expect(rows).toEqual([{ tool: 'list_connections', token_name: 'Claude Code' }]);
    await client.close();
  });

  it('forwards the app\'s refusal of an unknown token, then exits 4 with one line on stderr', async () => {
    const { socketPath } = await start();
    const { child, exited } = runBridge({ LATELIER_AGENT_TOKEN: 'not-a-real-token', LATELIER_AGENT_SOCKET: socketPath });
    children.push(child);
    const result = await within(exited, 10_000, 'the bridge to exit after a refusal');
    expect(result.code).toBe(4);
    expect(result.stderr).toBe(TOKEN_REFUSED);
    const line = JSON.parse(result.stdout.trim()) as { error: { code: number; message: string } };
    expect(line.error.code).toBe(-32001);
    expect(result.stdout).not.toContain('not-a-real-token');
    expect(result.stderr).not.toContain('not-a-real-token');
  });

  it('exits when the token is revoked mid-session, because the app closes the socket', async () => {
    const { token, tokenId, socketPath } = await start();
    const { child, exited } = runBridge({ LATELIER_AGENT_TOKEN: token, LATELIER_AGENT_SOCKET: socketPath });
    children.push(child);
    // The session is open once the server counts it.
    for (let i = 0; i < 200 && h.svc.sessionCount === 0; i++) await new Promise((r) => setTimeout(r, 25));
    expect(h.svc.sessionCount).toBe(1);
    h.svc.revokeToken(tokenId);
    const result = await within(exited, 10_000, 'the bridge to exit after the token was revoked');
    expect(result.code).toBe(0);
  });

  it('exits 3 with the exact line once Agent Access is off', async () => {
    const { token, socketPath } = await start();
    await h.disable();
    const { child, exited } = runBridge({ LATELIER_AGENT_TOKEN: token, LATELIER_AGENT_SOCKET: socketPath });
    children.push(child);
    const result = await within(exited, 10_000, 'the bridge to exit with Agent Access off');
    expect(result.code).toBe(3);
    expect(result.stderr).toBe(NOT_RUNNING);
    expect(result.stdout).toBe('');
  });

  it('exits 2 for a token outside the alphabet and never connects', async () => {
    const { socketPath } = await start();
    const { child, exited } = runBridge({ LATELIER_AGENT_TOKEN: 'bad token', LATELIER_AGENT_SOCKET: socketPath });
    children.push(child);
    const result = await within(exited, 10_000, 'the bridge to exit on a malformed token');
    expect(result.code).toBe(2);
    expect(result.stderr).not.toContain('bad token');
    expect(h.svc.sessionCount).toBe(0);
  });

  // The default endpoint is `<default userData>/agent/endpoint`, written by the
  // server. A throwaway HOME whose `userData` is a link to the harness profile
  // makes the bridge find that file the way an installed one does.
  it.runIf(posix)('finds the endpoint file the server writes, from the default user data location', async () => {
    const { token } = await start();
    const home = fs.mkdtempSync(path.join(os.tmpdir(), 'lb-home-'));
    temps.push(home);
    const userData =
      process.platform === 'darwin'
        ? path.join(home, 'Library', 'Application Support', "L'Atelier")
        : path.join(home, '.config', "L'Atelier");
    fs.mkdirSync(path.dirname(userData), { recursive: true });
    fs.symlinkSync(h.tmp.dir, userData);
    const transport = new StdioClientTransport({
      command: bridgeBinaryPath(),
      env: { LATELIER_AGENT_TOKEN: token, HOME: home },
      stderr: 'pipe',
    });
    const client = new Client({ name: 'bridge-spec', version: '1.0' });
    await client.connect(transport);
    expect(textOf(await client.callTool({ name: 'list_connections', arguments: {} }))).toContain('connections');
    await client.close();
  });
});
