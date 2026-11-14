// X07 §14: the anchored palette, the empty query's collections group, unavailable
// rows and the kind icons.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent, within, act } from '../helpers/render';
import { MemoryRouter } from 'react-router-dom';
import { CommandPaletteRoot, usePaletteApi, _resetPaletteStoreForTests } from '../../src/commands/CommandPalette';
import { PaletteContextProvider } from '../../src/commands/PaletteContext';
import { useRegisterCommands } from '../../src/commands/useRegisterCommands';
import { useRegisterObjects } from '../../src/commands/useRegisterObjects';
import { commandRegistry } from '../../src/commands/registry';
import { _resetPaletteCollectionsForTests, publishPaletteCollections } from '../../src/state/paletteCollections';
import { installAtelierMock, uninstallAtelierMock } from '../helpers/atelierMock';
import type { Command, PaletteObject } from '../../src/commands/types';

function ToggleButton() {
  const palette = usePaletteApi();
  return <button onClick={palette.toggle}>toggle</button>;
}

function Register({ objects, commands }: { objects: PaletteObject[]; commands: Command[] }) {
  useRegisterObjects(objects, [objects]);
  useRegisterCommands(commands, [commands]);
  return null;
}

const collection = (connectionId: string, name: string): PaletteObject => ({
  id: `tab.open:${connectionId}:shop:${name}`,
  kind: 'collection',
  name: `shop.${name}`,
  connectionId,
  actions: [{ id: 'open', verb: 'open', title: 'Open', perform: () => {} }],
});

const NAMES = ['a', 'b', 'c', 'd', 'e', 'f', 'g'];
const OBJECTS = [...NAMES.map((n) => collection('c1', n)), collection('c2', 'zz')];

const ok: Command = { id: 'ok', title: 'Open settings', group: 'general', perform: () => {} };
const off: Command = {
  id: 'off',
  title: 'Explain query',
  group: 'query',
  disabledReason: () => "Can't parse this filter",
  perform: () => {},
};

function mount(commands: Command[] = [off, ok], objects: PaletteObject[] = OBJECTS) {
  installAtelierMock({ prefs: { get: async () => [], set: async (_k: string, v: unknown) => v } as never });
  render(
    <MemoryRouter>
      <PaletteContextProvider>
        <CommandPaletteRoot>
          <Register objects={objects} commands={commands} />
          <ToggleButton />
        </CommandPaletteRoot>
      </PaletteContextProvider>
    </MemoryRouter>,
  );
}

const open = () => fireEvent.click(screen.getByText('toggle'));
const dialog = () => screen.getByRole('dialog', { name: 'Command palette' });
const groupNamed = (label: string) => within(dialog()).getByText(label).closest('[role="group"]') as HTMLElement;
const titles = (root: HTMLElement) =>
  Array.from(root.querySelectorAll('[role="option"]')).map(
    (o) => o.querySelector('[data-title]')?.getAttribute('data-title') ?? o.textContent ?? '',
  );

afterEach(() => {
  uninstallAtelierMock();
  commandRegistry._resetForTests();
  _resetPaletteStoreForTests();
  _resetPaletteCollectionsForTests();
  document.querySelectorAll('[data-palette-anchor]').forEach((el) => el.remove());
  vi.restoreAllMocks();
});

describe('anchoring (X07 §14.1)', () => {
  function addField(rect: Partial<DOMRect>) {
    const field = document.createElement('button');
    field.setAttribute('data-palette-anchor', '');
    field.getBoundingClientRect = () => ({ left: 0, top: 0, right: 0, bottom: 0, width: 0, height: 0, x: 0, y: 0, ...rect }) as DOMRect;
    document.body.append(field);
  }

  it('opens with its top edge under the title-bar field, centred on it', () => {
    vi.spyOn(window, 'innerWidth', 'get').mockReturnValue(1600);
    addField({ left: 700, width: 320, bottom: 33, height: 26 });
    mount();
    open();
    expect(dialog().style.position).toBe('fixed');
    expect(dialog().style.top).toBe('37px');
    expect(dialog().style.left).toBe(`${700 + 160 - 320}px`);
  });

  it('follows the field when the window is resized while it is open', () => {
    const width = vi.spyOn(window, 'innerWidth', 'get').mockReturnValue(1600);
    addField({ left: 700, width: 320, bottom: 33, height: 26 });
    mount();
    open();
    expect(dialog().style.left).toBe('540px');
    width.mockReturnValue(1200);
    const field = document.querySelector('[data-palette-anchor]') as HTMLElement;
    field.getBoundingClientRect = () => ({ left: 300, top: 0, right: 620, bottom: 33, width: 320, height: 26, x: 300, y: 0 }) as DOMRect;
    act(() => {
      window.dispatchEvent(new Event('resize'));
    });
    expect(dialog().style.left).toBe('140px');
  });

  it('opens centred when no field is drawn', () => {
    mount();
    open();
    expect(dialog().style.position).not.toBe('fixed');
    expect(dialog().style.top).toBe('');
  });

  it('opens centred when the window is too narrow for it', () => {
    vi.spyOn(window, 'innerWidth', 'get').mockReturnValue(600);
    addField({ left: 100, width: 320, bottom: 33, height: 26 });
    mount();
    open();
    expect(dialog().style.position).not.toBe('fixed');
  });
});

