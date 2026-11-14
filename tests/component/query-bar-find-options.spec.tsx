import React from 'react';
import { describe, it, expect, afterEach, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import {
  render,
  screen,
  fireEvent,
  waitFor,
  within,
  emptyWorkspaceActions,
  emptyWorkspaceMeta,
} from '../helpers/render';
import { QueryBar } from '../../src/pages/Workspace/QueryBar';
import { CollectionWorkspaceProvider } from '../../src/pages/Workspace/CollectionWorkspaceProvider';
import Workspace from '../../src/pages/Workspace';
import { installAtelierMock, uninstallAtelierMock } from '../helpers/atelierMock';
import type { BuilderState, CollectionTab, CollectionTabState } from '@shared/types';
import type { IpcApi } from '@shared/ipc';

/**
 * W14 §9 — the find's options: collation, hint, maxTimeMS and readPreference.
 * Pills in the Filter Bar row, and cells of the grid under it while "Keep
 * options expanded" is on, which is where most of these tests edit them. The
 * bar is rendered under a wrapper that holds real state and merges each
 * patch, so what it shows is what a patch round-trip produced, not the
 * fixture it started from.
 */

const b = (over: Partial<BuilderState> = {}): BuilderState => ({ projection: [], sort: '', limit: '', ...over });

function Harness({
  initial,
  expanded,
  onState,
}: {
  initial: BuilderState;
  expanded: boolean;
  onState: (s: CollectionTabState) => void;
}) {
  const [state, setState] = React.useState<CollectionTabState>({
    view: 'Tree',
    builder: initial,
    queryRaw: '{}',
    page: 0,
    pageSize: 50,
    activeBuilderTab: 'Builder',
    optionsExpanded: expanded,
  });
  onState(state);
  const actions = React.useMemo(
    () =>
      emptyWorkspaceActions({
        patch: (p) => setState((s) => ({ ...s, ...p })),
      }),
    [],
  );
  return (
    <CollectionWorkspaceProvider state={state} actions={actions} meta={emptyWorkspaceMeta()}>
      <QueryBar suggestionContext={null} />
    </CollectionWorkspaceProvider>
  );
}

/** The bar with the options grid open, unless `expanded` is false. */
function mountBar(initial: BuilderState, expanded = true) {
  let latest: CollectionTabState | undefined;
  const r = render(<Harness initial={initial} expanded={expanded} onState={(s) => (latest = s)} />);
  return { ...r, builder: () => latest!.builder };
}

const runButton = () => screen.getByTestId<HTMLButtonElement>('query-run-btn');
const runDisabled = () => runButton().disabled;
const strip = () => screen.queryByTestId('query-bar-strip');

describe('QueryBar options row', () => {
  it('names each option off its visible label cell', () => {
    mountBar(b({ hint: '_id_' }));
    expect(screen.getByLabelText('collation')).toBe(screen.getByTestId('query-bar-collation'));
    expect(screen.getByLabelText('hint')).toBe(screen.getByTestId('query-bar-hint'));
    expect(screen.getByLabelText('maxTimeMS')).toBe(screen.getByTestId('query-bar-maxtime'));
    expect(screen.getByLabelText('read pref')).toBe(screen.getByTestId('query-bar-readpref'));
  });

  it('shows a set option in its cell, and patches the builder', () => {
    const { builder } = mountBar(b({ collation: '{"locale":"en"}' }));
    expect(screen.getByTestId<HTMLInputElement>('query-bar-collation').value).toBe('{"locale":"en"}');

    fireEvent.change(screen.getByTestId('query-bar-hint'), { target: { value: 'name_1' } });
    fireEvent.change(screen.getByTestId('query-bar-maxtime'), { target: { value: '500' } });
    fireEvent.change(screen.getByTestId('query-bar-readpref'), { target: { value: 'nearest' } });
    fireEvent.change(screen.getByTestId('query-bar-collation'), { target: { value: '' } });

    expect(builder()).toEqual(
      b({ collation: '', hint: 'name_1', maxTimeMS: '500', readPreference: 'nearest' }),
    );
    expect(screen.getByTestId<HTMLSelectElement>('query-bar-readpref').value).toBe('nearest');
  });

  it('lists the connection default and every read preference mode', () => {
    mountBar(b({ hint: '_id_' }));
    const options = within(screen.getByTestId('query-bar-readpref'))
      .getAllByRole('option')
      .map((o) => (o as HTMLOptionElement).value);
    expect(options).toEqual(['', 'primary', 'primaryPreferred', 'secondary', 'secondaryPreferred', 'nearest']);
  });

  it('an unparseable collation closes Run as it is typed and says why once the field is left', () => {
    mountBar(b());
    expect(runDisabled()).toBe(false);

    const input = screen.getByTestId('query-bar-collation');
    fireEvent.change(input, { target: { value: '{"locale":' } });
    // The gate follows the text; the strip waits for a commit point.
    expect(input.getAttribute('aria-invalid')).toBe('true');
    expect(runDisabled()).toBe(true);
    expect(runButton().textContent).toBe('Fix collation to run');
    expect(strip()).toBeNull();

    fireEvent.blur(input);
    expect(strip()?.getAttribute('role')).toBe('alert');
    expect(strip()?.id).toBe('query-bar-collation-error');
    expect(strip()?.textContent).toMatch(/Collation — Can't parse this collation/);
    expect(input.getAttribute('aria-describedby')).toBe('query-bar-collation-error');

    // Any edit retires the notice it was raised for.
    fireEvent.change(input, { target: { value: '{"locale":"en"}' } });
    expect(strip()).toBeNull();
    expect(runDisabled()).toBe(false);
  });

  it('says why a restored query cannot run as soon as its tab is in front, one problem at a time', () => {
    mountBar(b({ hint: '{"a":', maxTimeMS: '0', readPreference: 'secondaryOnly' }));
    // The first problem in clause order; the others follow as each is fixed.
    expect(strip()?.id).toBe('query-bar-hint-error');
    expect(strip()?.textContent).toMatch(/Hint — Can't parse this hint/);
    expect(screen.getByTestId('query-bar-hint').getAttribute('aria-describedby')).toBe('query-bar-hint-error');
    for (const id of ['query-bar-hint', 'query-bar-maxtime', 'query-bar-readpref']) {
      expect(screen.getByTestId(id).getAttribute('aria-invalid')).toBe('true');
    }
    // The restored value stays the selected one, so the notice names what is shown.
    expect(screen.getByTestId<HTMLSelectElement>('query-bar-readpref').value).toBe('secondaryOnly');

    fireEvent.change(screen.getByTestId('query-bar-hint'), { target: { value: '_id_' } });
    fireEvent.blur(screen.getByTestId('query-bar-hint'));
    expect(strip()?.id).toBe('query-bar-maxtime-error');
    expect(strip()?.textContent).toMatch(/Max time — maxTimeMS must be a whole number/);

    fireEvent.change(screen.getByTestId('query-bar-maxtime'), { target: { value: '10' } });
    fireEvent.blur(screen.getByTestId('query-bar-maxtime'));
    expect(strip()?.id).toBe('query-bar-readpref-error');
    expect(strip()?.textContent).toMatch(/Read preference — "secondaryOnly" is not a read preference/);
  });

  it('says a maxTimeMS over the cap runs at 30000, as a warning that leaves Run open', () => {
    mountBar(b({ maxTimeMS: '40000' }));
    expect(screen.getByTestId('query-bar-maxtime').getAttribute('placeholder')).toBe('max 30000');
    expect(strip()?.id).toBe('query-bar-maxtime-error');
    expect(strip()?.getAttribute('data-tone')).toBe('warn');
    expect(strip()?.textContent).toMatch('Max time — Running with maxTimeMS 30000, the most a query may run.');
    expect(screen.getByTestId('query-bar-maxtime').getAttribute('aria-invalid')).toBe('false');
    expect(runDisabled()).toBe(false);
    expect(runButton().textContent).toContain('Run');
  });

  it('says each set option, and the one that cannot run, on its pill', () => {
    mountBar(b({ sort: '{"a":1}', collation: '{"locale":"en"}', hint: '{' }), false);
    expect(screen.getByTestId('option-pill-sort').textContent).toBe('Sort: a ↑');
    expect(screen.getByTestId('option-pill-collation').textContent).toBe('Collation: en');
    expect(screen.getByTestId('option-pill-hint').textContent).toBe('Hint: invalid');
    expect(screen.getByTestId('option-pill-hint').getAttribute('data-status')).toBe('invalid');
    expect(strip()?.getAttribute('data-tone')).toBe('error');
  });
});

/** Through the real Workspace: what Run sends once the options are on the tab. */
describe('QueryBar options reach the query channels', () => {
  const now = '2026-10-22T12:00:00.000Z';
  const tab = (builder: BuilderState): CollectionTab => ({
    id: 't1',
    kind: 'collection',
    connectionId: 'c1',
    dbName: 'mydb',
    collection: 'users',
    position: 0,
    isActive: true,
    openedAt: now,
    pinned: false,
    state: {
      view: 'Tree',
      builder,
      queryRaw: '{}',
      page: 0,
      pageSize: 50,
      activeBuilderTab: 'Builder',
      lastRun: { documents: [], durationMs: 0, ranAt: now },
    },
  });

  afterEach(() => {
    uninstallAtelierMock();
    vi.restoreAllMocks();
  });

  async function runWith(builder: BuilderState) {
    const find = vi.fn<IpcApi['query']['find']>(async () => ({ documents: [], durationMs: 1, hasMore: false }));
    const count = vi.fn<IpcApi['query']['count']>(async () => ({ count: 0 }));
    const explain = vi.fn<IpcApi['query']['explain']>(async () => ({ plan: {}, verbosity: 'queryPlanner' }));
    installAtelierMock({
      tabs: {
        list: async () => [tab(builder)],
        setActive: async (id) => ({ id }),
        update: async () => tab(builder),
      },
      conn: {
        list: async () => [
          {
            id: 'c1',
            name: 'Local',
            color: '#1A6835',
            host: 'localhost',
            port: 27017,
            connectionType: 'standard',
            readOnly: false,
            status: 'connected',
          },
        ],
      },
      query: { find, count, explain },
    });
    render(
      <MemoryRouter initialEntries={['/workspace']}>
        <Workspace />
      </MemoryRouter>,
    );

    fireEvent.click(await screen.findByTestId('query-run-btn'));
    await waitFor(() => expect(count).toHaveBeenCalled());
    return { find, count, explain };
  }

  it('find gets all four options; count and explain get the ones that decide the match', async () => {
    const { find, count, explain } = await runWith(
      b({
        collation: '{"locale":"en","strength":2}',
        hint: '_id_',
        maxTimeMS: '500',
        readPreference: 'secondaryPreferred',
      }),
    );
    const match = { collation: '{"locale":"en","strength":2}', hint: '_id_', readPreference: 'secondaryPreferred' };
    expect(find.mock.calls[0]![0]).toMatchObject({ ...match, maxTimeMS: 500 });
    expect(count.mock.calls[0]![0]).toMatchObject(match);
    expect(count.mock.calls[0]![0]).not.toHaveProperty('maxTimeMS');
    await waitFor(() => expect(explain).toHaveBeenCalled());
    expect(explain.mock.calls[0]![0]).toMatchObject(match);
  });

  // X14 — Shell Syntax runs as typed, and a quoted index name runs as the name.
  it('a Shell Syntax collation and a quoted hint run, sent as EJSON and the bare name', async () => {
    const { find, count } = await runWith(b({ collation: "{locale: 'en', strength: 2}", hint: '"_id_"' }));
    expect(screen.queryByRole('alert')).toBeNull();
    const match = { collation: '{"locale": "en", "strength": 2}', hint: '_id_' };
    expect(find.mock.calls[0]![0]).toMatchObject(match);
    expect(count.mock.calls[0]![0]).toMatchObject(match);
  });
});
