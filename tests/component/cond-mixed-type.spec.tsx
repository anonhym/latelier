// A field that holds two kinds (board "a field with two types"): the chip shows
// the split, the menu lists the kinds sampled, a typed value says what it
// skips, and "Match either" turns the row into a `$in` over both kinds. The
// editor is mounted under a wrapper that keeps the row in state, so each patch
// comes back in as props the way the drawer does it.
import React from 'react';
import { describe, it, expect } from 'vitest';
import { render, screen, fireEvent } from '../helpers/render';
import { CondValueEditor } from '../../src/pages/Workspace/CondValueEditor';
import { parseFilter, printFilter } from '../../src/pages/Workspace/filterTree';
import type { CondNode, GroupNode, SchemaSampleEntry } from '@shared/types';

const entry = (types: Record<string, number>): SchemaSampleEntry => ({ path: 'zip', frequency: 1, types });

const ZIP = entry({ string: 62, number: 38 });

/** The row as the wrapper last held it. */
let latest: CondNode;
const remember = (n: CondNode) => {
  latest = n;
};

function Harness({ initial, sample }: { initial: Partial<CondNode>; sample: SchemaSampleEntry | undefined }) {
  const [node, setNode] = React.useState<CondNode>({
    kind: 'cond',
    field: 'zip',
    op: '$eq',
    valType: 'string',
    value: '',
    ...initial,
  });
  React.useEffect(() => remember(node), [node]);
  return (
    <CondValueEditor
      node={node}
      readOnly={false}
      problem={undefined}
      onPatch={(p) => setNode((n) => ({ ...n, ...p }))}
      onTypeChange={(valType) => setNode((n) => ({ ...n, valType }))}
      suggestionContext={null}
      wide
      dim={undefined}
      sampleEntry={sample}
    />
  );
}

/** `null` is a field the sample does not hold. */
function mount(initial: Partial<CondNode>, sample: SchemaSampleEntry | null = ZIP) {
  return render(<Harness initial={initial} sample={sample ?? undefined} />);
}

function chipButton(): HTMLElement {
  return screen.getByRole('button', { name: /^Value type: / });
}

describe('mixed field: the chip', () => {
  it('shows a two-colour dot when no type holds 90% of the sample', () => {
    const { container } = mount({ value: '75001' });
    const dot = container.querySelector<HTMLElement>('[data-type-split-dot]');
    expect(dot).not.toBeNull();
    // The dot is the top type's colour, then the second's: string green, number blue.
    expect(dot!.getAttribute('data-colors')).toBe('#1b6e20 #1565c0');
    expect(chipButton().textContent).toBe('string');
  });

  it('never paints both halves of the dot one colour, whatever two types the field holds', () => {
    const types = ['string', 'number', 'date', 'objectid', 'boolean', 'array', 'null', 'object'];
    const seen: string[] = [];
    for (const first of types) {
      for (const second of types) {
        if (first === second) continue;
        const { container, unmount } = mount({ value: '1' }, entry({ [first]: 55, [second]: 45 }));
        const colors = container.querySelector<HTMLElement>('[data-type-split-dot]')!.getAttribute('data-colors')!.split(' ');
        seen.push(colors.join('|'));
        expect(colors).toHaveLength(2);
        expect(colors[0]).not.toBe(colors[1]);
        unmount();
      }
    }
    expect(seen).toHaveLength(types.length * (types.length - 1));
  });

  it('shows no dot once one type holds 90%, or when the field has one type or was not sampled', () => {
    const dominant = mount({ value: '1' }, entry({ string: 90, number: 10 }));
    expect(dominant.container.querySelector('[data-type-split-dot]')).toBeNull();
    dominant.unmount();
    const single = mount({ value: '1' }, entry({ string: 100 }));
    expect(single.container.querySelector('[data-type-split-dot]')).toBeNull();
    single.unmount();
    const none = mount({ value: '1' }, null);
    expect(none.container.querySelector('[data-type-split-dot]')).toBeNull();
  });
});

describe('mixed field: the chip menu', () => {
  it('lists the sampled types with their share, then either, then the other types dimmed', async () => {
    mount({ value: '75001' });
    fireEvent.click(chipButton());
    const items = (await screen.findAllByRole('menuitem')).map((el) => el.textContent);
    expect(items.slice(0, 3)).toEqual(['string62% of sample', 'number38% of sample', 'either (string or number)']);
    expect(items.slice(3)).toEqual(['long', 'decimal', 'boolean', 'date', 'null', 'regex', 'objectid', 'array']);
    const dimmed = screen.getAllByRole('menuitem').filter((el) => el.hasAttribute('data-dimmed'));
    expect(dimmed).toHaveLength(8);
    // The divider sits between the sampled types and the rest, before "either".
    const dropdown = screen.getByRole('menu');
    expect(dropdown.querySelectorAll('[class*="Menu-divider"]')).toHaveLength(1);
  });

  it('leaves either out when the value is empty or only one type can hold it', async () => {
    mount({ value: 'abc' });
    fireEvent.click(chipButton());
    await screen.findAllByRole('menuitem');
    expect(screen.queryByRole('menuitem', { name: /^either/ })).toBeNull();
  });

  it('picking a sampled type changes the row type', async () => {
    mount({ value: '75001' });
    fireEvent.click(chipButton());
    fireEvent.click(await screen.findByRole('menuitem', { name: /^number/ }));
    expect(latest.valType).toBe('number');
  });

  it('keeps the plain menu for a field with one type', async () => {
    mount({ value: '1' }, entry({ string: 100 }));
    fireEvent.click(chipButton());
    const items = (await screen.findAllByRole('menuitem')).map((el) => el.textContent);
    expect(items).toEqual(['string', 'number', 'long', 'decimal', 'boolean', 'date', 'null', 'regex', 'objectid', 'array']);
  });
});

