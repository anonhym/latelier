// ADR 0004's "Scope note: symbolic operators in the Query Builder".
//
// The resolver itself is covered in `tests/unit/operator-symbols.spec.ts`.
// What only a rendered row can show is *when* it fires: on blur, never per
// keystroke, and not at all when the popover already chose the operator.
import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, screen, fireEvent } from '../helpers/render';
import { MemoryRouter } from 'react-router-dom';
import Workspace from '../../src/pages/Workspace';
import { installAtelierMock, uninstallAtelierMock } from '../helpers/atelierMock';
import type { CollectionTabState, WorkspaceTab } from '@shared/types';
import type { IpcApi } from '@shared/ipc';

const now = '2026-08-09T12:00:00.000Z';

function makeState(): CollectionTabState {
  return {
    view: 'Tree',
    builder: { projection: [], sort: '', limit: '' },
    queryRaw: '{}',
    page: 0,
    pageSize: 50,
    activeBuilderTab: 'Builder',
    lastRun: { documents: [], durationMs: 0, ranAt: now },
  };
}

function makeTab(state: CollectionTabState): WorkspaceTab {
  return {
    id: 't1',
    kind: 'collection',
    connectionId: 'c1',
    dbName: 'mydb',
    collection: 'users',
    position: 0,
    isActive: true,
    openedAt: now,
    pinned: false,
    state,
  };
}

const CONNECTION = {
  id: 'c1',
  name: 'Local',
  color: '#1A6835',
  host: 'localhost',
  port: 27017,
  connectionType: 'standard' as const,
  readOnly: false,
  status: 'connected' as const,
};

/** Renders the workspace and returns the operator box of one pending row. */
async function openConditionRow(): Promise<HTMLInputElement> {
  const state = makeState();
  installAtelierMock({
    tabs: {
      list: async () => [makeTab(state)],
      setActive: async (id) => ({ id }),
      update: (vi.fn(async () => makeTab(state)) as unknown) as IpcApi['tabs']['update'],
    },
    conn: { list: async () => [CONNECTION] },
    query: {
      find: vi.fn(async () => ({ documents: [], durationMs: 1, hasMore: false })),
      count: async () => ({ count: 0 }),
    },
  });
  render(
    <MemoryRouter initialEntries={['/workspace']}>
      <Workspace />
    </MemoryRouter>,
  );

  fireEvent.click(await screen.findByRole('button', { name: 'Add condition' }));
  await screen.findByPlaceholderText('field');
  return (await screen.findByPlaceholderText('$op')) as HTMLInputElement;
}

afterEach(() => {
  uninstallAtelierMock();
  vi.restoreAllMocks();
});

// #130 — the operator box reuses SuggestionPopover; its listbox must not
// announce itself as the field list.
describe('Query Builder — operator suggestions listbox (#130)', () => {
  it('is named "Operator suggestions", not "Field suggestions"', async () => {
    const opInput = await openConditionRow();

    fireEvent.focus(opInput);
    fireEvent.change(opInput, { target: { value: '$g' } });

    expect(await screen.findByRole('listbox', { name: 'Operator suggestions' })).toBeTruthy();
    expect(screen.queryByRole('listbox', { name: 'Field suggestions' })).toBeNull();
  });
});

