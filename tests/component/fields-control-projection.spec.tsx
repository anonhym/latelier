import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import userEvent from '@testing-library/user-event';
import { render, fireEvent, waitFor, within, emptyWorkspaceActions, emptyWorkspaceMeta } from '../helpers/render';
import { resultQueryKey } from '../../src/pages/Workspace/builder';
import { isResultStale } from '../../src/pages/Workspace/resultPaneState';
import { FieldsControl } from '../../src/pages/Workspace/FieldsControl';
import { CollectionWorkspaceProvider } from '../../src/pages/Workspace/CollectionWorkspaceProvider';
import type { CollectionTabState } from '@shared/types';

// W14 §11: one list that writes the projection, and the text that shows it.
// Every case runs against a wrapper that holds real state and merges each
// patch, because the effects here — the text following a click, the list
// greying — only appear once a patch has round-tripped back into props.

type Builder = CollectionTabState['builder'];

function tabState(over: Partial<CollectionTabState> = {}, builder: Partial<Builder> = {}): CollectionTabState {
  return {
    view: 'Table',
    builder: { projection: [], sort: '', limit: '', ...builder },
    queryRaw: '{}',
    page: 0,
    pageSize: 50,
    activeBuilderTab: 'Builder',
    lastRun: {
      documents: [
        { _id: 1, apple: 'a', banana: 2, cherry: true },
        { _id: 2, apple: 'a2', banana: 3, cherry: false },
      ],
      durationMs: 1,
      ranAt: '2026-01-01T00:00:00Z',
    },
    ...over,
  };
}

function Harness({
  initial,
  onState,
  run,
}: {
  initial: CollectionTabState;
  onState: (s: CollectionTabState) => void;
  run: () => void;
}) {
  const [state, setState] = React.useState(initial);
  onState(state);
  const actions = React.useMemo(
    () =>
      emptyWorkspaceActions({
        patchWith: (fn) => setState((prev) => ({ ...prev, ...fn(prev) })),
        patch: (p) => setState((prev) => ({ ...prev, ...p })),
        run,
      }),
    [run],
  );
  return (
    <CollectionWorkspaceProvider state={state} actions={actions} meta={emptyWorkspaceMeta()}>
      <FieldsControl />
    </CollectionWorkspaceProvider>
  );
}

function open(initial: CollectionTabState = tabState()) {
  let latest = initial;
  const run = vi.fn();
  const utils = render(<Harness initial={initial} onState={(s) => (latest = s)} run={run} />);
  const pill = () => utils.getByTestId('option-pill-project');
  fireEvent.click(pill());
  return {
    ...utils,
    run,
    pill,
    state: () => latest,
    text: () => (utils.getByTestId('fields-projection') as HTMLTextAreaElement).value,
    tag: () => utils.getByTestId('fields-mode-tag').textContent,
    box: (name: string) => utils.getByRole('checkbox', { name }) as HTMLInputElement,
    find: () => utils.getByRole('textbox', { name: 'Find a field' }) as HTMLInputElement,
    rowOrder: () =>
      within(utils.getByTestId('fields-list'))
        .getAllByRole('checkbox')
        .map((c) => (c as HTMLInputElement).getAttribute('aria-label') ?? c.closest('label')?.textContent ?? ''),
    type: (text: string) => {
      const input = utils.getByTestId('fields-projection');
      fireEvent.change(input, { target: { value: text } });
      fireEvent.blur(input);
    },
  };
}