describe('mixed field: the typed value', () => {
  it('says what share it skips and offers Match either as a button', () => {
    mount({ value: '75001' });
    const note = screen.getByRole('status');
    expect(note.textContent).toContain('Skips the 38% that store zip as a number');
    expect(note.textContent).toContain('· Match either');
    expect(screen.getByRole('button', { name: 'Match either' })).toBeTruthy();
  });

  it('Match either makes the row a $in with a chip per type, and the chip reads either', () => {
    mount({ value: '75001' });
    fireEvent.click(screen.getByRole('button', { name: 'Match either' }));
    expect(latest.op).toBe('$in');
    expect(latest.value).toBe('["75001",75001]');
    expect(chipButton().getAttribute('aria-label')).toBe('Value type: either');
    // The two chips, text first.
    expect(screen.getByText('"75001"')).toBeTruthy();
    expect(screen.getByText('75001')).toBeTruthy();
  });

  it('the either row prints as a filter the filter bar reads back as the same row', () => {
    mount({ value: '75001' });
    fireEvent.click(screen.getByRole('button', { name: 'Match either' }));
    const root: GroupNode = { kind: 'group', logic: '$and', children: [latest] };
    const printed = printFilter(root);
    expect(printed.ok).toBe(true);
    if (!printed.ok) return;
    expect(printed.json).toBe('{"zip":{"$in":["75001",75001]}}');
    const parsed = parseFilter(printed.json);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    const row = parsed.root.children[0] as CondNode;
    expect(row.op).toBe('$in');
    expect(row.value).toBe('["75001",75001]');
  });

  it('the either entry in the chip menu does the same', async () => {
    mount({ value: '75001' });
    fireEvent.click(chipButton());
    fireEvent.click(await screen.findByRole('menuitem', { name: 'either (string or number)' }));
    expect(latest.op).toBe('$in');
    expect(latest.value).toBe('["75001",75001]');
  });

  it('drops the offer for a value only one type can hold and says why', () => {
    mount({ value: 'abc' });
    // Plain text, with no action to announce.
    expect(screen.getByText('Not a number, so only string values can match.')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Match either' })).toBeNull();
  });

  it.each(['$ne', '$gt'] as const)('%s gets the plain mixed chip, with no hint and no Match either', async (op) => {
    mount({ value: '75001', op });
    expect(screen.queryByText(/Skips the/)).toBeNull();
    expect(screen.queryByRole('button', { name: 'Match either' })).toBeNull();
    expect(document.querySelector('[data-type-split-dot]')).not.toBeNull();
    fireEvent.click(chipButton());
    const items = (await screen.findAllByRole('menuitem')).map((el) => el.textContent);
    expect(items.slice(0, 2)).toEqual(['string62% of sample', 'number38% of sample']);
    expect(items.some((t) => t?.startsWith('either ('))).toBe(false);
  });

  it('$eq still offers both', () => {
    mount({ value: '75001', op: '$eq' });
    expect(screen.getByRole('button', { name: 'Match either' })).toBeTruthy();
  });

  it('says nothing about the split for an empty box', () => {
    mount({ value: '' });
    expect(screen.queryByText(/Skips the/)).toBeNull();
    expect(screen.queryByText(/so only text/)).toBeNull();
  });
});

describe('a sampled type with no editor', () => {
  it('uses the text box, names the type on the chip, and says it compares as text', () => {
    mount({ value: 'x' }, entry({ binary: 10 }));
    expect(screen.getByRole('textbox').tagName).toBe('TEXTAREA');
    expect(chipButton().getAttribute('aria-label')).toBe('Value type: binary');
    expect(screen.getByText(
      'No editor for binary data: what you type is compared as text. Use a raw clause for $binary.',
    )).toBeTruthy();
  });

  it('keeps the row type once the person picks one', async () => {
    mount({ value: '1' }, entry({ binary: 10 }));
    fireEvent.click(chipButton());
    fireEvent.click(await screen.findByRole('menuitem', { name: 'number' }));
    expect(latest.valType).toBe('number');
    expect(screen.queryByText(/No editor for/)).toBeNull();
  });
});

describe('a field that was not sampled', () => {
  it('is a plain string box with no helper line', () => {
    const { container } = mount({ value: '75001' }, null);
    expect(screen.getByRole('textbox').tagName).toBe('TEXTAREA');
    expect(chipButton().textContent).toBe('string');
    expect(container.querySelectorAll('[data-value-box] ~ div')).toHaveLength(0);
  });
});
