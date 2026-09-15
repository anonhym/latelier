import { describe, it, expect, vi } from 'vitest';
import { render, fireEvent, within } from '../helpers/render';
import { QueryBar } from '../../src/pages/Workspace/QueryBar';
import { CollectionWorkspaceProvider } from '../../src/pages/Workspace/CollectionWorkspaceProvider';
import type {
  CollectionWorkspaceActions,
  CollectionWorkspaceMeta,
} from '../../src/pages/Workspace/context';
import type { BuilderState, CollectionTabState } from '@shared/types';

/**
 * W14 §1 — the advanced row's open state was `useState(hasAdvanced)`,
 * i.e. an initial value only. `<QueryBar>` has no `key` at its mount site and
 * no resync, so the row stayed frozen at whatever the first tab looked like
 * for the lifetime of the Workspace.
 *
 * The fixture rerenders the provider with a different `state` + `meta` pair,
 * which is exactly what a tab switch does at `Workspace.tsx` — `QueryBar`
 * itself stays mounted through it, same as in the app.
 */

const b = (over: Partial<BuilderState> = {}): BuilderState => ({
  projection: [],
  sort: '',
  limit: '',
  ...over,
});

// Takes the builder by reference so a test can hold one identity across
// rerenders — `actions.patch({ queryRaw })` merges a partial and leaves
// `state.builder` pointing at the same object, and a fixture that minted a
// fresh one would let an identity-keyed effect look guilty for free.
function makeState(builder: BuilderState = b(), queryRaw = '{}'): CollectionTabState {
  return {
    view: 'Tree',
    builder,
    queryRaw,
    page: 0,
    pageSize: 50,
    activeBuilderTab: 'Builder',
  };
}

function makeActions(): CollectionWorkspaceActions {
  return {
    patch: vi.fn(),
    patchWith: vi.fn(),
    run: vi.fn(),
    openEdit: vi.fn(),
    openDelete: vi.fn(),
    openDeleteAll: vi.fn(),
    openInsert: vi.fn(),
    openSave: vi.fn(),
  };
}

function makeMeta(tabId: string, collection: string): CollectionWorkspaceMeta {
  return {
    connectionId: 'c1',
    dbName: 'app',
    collection,
    tabId,
    isLoading: false,
  };
}

// `actions` is optional so the earlier fixtures stay as they were; the
// later tests pass one in to assert on `patch`.
function Bar({
  state,
  meta,
  actions = makeActions(),
}: {
  state: CollectionTabState;
  meta: CollectionWorkspaceMeta;
  actions?: CollectionWorkspaceActions;
}) {
  return (
    <CollectionWorkspaceProvider state={state} actions={actions} meta={meta}>
      <QueryBar suggestionContext={null} />
    </CollectionWorkspaceProvider>
  );
}

const advancedRegion = (container: HTMLElement) =>
  container.querySelector('#query-bar-advanced');

const trigger = (container: HTMLElement) =>
  container.querySelector('[aria-controls="query-bar-advanced"]') as HTMLElement;

// The count badge, scoped to the trigger. Matched by shape rather than a
// testid so dropping the number from it (`set`) fails as loudly as removing
// it — `text-transform` is CSS-only, so jsdom still sees "3 set".
const indicator = (container: HTMLElement) =>
  within(trigger(container)).queryByText(/^\d+ set$/);

// Tab A: nothing advanced set. Tab B: a projection.
const tabA = () => ({ state: makeState(), meta: makeMeta('tA', 'users') });
const tabB = () => ({
  state: makeState(b({ projection: ['name'] })),
  meta: makeMeta('tB', 'orders'),
});