describe('FieldsControl — one list, one projection (W14 §11)', () => {
  it('has one list and one text box, with no headings, help line, Add field or badge', () => {
    const r = open(tabState({ columnConfig: { computed: [{ id: 'c1', path: 'address.city' }] } }));
    expect(r.getByTestId('fields-list')).toBeTruthy();
    expect(r.getByTestId('fields-projection')).toBeTruthy();
    expect(r.queryByText(/show in results/i)).toBeNull();
    expect(r.queryByText(/fetch only these fields/i)).toBeNull();
    expect(r.queryByText(/display only/i)).toBeNull();
    expect(r.queryByText(/not fetched/i)).toBeNull();
    expect(r.queryByRole('textbox', { name: /computed column path/i })).toBeNull();
    expect(r.queryByRole('button', { name: /^add column$/i })).toBeNull();
    // A hidden-column or computed-column count on the pill is gone: it states the projection only.
    expect(r.pill().textContent).toBe('Project');
  });

  describe('what the list writes', () => {
    it('unchecking from no projection writes an exclusion, shows it in the text and on the pill', () => {
      const r = open();
      expect(r.tag()).toBe('All fields');
      fireEvent.click(r.box('apple'));
      expect(r.state().builder.projectionRaw).toBe('{"apple":0}');
      expect(r.state().columnConfig?.hidden).toBeUndefined();
      expect(r.text()).toBe('{"apple":0}');
      expect(r.box('apple').checked).toBe(false);
      expect(r.tag()).toBe('Excluding 1');
      expect(r.pill().textContent).toBe('Project: all but 1');
    });

    it('unchecking a second row adds it to the exclusion, and checking one removes it', () => {
      const r = open();
      fireEvent.click(r.box('apple'));
      fireEvent.click(r.box('banana'));
      expect(r.text()).toBe('{"apple":0,"banana":0}');
      expect(r.tag()).toBe('Excluding 2');
      fireEvent.click(r.box('apple'));
      expect(r.text()).toBe('{"banana":0}');
      fireEvent.click(r.box('banana'));
      expect(r.text()).toBe('');
      expect(r.state().builder.projectionRaw).toBeUndefined();
      expect(r.pill().textContent).toBe('Project');
    });

    it('Only _id starts an inclusion, and checking fields builds it up', () => {
      const r = open();
      fireEvent.click(r.getByRole('button', { name: 'Only _id' }));
      expect(r.state().builder.projection).toEqual(['_id']);
      expect(r.text()).toBe('{ _id: 1 }');
      expect(r.tag()).toBe('Including 1');
      expect(r.box('apple').checked).toBe(false);

      fireEvent.click(r.box('apple'));
      fireEvent.click(r.box('cherry'));
      expect(r.state().builder.projection).toEqual(['_id', 'apple', 'cherry']);
      expect(r.text()).toBe('{ _id: 1, apple: 1, cherry: 1 }');
      expect(r.pill().textContent).toBe('Project: 3 fields');
      fireEvent.click(r.box('apple'));
      expect(r.text()).toBe('{ _id: 1, cherry: 1 }');
    });

    it('All clears the projection and the text', () => {
      const r = open(tabState({}, { projectionRaw: '{"apple":0}' }));
      expect(r.text()).toBe('{"apple":0}');
      fireEvent.click(r.getByRole('button', { name: 'All' }));
      expect(r.state().builder.projectionRaw).toBeUndefined();
      expect(r.state().builder.projection).toEqual([]);
      expect(r.text()).toBe('');
      expect(r.tag()).toBe('All fields');
    });

    it('_id is checked and disabled until the projection says _id: 0', () => {
      const r = open();
      expect(r.box('_id').checked).toBe(true);
      expect(r.box('_id').disabled).toBe(true);
      fireEvent.change(r.getByTestId('fields-projection'), { target: { value: '{"_id":0}' } });
      fireEvent.blur(r.getByTestId('fields-projection'));
      expect(r.box('_id').checked).toBe(false);
      expect(r.box('_id').disabled).toBe(false);
      fireEvent.click(r.box('_id'));
      expect(r.state().builder.projectionRaw).toBeUndefined();
    });

    it('unchecking keeps the rows current, checking a field the rows lack does not', () => {
      const base = tabState({}, { projectionRaw: '{"banana":0}' });
      const r = open({ ...base, lastRunQueryKey: resultQueryKey(base)! });
      expect(isResultStale(r.state())).toBe(false);
      fireEvent.click(r.box('apple'));
      expect(r.state().builder.projectionRaw).toBe('{"apple":0,"banana":0}');
      expect(isResultStale(r.state())).toBe(false);
      // Taking `banana` out of the exclusion asks the server for more than the rows hold.
      fireEvent.click(r.box('banana'));
      expect(isResultStale(r.state())).toBe(true);
    });
  });

  describe('typing the projection', () => {
    it('an exclusion typed and committed unchecks its rows, shows the tag and the pill', () => {
      const r = open();
      r.type('{ apple: 0, banana: 0 }');
      expect(r.box('apple').checked).toBe(false);
      expect(r.box('banana').checked).toBe(false);
      expect(r.box('cherry').checked).toBe(true);
      expect(r.tag()).toBe('Excluding 2');
      expect(r.pill().textContent).toBe('Project: all but 2');
      // A third uncheck adds to what was typed.
      fireEvent.click(r.box('cherry'));
      expect(Object.keys(JSON.parse(r.state().builder.projectionRaw!))).toEqual(['apple', 'banana', 'cherry']);
      expect(r.tag()).toBe('Excluding 3');
    });

    it('the text box is two rows tall', () => {
      const r = open();
      const box = r.getByTestId('fields-projection') as HTMLTextAreaElement;
      expect(box.tagName).toBe('TEXTAREA');
      expect(box.rows).toBe(2);
    });

    it('Enter commits the text and inserts no newline', () => {
      const r = open();
      const box = r.getByTestId('fields-projection');
      fireEvent.change(box, { target: { value: '{ apple: 0 }' } });
      // `fireEvent` returns false when the handler called preventDefault, which
      // is what stops a textarea from taking the newline.
      const notPrevented = fireEvent.keyDown(box, { key: 'Enter' });
      expect(notPrevented).toBe(false);
      expect(JSON.parse(r.state().builder.projectionRaw!)).toEqual({ apple: 0 });
      expect(r.text()).not.toContain('\n');
    });
  });

  describe('a name left in the old hidden list', () => {
    it('reads unchecked, and checking it shows the field again', () => {
      const r = open(tabState({ columnConfig: { hidden: ['apple'] } }));
      expect(r.box('apple').checked).toBe(false);
      expect(r.box('banana').checked).toBe(true);
      fireEvent.click(r.box('apple'));
      expect(r.state().columnConfig?.hidden).toEqual([]);
      expect(r.box('apple').checked).toBe(true);
      expect(r.state().builder.projectionRaw).toBeUndefined();
    });
  });

  describe('a locked operator row', () => {
    const sliced = () => tabState({}, { projectionRaw: '{"banana":{"$slice":3}}' });

    it('is disabled and shows its value, and the tag says custom', () => {
      const r = open(sliced());
      expect(r.box('banana').disabled).toBe(true);
      expect(r.getByTestId('fields-locked').textContent).toBe('$slice: 3 · as text');
      expect(r.tag()).toBe('All fields · custom');
    });

    it('unchecking another row sits beside the operator and leaves it alone', () => {
      const r = open(sliced());
      fireEvent.click(r.box('apple'));
      const written = JSON.parse(r.state().builder.projectionRaw!) as Record<string, unknown>;
      expect(written).toEqual({ banana: { $slice: 3 }, apple: 0 });
      expect(r.box('banana').disabled).toBe(true);
    });

    it('under an inclusion, checking a row writes field: 1 beside the operator', () => {
      const r = open(tabState({}, { projectionRaw: '{"banana":{"$slice":3},"apple":1}' }));
      expect(r.tag()).toBe('Including 2 · custom');
      fireEvent.click(r.box('cherry'));
      const written = JSON.parse(r.state().builder.projectionRaw!) as Record<string, unknown>;
      expect(written).toEqual({ banana: { $slice: 3 }, apple: 1, cherry: 1 });
    });
  });

  describe('a draft the projection refuses', () => {
    it('greys the list, keeps its message, and survives a close and reopen', async () => {
      const r = open();
      r.type('{a: }');
      expect(r.getByRole('alert').textContent).toMatch(/comma-separated field list/);
      expect(r.getByTestId('fields-list').getAttribute('aria-disabled')).toBe('true');
      expect(r.box('apple').disabled).toBe(true);
      expect(r.getByRole('button', { name: 'All' }).hasAttribute('disabled')).toBe(true);
      expect(r.pill().textContent).toBe('Project: invalid');

      fireEvent.click(r.pill());
      await waitFor(() => expect(r.queryByTestId('fields-projection')).toBeNull());
      expect(r.pill().textContent).toBe('Project: invalid');
      fireEvent.click(r.pill());
      expect(r.text()).toBe('{a: }');
      expect(r.getByTestId('fields-list').getAttribute('aria-disabled')).toBe('true');
      expect(r.state().builder.projectionRaw).toBeUndefined();

      // Once the text parses the list is back.
      r.type('{ apple: 1 }');
      expect(r.getByTestId('fields-list').getAttribute('aria-disabled')).toBeNull();
      expect(r.box('banana').disabled).toBe(false);
      expect(r.pill().textContent).toBe('Project: 1 field');
    });

    it('a list click while the text is unsettled and bad does not replace it', () => {
      const r = open();
      // No blur: the draft is pending and not yet judged.
      fireEvent.change(r.getByTestId('fields-projection'), { target: { value: '{a: }' } });
      fireEvent.click(r.box('apple'));
      expect(r.text()).toBe('{a: }');
      expect(r.state().builder.projectionRaw).toBeUndefined();
      expect(r.state().builder.projection).toEqual([]);
      expect(r.getByRole('alert')).toBeTruthy();
    });

    it('a list click while the text is unsettled and good commits the text first', () => {
      const r = open();
      fireEvent.change(r.getByTestId('fields-projection'), { target: { value: '{ apple: 0 }' } });
      // No blur, so the list still shows `banana` checked and the click unchecks it.
      fireEvent.click(r.box('banana'));
      expect(r.state().builder.projectionRaw).toBe('{"apple":0,"banana":0}');
      expect(r.text()).toBe('{"apple":0,"banana":0}');
    });

    it('a projection the app cannot read greys the list as well', () => {
      const r = open(tabState({}, { projectionRaw: '{"apple":' }));
      expect(r.getByTestId('fields-list').getAttribute('aria-disabled')).toBe('true');
      expect(r.box('banana').disabled).toBe(true);
    });
  });

  describe('reordering', () => {
    it('keyboard reorder moves the row, leaves the projection alone and keeps focus on the sibling button', async () => {
      const r = open(tabState({}, { projectionRaw: '{"cherry":0}' }));
      const before = r.text();
      await userEvent.click(r.getByRole('button', { name: 'Move apple down' }));
      await userEvent.click(r.getByRole('button', { name: 'Move apple down' }));
      expect(r.state().columnConfig?.order).toEqual(['_id', 'banana', 'cherry', 'apple']);
      expect(r.text()).toBe(before);
      // At the bottom, "down" is disabled and focus went to "up", never <body>.
      expect((r.getByRole('button', { name: 'Move apple down' }) as HTMLButtonElement).disabled).toBe(true);
      expect(document.activeElement).toBe(r.getByRole('button', { name: 'Move apple up' }));
    });

    it('a field written after a reorder follows the list order in the text', async () => {
      const r = open();
      await userEvent.click(r.getByRole('button', { name: 'Move cherry up' }));
      await userEvent.click(r.getByRole('button', { name: 'Move cherry up' }));
      fireEvent.click(r.getByRole('button', { name: 'Only _id' }));
      fireEvent.click(r.box('apple'));
      fireEvent.click(r.box('cherry'));
      // list order is now _id, cherry, apple, banana
      expect(r.text()).toBe('{ _id: 1, cherry: 1, apple: 1 }');
    });

    it('a drag drops a row into place', () => {
      const r = open();
      const rows = r.getAllByTitle(/drag to reorder/i);
      fireEvent.dragStart(rows[3]);
      fireEvent.drop(rows[1]);
      expect(r.state().columnConfig?.order).toEqual(['_id', 'cherry', 'apple', 'banana']);
    });
  });

  describe('on next Run', () => {
    const lagging = (builder: Partial<Builder>) =>
      tabState(
        {
          lastRun: { documents: [{ _id: 1, apple: 'a' }], durationMs: 1, ranAt: '2026-01-01T00:00:00Z' },
          columnConfig: { order: ['_id', 'apple', 'banana'] },
        },
        builder,
      );

    it('marks a checked field the last run did not fetch, and the footer says when it arrives', () => {
      const r = open(lagging({ projection: ['apple', 'banana'] }));
      const row = r.box('banana').closest('div[title]') as HTMLElement;
      expect(within(row).getByText('on next Run')).toBeTruthy();
      expect(r.getAllByText('on next Run')).toHaveLength(1);
      expect(r.getByText(/the server sends the change from the next run/i)).toBeTruthy();
    });

    it('marks nothing for a field the results hold, and shows no footer', () => {
      const r = open(lagging({ projection: ['apple'] }));
      expect(r.queryByText('on next Run')).toBeNull();
      expect(r.queryByText(/the server sends the change/i)).toBeNull();
    });

    it('an unchecked row is not marked, and nothing says "not fetched"', () => {
      const r = open(lagging({ projection: ['apple'] }));
      expect(r.box('banana').checked).toBe(false);
      expect(r.queryByText(/not fetched/i)).toBeNull();
    });

    it('re-checking a field the results lack marks it', () => {
      const r = open(lagging({ projectionRaw: '{"banana":0}' }));
      expect(r.queryByText('on next Run')).toBeNull();
      fireEvent.click(r.box('banana'));
      expect(r.state().builder.projectionRaw).toBeUndefined();
      expect(r.getAllByText('on next Run')).toHaveLength(1);
    });
  });

  describe('a row that nothing in hand names', () => {
    it('stays listed after its exclusion is lifted, so it can be ticked and unticked again', () => {
      const r = open(
        tabState(
          { lastRun: { documents: [{ _id: 1, apple: 'a' }], durationMs: 1, ranAt: '2026-01-01T00:00:00Z' } },
          { projectionRaw: '{"banana":0}' },
        ),
      );
      fireEvent.click(r.box('banana'));
      expect(r.state().builder.projectionRaw).toBeUndefined();
      expect(r.state().columnConfig?.order).toEqual(['_id', 'apple', 'banana']);
      expect(r.box('banana').checked).toBe(true);
      fireEvent.click(r.box('banana'));
      expect(r.state().builder.projectionRaw).toBe('{"banana":0}');
    });

    it('is remembered when All clears the projection that was keeping it', () => {
      const r = open(
        tabState(
          { lastRun: { documents: [{ _id: 1, apple: 'a' }], durationMs: 1, ranAt: '2026-01-01T00:00:00Z' } },
          { projectionRaw: '{"banana":0}' },
        ),
      );
      fireEvent.click(r.getByRole('button', { name: 'All' }));
      expect(r.box('banana').checked).toBe(true);
    });
  });

  describe('a dotted path typed in the find box', () => {
    const withAddress = (builder: Partial<Builder> = {}) =>
      tabState(
        {
          lastRun: {
            documents: [{ _id: 1, name: 'n', address: { city: 'x' } }],
            durationMs: 1,
            ranAt: '2026-01-01T00:00:00Z',
          },
        },
        builder,
      );
    const typeFind = (r: ReturnType<typeof open>, text: string) => fireEvent.change(r.find(), { target: { value: text } });

    it('becomes a column only under no projection', () => {
      const r = open(withAddress());
      typeFind(r, 'address.city');
      fireEvent.keyDown(r.find(), { key: 'Enter' });
      expect(r.state().columnConfig?.computed).toEqual([expect.objectContaining({ path: 'address.city' })]);
      expect(r.state().builder.projection).toEqual([]);
      expect(r.state().builder.projectionRaw).toBeUndefined();
      expect(r.find().value).toBe('');
      expect(r.box('address.city').checked).toBe(true);
    });

    it('is written into an inclusion, through the Add button, and is its own column too', () => {
      const r = open(withAddress({ projection: ['name'] }));
      typeFind(r, 'address.city');
      fireEvent.click(r.getByTestId('fields-add-path'));
      expect(r.state().builder.projection).toEqual(['name', 'address.city']);
      expect(r.state().columnConfig?.computed).toEqual([expect.objectContaining({ path: 'address.city' })]);
      expect(r.text()).toBe('{ name: 1, address.city: 1 }');
      expect(r.pill().textContent).toBe('Project: 2 fields');
      expect(r.box('address.city').checked).toBe(true);
    });

    it('is a column only when its parent is already included, never written beside it', () => {
      const r = open(withAddress({ projection: ['address'] }));
      typeFind(r, 'address.city');
      fireEvent.click(r.getByTestId('fields-add-path'));
      expect(r.state().builder.projection).toEqual(['address']);
      expect(r.state().columnConfig?.computed).toEqual([expect.objectContaining({ path: 'address.city' })]);
    });

    it('is offered only for a dotted path that is not already a row', () => {
      const r = open(withAddress());
      typeFind(r, 'address');
      expect(r.queryByTestId('fields-add-path')).toBeNull();
      typeFind(r, 'address..city');
      expect(r.queryByTestId('fields-add-path')).toBeNull();
      typeFind(r, 'address.$x');
      expect(r.queryByTestId('fields-add-path')).toBeNull();
      typeFind(r, 'address.city');
      expect(r.getByTestId('fields-add-path')).toBeTruthy();
    });

    it('Enter on a match with no dotted path scrolls instead of adding', () => {
      const r = open(withAddress());
      typeFind(r, 'name');
      fireEvent.keyDown(r.find(), { key: 'Enter' });
      expect(r.state().columnConfig?.computed).toBeUndefined();
    });

    it('unchecking a dotted column removes it; under no projection no exclusion is written', () => {
      const r = open(withAddress());
      typeFind(r, 'address.city');
      fireEvent.click(r.getByTestId('fields-add-path'));
      fireEvent.click(r.box('address.city'));
      expect(r.state().columnConfig?.computed).toEqual([]);
      expect(r.state().builder.projectionRaw).toBeUndefined();
      expect(r.queryByRole('checkbox', { name: 'address.city' })).toBeNull();
    });

    it('unchecking a dotted entry under an inclusion takes it out of the projection and keeps the row to tick again', () => {
      const r = open(withAddress({ projection: ['name', 'address.city'] }));
      fireEvent.click(r.box('address.city'));
      expect(r.state().builder.projection).toEqual(['name']);
      expect(r.box('address.city').checked).toBe(false);
    });

    it('unchecking a dotted path added under an inclusion removes both its entry and its column', () => {
      const r = open(withAddress({ projection: ['name'] }));
      typeFind(r, 'address.city');
      fireEvent.click(r.getByTestId('fields-add-path'));
      fireEvent.click(r.box('address.city'));
      expect(r.state().builder.projection).toEqual(['name']);
      expect(r.state().columnConfig?.computed).toEqual([]);
    });

    it('unchecking a dotted column kept beside an included parent removes the column', () => {
      const r = open(withAddress({ projection: ['address'] }));
      typeFind(r, 'address.city');
      fireEvent.click(r.getByTestId('fields-add-path'));
      fireEvent.click(r.box('address.city'));
      expect(r.state().builder.projection).toEqual(['address']);
      expect(r.state().columnConfig?.computed).toEqual([]);
      expect(r.state().columnConfig?.order ?? []).not.toContain('address.city');
    });
  });
});
