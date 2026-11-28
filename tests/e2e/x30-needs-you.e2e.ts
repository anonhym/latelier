import { test, expect, type Page } from '@playwright/test';
import { MongoClient } from 'mongodb';
import { Client } from '@modelcontextprotocol/client';
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio';
import { assertBridgeBuiltOnCi, bridgeBinaryPresent } from '../helpers/bridgeBinary';
import { isCi } from '../helpers/ci';
import { baseConnInput, startMemoryServer, stopAllMemoryServers, withApp } from '../helpers/e2eApp';
import { WorkspacePage } from './pages';

test.afterAll(stopAllMemoryServers);

/**
 * X30 §8 and X28 §7, end to end, in Databases mode: an Agent's request for a
 * Connection that is not open toasts, and Open connects it; an Agent's
 * Proposals show in the strip on their collection, one is added as a
 * Reference Rule (and its reference then follows to the customer) and the other declined behind the app confirm, and the
 * Agent reads each decision back. Main's native dialogs are answered in main
 * and the clipboard captured there, as in the X27 spec.
 *
 * Needs the built bridge (`scripts/build-bridge.mjs`). A developer machine
 * without a Rust toolchain skips; CI fails.
 */
test.skip(!bridgeBinaryPresent() && !isCi(), 'the Agent Bridge is not built (no Rust toolchain: scripts/build-bridge.mjs only warned)');

const DB = 'x30_shop';
const CONNECTION_NAME = 'X30 Shop';

interface Captured {
  clipboard: string[];
  current: string;
}

interface Snippet {
  mcpServers: { latelier: { command: string; args: string[]; env: Record<string, string> } };
}

type Api = {
  conn: { create: (i: unknown) => Promise<{ id: string }> };
  mongo: { connect: (id: string) => Promise<unknown>; disconnect: (id: string) => Promise<unknown> };
  tabs: { openCollection: (i: unknown) => Promise<{ id: string }> };
  agentAccess: {
    requestEnable: () => Promise<{ enabled: boolean }>;
    connectClient: (i: unknown) => Promise<{ tokenId?: string }>;
    setShared: (i: unknown) => Promise<{ shared: boolean }>;
    getState: () => Promise<{ socketPath: string; connectionRequests: Array<{ connectionId: string }> }>;
  };
  refs: { list: (q: unknown) => Promise<Array<{ sourceField: string; targetCollection: string }>> };
};

const agentState = (win: Page) => win.evaluate(() => (window as unknown as { atelier: Api }).atelier.agentAccess.getState());