describe('QueryBar — advanced row resyncs across tabs', () => {
  it('opens on switching to a tab with a projection, and closes on switching back', () => {
    const a = tabA();
    const { container, rerender } = render(<Bar {...a} />);
    expect(advancedRegion(container)).toBeNull();

    // A → B: tab B has a projection, so its advanced row must be open.
    const b = tabB();
    rerender(<Bar {...b} />);
    expect(advancedRegion(container)).not.toBeNull();

    // B → A: back to a tab with nothing set — collapsed again.
    rerender(<Bar {...tabA()} />);
    expect(advancedRegion(container)).toBeNull();
  });

  it('keeps an explicit collapse through same-tab re-renders', () => {
    const withSort = makeMeta('tB', 'orders');
    const sortB = b({ sort: '{"a":1}' });
    const { container, rerender } = render(
      <Bar state={makeState(sortB)} meta={withSort} />,
    );
    // Sort is set, so it starts open. The user collapses it.
    expect(advancedRegion(container)).not.toBeNull();
    fireEvent.click(trigger(container));
    expect(advancedRegion(container)).toBeNull();

    // Typing in the query bar must not undo that — same `builder` reference,
    // exactly what `patch({ queryRaw })` leaves behind.
    rerender(<Bar state={makeState(sortB, '{ x: 1 }')} meta={withSort} />);
    expect(advancedRegion(container)).toBeNull();

    // Neither must a builder value changing while it stays set — the table
    // header's quick-sort flipping the direction while the row is collapsed.
    // This is the step a naive resync on `hasAdvanced`/`builder` reopens.
    rerender(<Bar state={makeState(b({ sort: '{"a":-1}' }), '{ x: 1 }')} meta={withSort} />);
    expect(advancedRegion(container)).toBeNull();
  });

  it('opens when a saved query with a projection is loaded into the tab', () => {
    const meta = makeMeta('tA', 'users');
    const { container, rerender } = render(<Bar state={makeState()} meta={meta} />);
    expect(advancedRegion(container)).toBeNull();

    // Saved-run-here patches the same tab's builder + queryRaw in place.
    rerender(
      <Bar state={makeState(b({ projection: ['name', 'email'] }), '{"a":1}')} meta={meta} />,
    );
    expect(advancedRegion(container)).not.toBeNull();
  });
});

/**
 * W14 §2 — collapsed, the trigger's only hint that projection / sort /
 * limit were set was a hover tooltip, which doesn't exist for touch or for a
 * user who never hovers. `advancedCount` existed but rendered nowhere.
 *
 * Both a one-value and a three-value fixture are asserted on purpose: a
 * hardcoded count would survive either one alone.
 */
describe('QueryBar — collapsed advanced count indicator', () => {
  const meta = makeMeta('t1', 'users');
  // A tab with advanced values mounts expanded, so reaching the
  // collapsed-with-values state means the user collapsed it — the exact
  // case where the values go invisible.
  const collapsed = (builder: BuilderState) => {
    const r = render(<Bar state={makeState(builder)} meta={meta} />);
    fireEvent.click(trigger(r.container));
    expect(advancedRegion(r.container)).toBeNull();
    return r;
  };

  it('states how many are set when collapsed — one value', () => {
    const { container } = collapsed(b({ projection: ['name'] }));
    expect(indicator(container)?.textContent).toBe('1 set');
  });

  it('states how many are set when collapsed — all three', () => {
    const { container } = collapsed(
      b({ projection: ['name'], sort: '{"a":1}', limit: '20' }),
    );
    expect(indicator(container)?.textContent).toBe('3 set');
  });

  it('shows no indicator when collapsed with nothing set', () => {
    const { container } = render(<Bar state={makeState()} meta={meta} />);
    expect(advancedRegion(container)).toBeNull();
    expect(indicator(container)).toBeNull();
  });

  it('shows no indicator while expanded — the values are on screen', () => {
    const { container } = render(
      <Bar state={makeState(b({ projection: ['name'], sort: '{"a":1}' }))} meta={meta} />,
    );
    expect(advancedRegion(container)).not.toBeNull();
    expect(indicator(container)).toBeNull();
  });

  it('leaves the trigger operable by keyboard with its aria wiring intact', () => {
    const { container } = render(
      <Bar state={makeState(b({ projection: ['name'] }))} meta={meta} />,
    );
    const t = trigger(container);
    expect(t.getAttribute('aria-controls')).toBe('query-bar-advanced');
    expect(t.getAttribute('aria-expanded')).toBe('true');

    fireEvent.keyDown(t, { key: 'Enter' });
    expect(t.getAttribute('aria-expanded')).toBe('false');
    expect(advancedRegion(container)).toBeNull();
    // The badge is decoration: it must not become a second tab stop.
    const badge = indicator(container);
    expect(badge?.textContent).toBe('1 set');
    expect(badge?.getAttribute('tabindex')).toBeNull();

    fireEvent.keyDown(t, { key: ' ' });
    expect(t.getAttribute('aria-expanded')).toBe('true');
    expect(advancedRegion(container)).not.toBeNull();
  });
});

