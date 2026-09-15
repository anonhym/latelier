import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, screen, waitFor } from '../helpers/render';
import { NewTabPicker } from '../../src/pages/Workspace/DialogStack';
import { installAtelierMock, uninstallAtelierMock } from '../helpers/atelierMock';

/**
 * `NewTabPicker`'s `collsByDb` (`Record<string, string[]>`) is the same
 * shape and same bug as `IndexesTab`'s: a database named `constructor`
 * collides with the inherited `Object` function at `:73` (dedup guard),
 * `:142` (seed-on-switch), and `:180`/`:181` (loading check + render). Any
 * one of these reads returning the inherited function instead of the real
 * collection list breaks the picker.
 */

afterEach(() => {
  uninstallAtelierMock();
  vi.restoreAllMocks();
});

describe('NewTabPicker — collsByDb keyed by a db named "constructor"', () => {
  it('lists the collections instead of treating the inherited Object constructor as cached', async () => {
    installAtelierMock({
      meta: {
        listDatabases: async () => [{ name: 'constructor', sizeOnDisk: 0, empty: false }],
        listCollections: async ({ dbName }) => {
          expect(dbName).toBe('constructor');
          return [
            {
              name: 'people',
              type: 'collection' as const,
              documentCount: 0,
              sizeBytes: 0,
              indexCount: 0,
              capped: false,
            },
          ];
        },
      },
    });

    render(<NewTabPicker connectionId="c1" onCancel={vi.fn()} onPick={vi.fn()} />);

    await waitFor(() => {
      const collSelect = screen.getByLabelText('Collection') as HTMLSelectElement;
      const options = Array.from(collSelect.options).map((o) => o.value);
      expect(options).toContain('people');
    });

    // Loading placeholder must be gone: `!collsByDb[selectedDb]` at :180 also
    // reads through the same inherited-function trap.
    expect(screen.queryByText('Loading…', { selector: 'option' })).toBeNull();
  });
});
