import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import userEvent from '@testing-library/user-event';
import {
  render,
  screen,
  fireEvent,
  createEvent,
  waitFor,
  within,
  act,
  emptyWorkspaceActions,
  emptyWorkspaceMeta,
} from '../helpers/render';
import { installAtelierMock, uninstallAtelierMock } from '../helpers/atelierMock';
import { QueryBar } from '../../src/pages/Workspace/QueryBar';
import { CollectionWorkspaceProvider } from '../../src/pages/Workspace/CollectionWorkspaceProvider';
import { ReferenceDiscoveryStrip } from '../../src/pages/Workspace/ReferenceDiscoveryStrip';
import { onSuggestionSaved, settleReferenceDiscovery } from '../../src/pages/Workspace/referenceDiscovery';
import { clearCopyOrigin, recordCopyOrigin } from '../../src/utils/copyOrigin';
import type { CollectionTabState, ReferenceRule, ReferenceRuleCreateInput } from '@shared/types';
import type { IpcApi } from '@shared/ipc';

vi.mock('../../src/theme/notifications', () => ({ notify: { success: vi.fn(), error: vi.fn() } }));
import { notify } from '../../src/theme/notifications';

// jsdom has no layout, and CodeMirror measures its text through Range rects on the next frame.
const NO_RECTS = { length: 0, item: () => null, [Symbol.iterator]: function* () {} } as unknown as DOMRectList;
Range.prototype.getClientRects ??= () => NO_RECTS;
Range.prototype.getBoundingClientRect ??= () => new DOMRect();

const ID = '507f1f77bcf86cd799439011';
const NEVER_KEY = 'refs.discovery.never';
const ORDERS_CUSTOMER_ID = { connectionId: 'c1', dbName: 'shop', collection: 'orders', fieldPath: 'customerId' };
const PAIR_KEY = 'c1|["shop","orders","customerId","shop","customers","_id"]';
const HIT = [{ _id: { $oid: ID }, name: 'Alice' }];

let prefs: Map<string, unknown>;
let rules: Pick<ReferenceRule, 'sourceDb' | 'sourceCollection' | 'sourceField'>[];
let families: { id: string; name: string; memberIds: string[] }[];
let create: ReturnType<typeof vi.fn<(input: ReferenceRuleCreateInput) => Promise<ReferenceRule>>>;
let prefsSet: ReturnType<typeof vi.fn<(key: string, value: unknown) => Promise<unknown>>>;

function install() {
  create = vi.fn(async () => ({}) as ReferenceRule);
  prefsSet = vi.fn(async (key: string, value: unknown) => {
    prefs.set(key, value);
    return value;
  });
  installAtelierMock({
    prefs: { get: async (key: string) => prefs.get(key) ?? null, set: prefsSet } as unknown as IpcApi['prefs'],
    refs: { list: (async () => rules) as unknown as IpcApi['refs']['list'], create },
    families: { list: (async () => families) as unknown as IpcApi['families']['list'] },
  });
}

beforeEach(() => {
  prefs = new Map();
  rules = [];
  families = [];
  install();
  recordCopyOrigin(ORDERS_CUSTOMER_ID, ID);
});
afterEach(() => {
  clearCopyOrigin();
  uninstallAtelierMock();
  vi.clearAllMocks();
});

function makeState(): CollectionTabState {
  return { view: 'Tree', builder: { projection: [], sort: '', limit: '' }, queryRaw: '{}', page: 0, pageSize: 50, activeBuilderTab: 'Builder' };
}

const TARGET = { tabId: 't1', connectionId: 'c1', dbName: 'shop', collection: 'customers' };

/** A Collection tab on `customers`. Its Run buttons settle the discovery as the runner does. */
function Tab({ collection = 'customers', onParentKeyDown }: { collection?: string; onParentKeyDown?: (e: React.KeyboardEvent) => void }) {
  const [state, setState] = React.useState(makeState());
  const actions = React.useMemo(
    () => emptyWorkspaceActions({ patch: (p) => setState((s) => ({ ...s, ...p })), patchWith: (fn) => setState((s) => ({ ...s, ...fn(s) })) }),
    [],
  );
  const meta = React.useMemo(() => emptyWorkspaceMeta({ connectionId: 'c1', dbName: 'shop', collection }), [collection]);
  return (
    <div onKeyDown={onParentKeyDown}>
      <CollectionWorkspaceProvider state={state} actions={actions} meta={meta}>
        <QueryBar suggestionContext={null} />
        <button type="button" onClick={() => void settleReferenceDiscovery({ ...TARGET, collection }, HIT)}>Run with a hit</button>
        <button type="button" onClick={() => void settleReferenceDiscovery({ ...TARGET, collection }, [{ _id: 1, name: 'Bob' }])}>Run with no hit</button>
        <button type="button" onClick={() => void settleReferenceDiscovery({ ...TARGET, collection }, [])}>Run with nothing</button>
      </CollectionWorkspaceProvider>
    </div>
  );
}