describe('Query Builder — symbolic operators', () => {
  it.each([
    ['>', '$gt'],
    ['>=', '$gte'],
    ['<=', '$lte'],
    ['!=', '$ne'],
    ['=', '$eq'],
    ['≥', '$gte'],
    ['≠', '$ne'],
  ])('resolves %s to %s on blur', async (symbol, op) => {
    const opInput = await openConditionRow();

    fireEvent.change(opInput, { target: { value: symbol } });
    fireEvent.blur(opInput);

    // The box shows the operator, not the symbol. That is the point: `node.op`
    // always holds a real operator, so `printFilter` and `isCompilableOp` need
    // no change, and the user keeps learning the operator's name.
    expect(((await screen.findByPlaceholderText('$op')) as HTMLInputElement).value).toBe(op);
  });

  it('does not resolve while the user is still typing a longer symbol', async () => {
    // The trap ADR 0004 names: `>` is a prefix of `>=`. A per-keystroke map
    // rewrites the box to `$gt` before the `=` is ever typed.
    const opInput = await openConditionRow();

    fireEvent.change(opInput, { target: { value: '>' } });
    expect(((await screen.findByPlaceholderText('$op')) as HTMLInputElement).value).toBe('>');

    fireEvent.change(opInput, { target: { value: '>=' } });
    expect(((await screen.findByPlaceholderText('$op')) as HTMLInputElement).value).toBe('>=');

    fireEvent.blur(opInput);
    expect(((await screen.findByPlaceholderText('$op')) as HTMLInputElement).value).toBe('$gte');
  });

  it('resolves on Enter, not only on blur', async () => {
    // the manual-test miss. Blur covers Tab and click-away; Enter is
    // the other "I am done with this box" keystroke and left `>` sitting in
    // an unprintable row.
    const opInput = await openConditionRow();

    fireEvent.change(opInput, { target: { value: '>' } });
    fireEvent.keyDown(opInput, { key: 'Enter' });

    expect(((await screen.findByPlaceholderText('$op')) as HTMLInputElement).value).toBe('$gt');
  });

  it('leaves ⌘Enter alone, so the box never claims more than the run used', async () => {
    // ⌘/Ctrl+Enter runs the query from any drawer input. Resolving here would
    // repaint the box as `$gt` while the run still read the last-committed
    // filter — the patch has not rendered. A visibly unfinished row is the
    // honest state, so this stays as it is.
    const opInput = await openConditionRow();

    fireEvent.change(opInput, { target: { value: '>' } });
    fireEvent.keyDown(opInput, { key: 'Enter', metaKey: true });

    expect(((await screen.findByPlaceholderText('$op')) as HTMLInputElement).value).toBe('>');
  });

  it('does not override an Enter the popover already handled', async () => {
    // The popover `preventDefault`s the Enter that picks an arrowed-into row.
    // Its listener is native and bound to this input, so it runs before
    // React's delegated handler — without the `defaultPrevented` check,
    // arrowing to an operator over a typed `>` would land `$gt` instead.
    // Stands in for the popover itself, by the same mechanism: a native
    // listener on the input, which the DOM runs before React's delegated
    // handler. The real thing is unreachable today — the ranker returns zero
    // rows while the box holds a bare symbol, so there is nothing to arrow
    // into — which is why this asserts the guard rather than the scenario.
    const opInput = await openConditionRow();
    opInput.addEventListener('keydown', (e) => e.preventDefault());

    fireEvent.change(opInput, { target: { value: '>' } });
    fireEvent.keyDown(opInput, { key: 'Enter' });

    expect(((await screen.findByPlaceholderText('$op')) as HTMLInputElement).value).toBe('>');
  });

  it('leaves text it does not recognise exactly as typed', async () => {
    const opInput = await openConditionRow();

    fireEvent.change(opInput, { target: { value: '~=' } });
    fireEvent.blur(opInput);

    expect(((await screen.findByPlaceholderText('$op')) as HTMLInputElement).value).toBe('~=');
  });

  it('re-blurring a resolved operator does not rewrite it', async () => {
    const opInput = await openConditionRow();

    fireEvent.change(opInput, { target: { value: '>' } });
    fireEvent.blur(opInput);
    const resolved = (await screen.findByPlaceholderText('$op')) as HTMLInputElement;
    expect(resolved.value).toBe('$gt');

    fireEvent.focus(resolved);
    fireEvent.blur(resolved);

    expect(((await screen.findByPlaceholderText('$op')) as HTMLInputElement).value).toBe('$gt');
  });

  it('a popover choice lands exactly the operator chosen', async () => {
    // The popover blurs the input on its way out, so the blur handler runs
    // next — against a `node.op` that has not re-rendered yet. `patch` spreads
    // a stale `node` rather than taking a functional update, so two patches in
    // one tick clobber. `symbolResolvedByPopover` in `BuilderPane.tsx` is what
    // keeps the second one from firing.
    //
    // Worth being exact about what this test does and does not reach: with a
    // symbol in the box the popover currently ranks *zero* rows, so there is
    // no row to click and the clobber cannot happen today. The guard is
    // therefore defence for a ranking change, not a live fix, and this test
    // covers only the reachable half — a box holding text that is not a
    // symbol, where `patch` still runs and the resolve step must not undo it.
    const opInput = await openConditionRow();
    fireEvent.focus(opInput);
    fireEvent.change(opInput, { target: { value: '$in' } });

    // By row rather than by text: `$in` is a prefix of `$indexOfArray` and
    // friends, which are all in the same ranked list.
    const rows = await screen.findAllByRole('option');
    const option = rows.find((r) => r.querySelector('span')?.textContent === '$in');
    expect(option).toBeDefined();
    fireEvent.click(option!);

    expect(((await screen.findByPlaceholderText('$op')) as HTMLInputElement).value).toBe('$in');
  });

  it('shows the symbol and an English name next to the operator', async () => {
    const opInput = await openConditionRow();
    fireEvent.focus(opInput);
    fireEvent.change(opInput, { target: { value: '$gt' } });

    expect(await screen.findByText('> greater than')).toBeTruthy();
  });

  it('names an operator that has no symbol, without inventing one', async () => {
    const opInput = await openConditionRow();
    fireEvent.focus(opInput);
    fireEvent.change(opInput, { target: { value: '$in' } });

    expect(await screen.findByText('is one of')).toBeTruthy();
  });
});