test('Needs you in Databases mode: a request toast connects, and Proposals are decided from the strip', async () => {
  test.setTimeout(150_000);
  assertBridgeBuiltOnCi();
  const mongo = await startMemoryServer();
  const seed = new MongoClient(mongo.server.getUri());
  await seed.connect();
  try {
    await seed.db(DB).collection('customers').insertMany([{ _id: 'c1' }, { _id: 'c2' }, { _id: 'c3' }] as never);
    await seed.db(DB).collection('sellers').insertMany([{ _id: 's1' }] as never);
    await seed.db(DB).collection('orders').insertMany([
      { _id: 1, customerId: 'c1', sellerId: 's1' },
      { _id: 2, customerId: 'c2', sellerId: 's1' },
      { _id: 3, customerId: 'c3', sellerId: 's1' },
    ] as never);
  } finally {
    await seed.close();
  }

  await withApp(async (app, userDataDir) => {
    const win = await app.firstWindow();
    await win.waitForLoadState('domcontentloaded');

    await app.evaluate(({ dialog, clipboard }) => {
      const g = globalThis as unknown as { __x30n: Captured };
      g.__x30n = { clipboard: [], current: '' };
      dialog.showMessageBox = (async (...args: unknown[]) => {
        const box = args[args.length - 1] as { title: string; buttons: string[] };
        const pick = (label: string) => box.buttons.indexOf(label);
        let response = 0;
        if (box.title === 'Turn on Agent Access?') response = pick('Turn on');
        else if (box.title === 'Share with Agents?') response = pick('Share');
        else if (box.title === 'Copy setup') response = pick('Copy setup');
        return { response, checkboxChecked: false };
      }) as typeof dialog.showMessageBox;
      clipboard.writeText = (async (text: string) => {
        g.__x30n.clipboard.push(text);
        g.__x30n.current = text;
      }) as typeof clipboard.writeText;
      clipboard.readText = (async () => g.__x30n.current) as typeof clipboard.readText;
      clipboard.clear = (() => {
        g.__x30n.current = '';
      }) as typeof clipboard.clear;
    });

    // An open, shared Connection, its orders tab open, and an Agent's setup on the clipboard.
    const connectionId = await win.evaluate(
      async ({ input, db }) => {
        const api = (window as unknown as { atelier: Api }).atelier;
        const created = await api.conn.create(input);
        await api.mongo.connect(created.id);
        await api.tabs.openCollection({ connectionId: created.id, dbName: db, collection: 'orders' });
        await api.agentAccess.requestEnable();
        await api.agentAccess.connectClient({ name: 'E2E Agent', client: 'claude-code' });
        await api.agentAccess.setShared({ connectionId: created.id, shared: true });
        return created.id;
      },
      { input: { ...baseConnInput(mongo.host, mongo.port), name: CONNECTION_NAME }, db: DB },
    );
    await win.reload();
    await win.waitForLoadState('domcontentloaded');
    await expect(win.getByRole('tab', { name: /orders/, selected: true })).toBeVisible({ timeout: 15_000 });

    const clipboard = await app.evaluate(() => (globalThis as unknown as { __x30n: Captured }).__x30n.clipboard);
    const server = (JSON.parse(clipboard[0]!) as Snippet).mcpServers.latelier;
    const { socketPath } = await agentState(win);
    const client = new Client({ name: 'x30-needs-you', version: '1.0' });
    await client.connect(
      new StdioClientTransport({
        command: server.command,
        args: server.args,
        env: { ...server.env, LATELIER_AGENT_SOCKET: socketPath, HOME: userDataDir, USERPROFILE: userDataDir, APPDATA: userDataDir },
        stderr: 'pipe',
      }),
    );
    const textOf = (r: { content?: unknown }) => (r.content as Array<{ text?: string }>)[0]?.text ?? '';
    const requests = () => agentState(win).then((s) => s.connectionRequests);
    const toasts = win.getByRole('region', { name: 'Agent requests' });

    try {
      // A request for a Connection that is not open toasts in Databases mode.
      await win.evaluate((id) => (window as unknown as { atelier: Api }).atelier.mongo.disconnect(id), connectionId);
      const refused = await client.callTool({ name: 'find', arguments: { connectionId, database: DB, collection: 'orders' } });
      expect(textOf(refused)).toContain('NOT_OPEN');
      const requestToast = toasts.getByTestId('agent-toast-request');
      await expect(requestToast).toContainText(CONNECTION_NAME);
      await expect(requestToast).not.toBeFocused();

      // Open connects it through the ordinary connect action, and the request leaves Needs you.
      await requestToast.getByRole('button', { name: `Open ${CONNECTION_NAME}` }).click();
      await expect.poll(requests).toEqual([]);
      await expect(toasts.getByTestId('agent-toast-request')).toHaveCount(0);
      const retried = await client.callTool({ name: 'count', arguments: { connectionId, database: DB, collection: 'orders' } });
      expect(retried.isError).toBeUndefined();

      // Two Proposals on orders: each toasts, and the strip shows the older one first.
      const propose = async (sourceField: string, targetCollection: string) => {
        const res = await client.callTool({
          name: 'propose_reference_rule',
          arguments: { connectionId, sourceDb: DB, sourceCollection: 'orders', sourceField, targetDb: DB, targetCollection, reason: `${sourceField} <b>holds</b> ${targetCollection}._id` },
        });
        expect(res.isError).toBeUndefined();
        return (JSON.parse(textOf(res).split('\n')[1]!) as { proposalId: string }).proposalId;
      };
      const customerProposal = await propose('customerId', 'customers');
      const sellerProposal = await propose('sellerId', 'sellers');
      await expect(toasts.getByTestId('agent-toast-proposal')).toHaveCount(2);

      const strip = win.getByTestId('agent-proposal-strip');
      await expect(strip).toHaveAttribute('data-proposal-id', customerProposal);
      await expect(strip).toContainText('E2E Agent proposes a Reference Rule: orders.customerId → customers._id');
      await expect(strip.getByTestId('proposal-reason')).toContainText('customerId <b>holds</b> customers._id');
      await expect(strip.getByTestId('proposal-check')).toHaveText('3 of 3 sampled documents in orders resolve');

      // Add Reference Rule: for this Connection, and the Agent reads it as accepted.
      await strip.getByRole('button', { name: 'Add Reference Rule' }).click();
      await expect
        .poll(async () => textOf(await client.callTool({ name: 'get_proposal', arguments: { proposalId: customerProposal } })).split('\n')[0])
        .toBe(JSON.stringify({ proposalId: customerProposal, status: 'accepted', savedFor: 'connection' }));
      const rules = await win.evaluate(
        (id) => (window as unknown as { atelier: Api }).atelier.refs.list({ connectionId: id }),
        connectionId,
      );
      expect(rules).toEqual([expect.objectContaining({ sourceField: 'customerId', targetCollection: 'customers' })]);

      // The new rule is live on orders: the first order's customerId follows to its customer.
      const ws = new WorkspacePage(win);
      await ws.viewTreeButton.click();
      await win.getByRole('button', { name: 'Expand document' }).first().click();
      await win.getByRole('button', { name: 'Open reference to customers' }).first().click();
      const drawer = win.getByRole('complementary', { name: 'Reference drawer' });
      await expect(drawer).toContainText(`${DB}.customers`, { timeout: 10_000 });
      await expect(drawer).toContainText('c1');
      await expect(drawer).not.toContainText('No matching document.');
      await drawer.getByRole('button', { name: 'Close reference drawer' }).click();
      await expect(drawer).toHaveCount(0);

      // The next one takes the strip; Never for this pair asks the app confirm first.
      await expect(strip).toHaveAttribute('data-proposal-id', sellerProposal);
      await strip.getByRole('button', { name: 'Never for this pair' }).click();
      const confirm = win.getByRole('dialog', { name: 'Never for this pair?' });
      await confirm.getByRole('button', { name: 'Cancel' }).click();
      await expect(confirm).toHaveCount(0);
      expect(textOf(await client.callTool({ name: 'get_proposal', arguments: { proposalId: sellerProposal } }))).toContain('"status":"pending"');
      await strip.getByRole('button', { name: 'Never for this pair' }).click();
      await confirm.getByRole('button', { name: 'Never for this pair' }).click();
      await expect
        .poll(async () => textOf(await client.callTool({ name: 'get_proposal', arguments: { proposalId: sellerProposal } })).split('\n')[0])
        .toContain('"status":"declined"');
      await expect(strip).toHaveCount(0);
    } finally {
      await client.close();
    }
  });
});