function paste(text: string) {
  const target = screen.getByTestId('query-bar-input');
  const event = createEvent.paste(target, { clipboardData: { getData: () => text } });
  fireEvent(target, event);
  return event;
}

const strip = () => screen.queryByTestId('reference-discovery-strip');
/** A button of the strip: the Query Bar has a Save button of its own. */
const inStrip = (name: string) => within(screen.getByTestId('reference-discovery-strip')).getByRole('button', { name });
const run = (name: string) => act(async () => void (await userEvent.click(screen.getByRole('button', { name }))));

async function pasteAndRun(runName = 'Run with a hit', text = `{ _id: ObjectId("${ID}") }`) {
  paste(text);
  await run(runName);
}

describe('reference discovery', () => {
  it('a paste into another Collection and a Run with a hit offers the rule', async () => {
    render(<Tab />);
    await pasteAndRun();
    const region = await screen.findByTestId('reference-discovery-strip');
    expect(region.textContent).toContain('orders.customerId → customers._id');
    expect(inStrip('Save')).toBeTruthy();
    expect(inStrip('Not now')).toBeTruthy();
    expect(inStrip('Never for this pair')).toBeTruthy();
  });

  it('the paste itself is left alone', () => {
    render(<Tab />);
    expect(paste(`{ _id: ObjectId("${ID}") }`).defaultPrevented).toBe(false);
  });

  it('a Run with no hit, or no documents, offers nothing, and drops the pending paste', async () => {
    render(<Tab />);
    await pasteAndRun('Run with no hit');
    expect(strip()).toBeNull();
    // The paste was consumed by that Run: a later hit has nothing to be a hit of.
    await run('Run with a hit');
    expect(strip()).toBeNull();
    await pasteAndRun('Run with nothing');
    await run('Run with a hit');
    expect(strip()).toBeNull();
  });

  it('a Run with no preceding paste offers nothing', async () => {
    render(<Tab />);
    await run('Run with a hit');
    expect(strip()).toBeNull();
  });

  it('a paste into the Collection the value was copied from offers nothing', async () => {
    render(<Tab collection="orders" />);
    await pasteAndRun();
    expect(strip()).toBeNull();
  });

  it('a paste without the copied value offers nothing', async () => {
    render(<Tab />);
    await pasteAndRun('Run with a hit', '{ name: "Alice" }');
    expect(strip()).toBeNull();
  });

  it('a copy that came from no single field offers nothing', async () => {
    recordCopyOrigin({ connectionId: 'c1', dbName: 'shop', collection: 'orders' }, `{ "_id": { "$oid": "${ID}" } }`);
    render(<Tab />);
    await pasteAndRun();
    expect(strip()).toBeNull();
  });

  it('a copy from another Connection offers nothing', async () => {
    recordCopyOrigin({ ...ORDERS_CUSTOMER_ID, connectionId: 'c2' }, ID);
    render(<Tab />);
    await pasteAndRun();
    expect(strip()).toBeNull();
  });

  it('a rule that already covers the source field suppresses it', async () => {
    rules = [{ sourceDb: 'shop', sourceCollection: 'orders', sourceField: 'customerId' }];
    render(<Tab />);
    await pasteAndRun();
    expect(strip()).toBeNull();
  });

  it('never saves by itself', async () => {
    render(<Tab />);
    await pasteAndRun();
    await screen.findByTestId('reference-discovery-strip');
    await run('Run with a hit');
    expect(create).not.toHaveBeenCalled();
    expect(prefsSet).not.toHaveBeenCalled();
  });

  it('a copied _id found in another field suggests the rule the other way round', async () => {
    recordCopyOrigin({ connectionId: 'c1', dbName: 'shop', collection: 'customers', fieldPath: '_id' }, ID);
    render(<Tab collection="orders" />);
    paste(ID);
    await act(async () => void (await settleReferenceDiscovery({ ...TARGET, collection: 'orders' }, [{ _id: 1, customerId: { $oid: ID } }])));
    expect((await screen.findByTestId('reference-discovery-strip')).textContent).toContain('orders.customerId → customers._id');
    await userEvent.click(inStrip('Save'));
    await waitFor(() => expect(create).toHaveBeenCalledTimes(1));
    expect(create.mock.calls[0]![0]).toMatchObject({ sourceCollection: 'orders', sourceField: 'customerId', targetCollection: 'customers', targetField: '_id' });
  });
});

