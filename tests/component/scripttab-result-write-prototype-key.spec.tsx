import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, screen, waitFor, fireEvent } from '../helpers/render';
import { ScriptTab } from '../../src/pages/Workspace/ScriptTab';
import { installAtelierMock, uninstallAtelierMock } from '../helpers/atelierMock';
import type { ScriptTab as ScriptTabModel } from '@shared/types';

/**
 * ScriptTab's own `onRowExpand`/`onColumnResize` (feeding
 * `resultColumns`/`resultExpandedRows` into the same `TableView`/`TreeView`
 * already fixed for reads) write with plain bracket assignment on a spread
 * copy: `next[docId] = true`. `docId` comes from `getFullDocId`, so it can
 * legally be `__proto__` — same write-side bug `collectionPatches.ts`'s
 * `rowExpandPatch` already documents and fixes for the Workspace-tab path.
 * This is the ScriptTab-local duplicate of that write.
 */

afterEach(() => {
  uninstallAtelierMock();
  vi.restoreAllMocks();
});

const now = '2026-08-25T00:00:00.000Z';

function scriptTab(overrides: Partial<ScriptTabModel['state']> = {}): ScriptTabModel {
  return {
    id: 't1',
    kind: 'script',
    connectionId: 'c1',
    dbName: '',
    collection: '',
    position: 0,
    isActive: true,
    openedAt: now,
    pinned: false,
    state: {
      title: 'Script',
      source: '',
      resultView: 'Tree',
      lastResult: {
        valueJson: JSON.stringify([{ _id: { $oid: '__proto__' }, name: 'x' }]),
        printBuffer: '',
        durationMs: 1,
      },
      ...overrides,
    },
  };
}

describe('ScriptTab — resultExpandedRows keyed by a "__proto__" docId', () => {
  it('toggles expanded when clicked, and back to collapsed', async () => {
    installAtelierMock({
      meta: { listCollections: async () => [] },
    });

    let tab = scriptTab();
    const onPatch = vi.fn((patch: Partial<ScriptTabModel['state']>) => {
      tab = { ...tab, state: { ...tab.state, ...patch } };
      rerender(<ScriptTab tab={tab} onPatch={onPatch} />);
    });

    const { container, rerender } = render(<ScriptTab tab={tab} onPatch={onPatch} />);

    await waitFor(() => expect(screen.getByText('1 doc')).toBeTruthy());

    fireEvent.click(container.querySelector('[aria-label="Expand document"]')!);
    // Built via `Object.prototype.hasOwnProperty`, not `{ __proto__: true }`
    // object-literal syntax — that literal form is itself special-cased by
    // the language (a non-object value assigned to a literal `__proto__` key
    // is silently dropped, creating no own property at all), which would
    // make this assertion pass unconditionally regardless of the fix.
    expect(
      Object.prototype.hasOwnProperty.call(tab.state.resultExpandedRows ?? {}, '__proto__'),
    ).toBe(true);
    expect(tab.state.resultExpandedRows?.['__proto__']).toBe(true);

    await waitFor(() => {
      expect(container.querySelector('[data-expanded-doc-section]')).not.toBeNull();
    });

    fireEvent.click(container.querySelector('[aria-label="Collapse document"]')!);
    await waitFor(() => {
      expect(container.querySelector('[data-expanded-doc-section]')).toBeNull();
    });
  });
});