/**
 * W14 §3 — `commitProjection` ran `setProjDraft(null)` unconditionally,
 * so a refused parse dropped the user's typing and the input fell back to the
 * last committed value with no error, no border, no message.
 *
 * The two failure messages are asserted as distinct on purpose: collapsing
 * them into one generic string would satisfy "an alert is rendered" while
 * losing the only thing that tells the user whether the text is a typo or a
 * shape this editor cannot model at all.
 *
 * W15 §2.1 — the unmodelable message once ended "Use raw MQL for exclusions
 * or $slice", naming a surface that did not exist; an earlier revision cut it back to the
 * bare limitation. A later revision built the surface, so the split moves: an exclusion
 * written as an EJSON document is no longer refused at all — it commits to
 * `builder.projectionRaw` — and the message survives only for text that is
 * neither modellable nor a document, where it names the edit that fixes that.
 */
describe('QueryBar — projection draft retention', () => {
  const meta = makeMeta('t1', 'users');

  // A tab needs something advanced set for the row to be open; a sort
  // keeps `projection` itself empty so `projDisplay` is '' and any text in
  // the input can only have come from the draft.
  const withProjectionInput = (
    builder: BuilderState = b({ sort: '{"a":1}' }),
    actions?: CollectionWorkspaceActions,
  ) => {
    const r = render(<Bar state={makeState(builder)} meta={meta} actions={actions} />);
    // Scoped to this render's container: one test mounts two bars at once.
    const scope = within(r.container);
    return {
      ...r,
      input: scope.getByTestId('query-bar-projection') as HTMLInputElement,
      alerts: () => scope.queryAllByRole('alert'),
    };
  };

  const type = (input: HTMLInputElement, text: string) => {
    fireEvent.change(input, { target: { value: text } });
    fireEvent.blur(input);
  };

  const alertText = (r: { alerts: () => HTMLElement[] }) =>
    r.alerts()[0]?.textContent ?? null;

  it('retains malformed text and explains it, rather than discarding it', () => {
    const r = withProjectionInput();
    type(r.input, '{a: }');

    expect(r.input.value).toBe('{a: }');
    const msg = alertText(r);
    expect(msg).not.toBeNull();
    // A typo is not a raw-MQL problem — pointing there would be wrong advice.
    expect(msg).not.toMatch(/raw MQL/i);
    expect(r.input.getAttribute('aria-invalid')).toBe('true');
  });

  it('retains a non-document exclusion and names the edit that makes it run', () => {
    const r = withProjectionInput();
    // X14 §3 narrowed what can reach this branch. `{a: 0}` used to
    // land here — a real exclusion the inclusion model refuses, and not an
    // EJSON document either, because an unquoted key is not JSON. The
    // transform now repairs that one and it runs, so the branch is reached
    // only by text the transform *refuses*, and the fixture moves with it.
    // What survives here is the same guarantee as before — the draft is retained and
    // something is said about it.
    //
    // X14 §5 answered the wording question T3 left open: for text the
    // transform refused, the message is the transform's own reason, located by
    // line and column. "Quote the keys" named an edit that fixes nothing that
    // can still reach this branch — the fix here is to close the brace.
    type(r.input, '{a: 0');

    expect(r.input.value).toBe('{a: 0');
    expect(alertText(r)).toMatch(/^Line 1, column 6: /);
    expect(alertText(r)).not.toMatch(/quote the keys/i);
    // The named surface exists now — but it is the raw *projection*, not the
    // "raw MQL" input this app still doesn't have.
    expect(alertText(r)).not.toMatch(/raw MQL/i);
  });

  it('escapes $slice to the raw projection instead of refusing it', () => {
    const actions = makeActions();
    const r = withProjectionInput(b({ sort: '{"a":1}' }), actions);
    type(r.input, '{"a":{"$slice":5}}');

    expect(actions.patch).toHaveBeenCalledWith({
      builder: {
        projection: [],
        projectionRaw: '{"a":{"$slice":5}}',
        sort: '{"a":1}',
        limit: '',
      },
    });
    // Committed, not retained: no complaint, and the draft is released.
    expect(r.alerts()).toHaveLength(0);
    expect(r.input.value).toBe('');
  });

  // X14 §5 — three refusals now, and they stay three. The
  // old fixture paired `{a: }` with `{a: 0}`, and since the exclusion surface was built the second one
  // commits to `projectionRaw` rather than complaining, so the assertion was
  // comparing a message against nothing. These three each reach a different
  // branch and must each say a different thing.
  it('gives malformed, transform-refused and unmodelable input different messages', () => {
    const bad = withProjectionInput();
    type(bad.input, '{a: }');
    const malformed = alertText(bad);

    // The transform refuses this one; the message is its reason.
    const unreadable = withProjectionInput();
    type(unreadable.input, '{a: 0');
    const refused = alertText(unreadable);

    // The transform accepts this — well-formed JSON — and it is still neither
    // modellable nor an EJSON *document*, because `$oid: "nothex"` is not BSON.
    const excl = withProjectionInput();
    type(excl.input, '{"a": {"$oid": "nothex"}}');
    const unmodelable = alertText(excl);

    expect(malformed).toMatch(/comma-separated field list/);
    expect(refused).toMatch(/^Line 1, column 6: /);
    expect(unmodelable).toMatch(/only as an EJSON document/);
    expect(new Set([malformed, refused, unmodelable]).size).toBe(3);
  });

  it('commits a valid projection, clears the draft, and shows no alert', () => {
    const actions = makeActions();
    const r = withProjectionInput(b({ sort: '{"a":1}' }), actions);
    type(r.input, '{ name: 1 }');

    expect(actions.patch).toHaveBeenCalledWith({
      builder: { projection: ['name'], sort: '{"a":1}', limit: '' },
    });
    // `patch` is mocked, so state doesn't move; the input falling back to the
    // (still empty) committed display is exactly "the draft was cleared".
    expect(r.input.value).toBe('');
    expect(r.alerts()).toHaveLength(0);
  });

  it('does not leak a retained bad draft into another tab', () => {
    const { container, rerender, getByTestId } = render(
      <Bar state={makeState(b({ sort: '{"a":1}' }))} meta={makeMeta('tA', 'users')} />,
    );
    const input = getByTestId('query-bar-projection') as HTMLInputElement;
    // Unbalanced, so X14's transform refuses it and the draft is still
    // retained — `{a: 0}` now repairs and commits.
    type(input, '{a: 0');
    expect(input.value).toBe('{a: 0');
    expect(within(container).queryAllByRole('alert')).toHaveLength(1);

    // Tab B carries its own projection, so this asserts positively: the cell
    // shows tab B's value, not merely "not tab A's text".
    rerender(
      <Bar state={makeState(b({ projection: ['name'] }))} meta={makeMeta('tB', 'orders')} />,
    );
    expect((getByTestId('query-bar-projection') as HTMLInputElement).value).toBe('{ name: 1 }');
    // The complaint belongs to tab A too.
    expect(within(container).queryAllByRole('alert')).toHaveLength(0);
  });
});