describe('Save', () => {
  it('creates the rule on the Connection, and the strip goes', async () => {
    render(<Tab />);
    await pasteAndRun();
    await screen.findByTestId('reference-discovery-strip');
    await userEvent.click(inStrip('Save'));
    await waitFor(() => expect(strip()).toBeNull());
    expect(create).toHaveBeenCalledTimes(1);
    expect(create).toHaveBeenCalledWith({
      owner: { connectionId: 'c1' },
      sourceDb: 'shop',
      sourceCollection: 'orders',
      sourceField: 'customerId',
      targetDb: 'shop',
      targetCollection: 'customers',
      targetField: '_id',
    });
    expect(notify.success).toHaveBeenCalled();
  });

  it('tells the rule readers once the rule is saved, and not after it is unsubscribed or when the save fails', async () => {
    const listener = vi.fn();
    const off = onSuggestionSaved(listener);
    create.mockRejectedValueOnce(Object.assign(new Error('nope'), { code: 'CONFLICT' }));
    render(<Tab />);
    await pasteAndRun();
    await screen.findByTestId('reference-discovery-strip');
    await userEvent.click(inStrip('Save'));
    await waitFor(() => expect(notify.error).toHaveBeenCalled());
    expect(listener).not.toHaveBeenCalled();
    await userEvent.click(inStrip('Save'));
    await waitFor(() => expect(listener).toHaveBeenCalledTimes(1));
    off();
    await pasteAndRun();
    await screen.findByTestId('reference-discovery-strip');
    await userEvent.click(inStrip('Save'));
    await waitFor(() => expect(create).toHaveBeenCalledTimes(3));
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it('shares the rule with the Family of a member, and can keep it on the Connection alone', async () => {
    families = [{ id: 'f1', name: 'Client deployments', memberIds: ['c1', 'c9'] }];
    render(<Tab />);
    await pasteAndRun();
    expect((await screen.findByTestId('reference-discovery-strip')).textContent).toContain('shared with Client deployments');
    await userEvent.click(inStrip('Save'));
    await waitFor(() => expect(create).toHaveBeenCalledTimes(1));
    expect(create.mock.calls[0]![0].owner).toEqual({ familyId: 'f1' });

    await pasteAndRun();
    await userEvent.click(await screen.findByRole('button', { name: 'Save for this connection only' }));
    await waitFor(() => expect(create).toHaveBeenCalledTimes(2));
    expect(create.mock.calls[1]![0].owner).toEqual({ connectionId: 'c1' });
  });

  it('saves nothing, and drops the suggestion, when the Connection left the Family it was made for', async () => {
    families = [{ id: 'f1', name: 'Client deployments', memberIds: ['c1', 'c9'] }];
    render(<Tab />);
    await pasteAndRun();
    await screen.findByTestId('reference-discovery-strip');
    families = [{ id: 'f1', name: 'Client deployments', memberIds: ['c9'] }];
    await userEvent.click(inStrip('Save'));
    await waitFor(() => expect(notify.error).toHaveBeenCalledWith(expect.stringContaining('family changed')));
    expect(create).not.toHaveBeenCalled();
    expect(strip()).toBeNull();
  });

  it('a Connection outside any Family has no connection-only button', async () => {
    families = [{ id: 'f1', name: 'Other', memberIds: ['c9'] }];
    render(<Tab />);
    await pasteAndRun();
    await screen.findByTestId('reference-discovery-strip');
    expect(screen.queryByRole('button', { name: 'Save for this connection only' })).toBeNull();
  });

  it('keeps the strip and says so when the rule cannot be created', async () => {
    create.mockRejectedValueOnce(Object.assign(new Error('A rule for that field already exists'), { code: 'CONFLICT' }));
    render(<Tab />);
    await pasteAndRun();
    await screen.findByTestId('reference-discovery-strip');
    await userEvent.click(inStrip('Save'));
    await waitFor(() => expect(notify.error).toHaveBeenCalledWith('A rule for that field already exists'));
    expect(strip()).not.toBeNull();
    expect((inStrip('Save') as HTMLButtonElement).disabled).toBe(false);
  });
});

describe('Never for this pair', () => {
  it('remembers the pair and offers it no more, for any later copy', async () => {
    render(<Tab />);
    await pasteAndRun();
    await userEvent.click(await screen.findByRole('button', { name: 'Never for this pair' }));
    await waitFor(() => expect(strip()).toBeNull());
    expect(prefsSet).toHaveBeenCalledWith(NEVER_KEY, [PAIR_KEY]);
    expect(create).not.toHaveBeenCalled();

    recordCopyOrigin(ORDERS_CUSTOMER_ID, ID);
    await pasteAndRun();
    expect(strip()).toBeNull();
  });

  it('keeps the pairs already stored, and offers a different pair', async () => {
    prefs.set(NEVER_KEY, ['older-pair']);
    render(<Tab />);
    await pasteAndRun();
    await userEvent.click(await screen.findByRole('button', { name: 'Never for this pair' }));
    await waitFor(() => expect(prefsSet).toHaveBeenCalledWith(NEVER_KEY, ['older-pair', PAIR_KEY]));

    recordCopyOrigin({ ...ORDERS_CUSTOMER_ID, fieldPath: 'billingId' }, ID);
    await pasteAndRun();
    expect((await screen.findByTestId('reference-discovery-strip')).textContent).toContain('orders.billingId');
  });

  it('a stored list that is not a list of strings suppresses nothing', async () => {
    prefs.set(NEVER_KEY, { [PAIR_KEY]: true });
    render(<Tab />);
    await pasteAndRun();
    expect(await screen.findByTestId('reference-discovery-strip')).toBeTruthy();
  });

  it('keeps the strip when the choice cannot be stored', async () => {
    prefsSet.mockRejectedValueOnce(new Error('disk full'));
    render(<Tab />);
    await pasteAndRun();
    await userEvent.click(await screen.findByRole('button', { name: 'Never for this pair' }));
    await waitFor(() => expect(notify.error).toHaveBeenCalledWith('disk full'));
    expect(strip()).not.toBeNull();
  });
});

describe('Not now', () => {
  it('goes, and does not come back for the same copy, but does for the next one', async () => {
    render(<Tab />);
    await pasteAndRun();
    await userEvent.click(await screen.findByRole('button', { name: 'Not now' }));
    expect(strip()).toBeNull();
    expect(prefsSet).not.toHaveBeenCalled();

    await pasteAndRun();
    expect(strip()).toBeNull();

    recordCopyOrigin(ORDERS_CUSTOMER_ID, ID);
    await pasteAndRun();
    expect(await screen.findByTestId('reference-discovery-strip')).toBeTruthy();
  });

  it('declines the pair for the copy that made the offer, not for one copied since', async () => {
    render(<Tab />);
    await pasteAndRun();
    await screen.findByTestId('reference-discovery-strip');
    recordCopyOrigin(ORDERS_CUSTOMER_ID, ID);
    await userEvent.click(screen.getByRole('button', { name: 'Not now' }));
    await pasteAndRun();
    expect(await screen.findByTestId('reference-discovery-strip')).toBeTruthy();
  });
});

describe('ReferenceDiscoveryStrip', () => {
  it('shows nothing until the tab holds a suggestion', () => {
    render(<ReferenceDiscoveryStrip tabId="t1" />);
    expect(strip()).toBeNull();
  });

  it('Escape acts as Not now and goes no further', async () => {
    const onParentKeyDown = vi.fn();
    render(<Tab onParentKeyDown={onParentKeyDown} />);
    await pasteAndRun();
    await screen.findByTestId('reference-discovery-strip');
    inStrip('Save').focus();
    onParentKeyDown.mockClear();
    await userEvent.keyboard('{Escape}');
    expect(strip()).toBeNull();
    expect(onParentKeyDown).not.toHaveBeenCalled();
    expect(create).not.toHaveBeenCalled();
    await pasteAndRun();
    expect(strip()).toBeNull();
  });

  it('other keys inside the strip are not swallowed', async () => {
    const onParentKeyDown = vi.fn();
    render(<Tab onParentKeyDown={onParentKeyDown} />);
    await pasteAndRun();
    await screen.findByTestId('reference-discovery-strip');
    inStrip('Save').focus();
    onParentKeyDown.mockClear();
    await userEvent.keyboard('a');
    expect(onParentKeyDown).toHaveBeenCalledTimes(1);
    expect(strip()).not.toBeNull();
  });

  it('is a status region', async () => {
    render(<Tab />);
    await pasteAndRun();
    expect((await screen.findByRole('status')).getAttribute('data-testid')).toBe('reference-discovery-strip');
  });
});