describe('collections in this connection (X07 §14.2)', () => {
  it('lists five, then Show more, which opens the Collections scope with all of them', () => {
    publishPaletteCollections({ connectionId: 'c1', pending: false });
    mount();
    open();
    const group = groupNamed('Collections in this connection');
    expect(titles(group)).toEqual(['shop.a', 'shop.b', 'shop.c', 'shop.d', 'shop.e', 'Show 2 more collections']);
    fireEvent.click(within(group).getByText('Show 2 more collections'));
    expect(titles(dialog()).filter((t) => t.startsWith('shop.'))).toEqual(NAMES.map((n) => `shop.${n}`));
    expect(within(dialog()).queryByText('shop.zz')).toBeNull();
  });

  it('has no such group with no Open Connection', () => {
    mount();
    open();
    expect(within(dialog()).queryByText('Collections in this connection')).toBeNull();
  });

  it('follows the Connection the workspace names', () => {
    publishPaletteCollections({ connectionId: 'c2', pending: false });
    mount();
    open();
    expect(titles(groupNamed('Collections in this connection'))).toEqual(['shop.zz']);
  });
});

describe('the cursor when the list changes under it', () => {
  const second: Command = { ...ok, id: 'ok2', title: 'Open preferences' };
  const cursorTitle = () =>
    within(dialog())
      .getAllByRole('option')
      .find((o) => o.getAttribute('aria-selected') === 'true')
      ?.querySelector('[data-title]')
      ?.getAttribute('data-title');

  it('stays on the row the keys put it on when the collections group arrives above', () => {
    mount([ok, second]);
    open();
    fireEvent.keyDown(screen.getByLabelText('Search commands'), { key: 'ArrowDown' });
    expect(cursorTitle()).toBe('Open preferences');
    act(() => publishPaletteCollections({ connectionId: 'c1', pending: false }));
    expect(within(dialog()).getByText('Collections in this connection')).toBeTruthy();
    expect(cursorTitle()).toBe('Open preferences');
  });

  it('stays on the row the pointer put it on', () => {
    mount([ok, second]);
    open();
    const row = within(dialog()).getAllByRole('option').find((o) => o.textContent?.includes('Open preferences'))!;
    fireEvent.mouseEnter(row);
    act(() => publishPaletteCollections({ connectionId: 'c1', pending: false }));
    expect(cursorTitle()).toBe('Open preferences');
  });

  it('follows the first available row while untouched', () => {
    mount([ok, second]);
    open();
    expect(cursorTitle()).toBe('Open settings');
    act(() => publishPaletteCollections({ connectionId: 'c1', pending: false }));
    // The collections group is now first: the untouched cursor is on its first row.
    expect(cursorTitle()).toBe('shop.a');
  });
});

describe('unavailable rows (X07 §14.3)', () => {
  it('starts the cursor on the first available row, and Arrow keys still reach the greyed one', () => {
    mount([off, ok], []);
    open();
    const selected = () => within(dialog()).getAllByRole('option').filter((o) => o.getAttribute('aria-selected') === 'true');
    expect(selected().map((o) => o.querySelector('[data-title]')?.getAttribute('data-title'))).toEqual(['Open settings']);
    const input = screen.getByLabelText('Search commands');
    fireEvent.keyDown(input, { key: 'ArrowUp' });
    expect(selected().map((o) => o.getAttribute('aria-disabled'))).toEqual(['true']);
  });

  it('lists the greyed row after the available ones of its group', () => {
    const second: Command = { ...ok, id: 'ok2', title: 'Open preferences', group: 'query' };
    mount([off, second], []);
    open();
    expect(titles(groupNamed('Query'))).toEqual(['Open preferences', 'Explain query']);
  });

  it('starts on no row when every row is greyed; the keys still reach them, Enter does nothing', () => {
    const run = vi.fn();
    mount([{ ...off, perform: run }], []);
    open();
    const selected = () => within(dialog()).queryAllByRole('option').filter((o) => o.getAttribute('aria-selected') === 'true');
    const input = screen.getByLabelText('Search commands');
    expect(selected()).toHaveLength(0);
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(run).not.toHaveBeenCalled();
    expect(screen.queryByRole('dialog')).not.toBeNull();
    fireEvent.keyDown(input, { key: 'ArrowUp' });
    expect(selected().map((o) => o.getAttribute('aria-disabled'))).toEqual(['true']);
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(run).not.toHaveBeenCalled();
  });
});

describe('the empty state (X07 §14.5)', () => {
  it('is announced from a live region that exists before it has text', () => {
    mount([ok], []);
    open();
    const region = within(dialog()).getByRole('status');
    expect(region.textContent).toBe('');
    fireEvent.change(screen.getByLabelText('Search commands'), { target: { value: 'zzzz-nothing' } });
    // The same node, now with the text.
    expect(within(dialog()).getByRole('status')).toBe(region);
    expect(region.textContent).toBe('No matches for "zzzz-nothing"');
    fireEvent.change(screen.getByLabelText('Search commands'), { target: { value: '' } });
    expect(region.textContent).toBe('');
  });
});

describe('row icons (X07 §14.4)', () => {
  it('draws a command glyph, never a chevron, in front of a command', () => {
    mount();
    open();
    const row = within(dialog()).getAllByRole('option').find((o) => o.getAttribute('data-kind') === 'action')!;
    const paths = Array.from(row.querySelectorAll('svg path')).map((p) => p.getAttribute('d'));
    expect(paths.length).toBeGreaterThan(0);
    expect(paths).not.toContain('M9 18l6-6-6-6');
  });

  it('keeps its own icon on every kind', () => {
    publishPaletteCollections({ connectionId: 'c1', pending: false });
    mount();
    open();
    const row = within(dialog()).getAllByRole('option').find((o) => o.getAttribute('data-kind') === 'collection')!;
    expect(row.querySelector('svg rect')).not.toBeNull();
  });
});
