import { test, expect } from '@playwright/test';
import { Client } from '@modelcontextprotocol/client';
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio';
import { assertBridgeBuiltOnCi, bridgeBinaryPresent } from '../helpers/bridgeBinary';
import { isCi } from '../helpers/ci';
import { baseConnInput, startMemoryServer, stopAllMemoryServers, withApp } from '../helpers/e2eApp';

test.afterAll(stopAllMemoryServers);

/**
 * X30, end to end, through the UI: Agents mode from the sidebar switch, Home's
 * checklist, the Shared switch, the Connect an Agent panel, then a real bridge
 * started with the setup the panel copied. Main's native dialogs cannot be
 * clicked, so they are answered in main, and the clipboard is captured there
 * so a run never touches the developer's own.
 *
 * Needs the built bridge (`scripts/build-bridge.mjs`). A developer machine
 * without a Rust toolchain skips; CI fails.
 */
test.skip(!bridgeBinaryPresent() && !isCi(), 'the Agent Bridge is not built (no Rust toolchain: scripts/build-bridge.mjs only warned)');

const CONNECTION_NAME = 'X30 Target';
const AGENT_NAME = 'E2E laptop';

interface Captured {
  boxes: string[];
  clipboard: string[];
  current: string;
}

interface Snippet {
  mcpServers: { latelier: { command: string; args: string[]; env: Record<string, string> } };
}

test('Agents mode: turn on, share from Home, connect through the panel, and see the session', async () => {
  test.setTimeout(120_000);
  assertBridgeBuiltOnCi();
  const mongo = await startMemoryServer();

  await withApp(async (app, userDataDir) => {
    const win = await app.firstWindow();
    await win.waitForLoadState('domcontentloaded');
    const captured = () => app.evaluate(() => (globalThis as unknown as { __x30: Captured }).__x30);

    await app.evaluate(({ dialog, clipboard }) => {
      const g = globalThis as unknown as { __x30: Captured };
      g.__x30 = { boxes: [], clipboard: [], current: '' };
      dialog.showMessageBox = (async (...args: unknown[]) => {
        const box = args[args.length - 1] as { title: string; buttons: string[] };
        g.__x30.boxes.push(box.title);
        const pick = (label: string) => box.buttons.indexOf(label);
        let response = 0;
        if (box.title === 'Turn on Agent Access?') response = pick('Turn on');
        else if (box.title === 'Share with Agents?') response = pick('Share');
        else if (box.title === 'Copy setup') response = pick('Copy setup');
        return { response, checkboxChecked: false };
      }) as typeof dialog.showMessageBox;
      clipboard.writeText = (async (text: string) => {
        g.__x30.clipboard.push(text);
        g.__x30.current = text;
      }) as typeof clipboard.writeText;
      clipboard.readText = (async () => g.__x30.current) as typeof clipboard.readText;
      clipboard.clear = (() => {
        g.__x30.current = '';
      }) as typeof clipboard.clear;
    });

    // One open Connection, not shared. The reload lets the renderer list it.
    await win.evaluate(
      async ({ input }) => {
        const api = (window as unknown as { atelier: { conn: { create: (i: unknown) => Promise<{ id: string }> }; mongo: { connect: (id: string) => Promise<unknown> } } }).atelier;
        const created = await api.conn.create(input);
        await api.mongo.connect(created.id);
      },
      { input: { ...baseConnInput(mongo.host, mongo.port), name: CONNECTION_NAME } },
    );
    await win.reload();

    // The switch opens Agents mode on Home, in the one Agents tab.
    await win.getByRole('tablist', { name: 'Sidebar mode' }).getByRole('tab', { name: /Agents/ }).click();
    await expect(win.getByTestId('agents-tab')).toHaveAttribute('aria-label', 'Agents · Home');
    await expect(win.getByTestId('agents-status-line')).toHaveText('Agent Access is off');

    // Turn on from the checklist: main asks, then the step is done.
    await win.getByTestId('agents-setup-enable').getByRole('button', { name: 'Turn on Agent Access' }).click();
    await expect(win.getByTestId('agents-setup-enable')).toHaveAttribute('data-done', 'true');
    await expect(win.getByTestId('agents-status-line')).toHaveText('Agent Access is on · no live sessions');

    // Share from Home's Connections table.
    const row = win.getByTestId('agents-connection-row').filter({ hasText: CONNECTION_NAME });
    await row.getByRole('switch', { name: `Share ${CONNECTION_NAME} with Agents` }).click({ force: true });
    await expect(win.getByTestId('agents-setup-share')).toHaveAttribute('data-done', 'true');
    await expect(row.getByRole('switch', { name: `Share ${CONNECTION_NAME} with Agents` })).toBeChecked();
    await expect(row).toContainText('Open · reachable');

    // Connect an Agent through the panel.
    await win.getByTestId('agents-setup-connect').getByRole('button', { name: 'Connect an Agent' }).click();
    await win.getByLabel('Name', { exact: true }).fill(AGENT_NAME);
    await win.getByRole('tablist', { name: 'Client' }).getByRole('tab', { name: 'Claude Code (JSON)' }).click();
    await win.getByTestId('connect-step-1').getByRole('button').click();
    await expect(win.getByTestId('connect-copied')).toContainText('Copied to your clipboard at');
    await expect(win.getByTestId('connect-waiting')).toBeVisible();

    const afterCopy = await captured();
    expect(afterCopy.boxes).toEqual(['Turn on Agent Access?', 'Share with Agents?', 'Copy setup']);
    expect(afterCopy.clipboard).toHaveLength(1);
    const server = (JSON.parse(afterCopy.clipboard[0]!) as Snippet).mcpServers.latelier;
    const token = server.env.LATELIER_AGENT_TOKEN!;
    expect(token).toMatch(/^[A-Za-z0-9_-]{20,}$/);

    // The pasted setup, run as a client would run it. HOME is a throwaway, so
    // the socket is named rather than found through the real profile.
    const socketPath = await win.evaluate(() =>
      (window as unknown as { atelier: { agentAccess: { getState: () => Promise<{ socketPath: string }> } } }).atelier.agentAccess
        .getState()
        .then((st) => st.socketPath),
    );
    const client = new Client({ name: 'x30-e2e', version: '1.0' });
    await client.connect(
      new StdioClientTransport({
        command: server.command,
        args: server.args,
        env: { ...server.env, LATELIER_AGENT_SOCKET: socketPath, HOME: userDataDir, USERPROFILE: userDataDir, APPDATA: userDataDir },
        stderr: 'pipe',
      }),
    );
    try {
      const listed = await client.callTool({ name: 'list_connections', arguments: {} });
      expect((listed.content as Array<{ text?: string }>)[0]?.text ?? '').toContain(CONNECTION_NAME);

      // The panel turns to Connected, and the sidebar shows the Agent with its live session.
      await expect(win.getByTestId('connect-connected')).toContainText('Connected: x30-e2e 1.0');
      await expect(win.getByTestId('agents-sidebar-agent').filter({ hasText: AGENT_NAME })).toBeVisible();
      await expect(win.getByTestId('agents-sidebar-live-session')).toHaveCount(1);

      // The session's page lists the call the bridge made, in its Activity.
      await win.getByTestId('agents-sidebar-live-session').click();
      const sessionPage = win.getByTestId('agents-page-session');
      await expect(sessionPage.getByTestId('session-identity')).toContainText(AGENT_NAME);
      await expect(sessionPage.getByTestId('activity-row').filter({ hasText: 'list_connections' })).toHaveCount(1);

      // Home: every step done, so the checklist is gone, and the status line counts the session.
      await win.getByTestId('agents-sidebar-home').click();
      await expect(win.getByTestId('agents-status-line')).toHaveText('Agent Access is on · 1 live session from 1 Agent');
      await expect(win.getByTestId('agents-setup')).toHaveCount(0);

      // The token went to the clipboard only, never to the page.
      expect(await win.content()).not.toContain(token);
    } finally {
      await client.close();
    }
  });
});
