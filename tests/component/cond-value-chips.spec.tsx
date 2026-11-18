// $in / $nin chips: paste splits into chips, and a long list is capped with a
// count and a "Show all" button (jsdom has no layout, so the cap is by count).
import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, act } from '../helpers/render';
import { CondValueEditor } from '../../src/pages/Workspace/CondValueEditor';
import { printFilter } from '../../src/pages/Workspace/filterTree';
import type { CondNode, GroupNode } from '@shared/types';

function mount(values: string[], onPatch = vi.fn()) {
  const node: CondNode = { kind: 'cond', field: 'f', op: '$in', valType: 'string', value: JSON.stringify(values) };
  render(
    <CondValueEditor
      node={node}
      readOnly={false}
      problem={undefined}
      onPatch={onPatch}
      onTypeChange={vi.fn()}
      suggestionContext={null}
      wide
      dim={undefined}
    />,
  );
  return onPatch;
}

/** The row held in state, as the drawer holds it, so each patch comes back in as props. */
let latest: CondNode;
function Stateful({ initial }: { initial: string[] }) {
  const [node, setNode] = React.useState<CondNode>({
    kind: 'cond',
    field: 'f',
    op: '$in',
    valType: 'string',
    value: JSON.stringify(initial),
  });
  React.useEffect(() => {
    latest = node;
  }, [node]);
  return (
    <CondValueEditor
      node={node}
      readOnly={false}
      problem={undefined}
      onPatch={(p) => setNode((n) => ({ ...n, ...p }))}
      onTypeChange={vi.fn()}
      suggestionContext={null}
      wide
      dim={undefined}
    />
  );
}

const printed = (): string => {
  const root: GroupNode = { kind: 'group', logic: '$and', children: [latest] };
  const out = printFilter(root);
  if (!out.ok) throw new Error('row did not print');
  return out.json;
};

const valuesInput = () => document.querySelector<HTMLInputElement>('input[aria-label="Values"]')!;

const many = (n: number) => Array.from({ length: n }, (_, i) => `v${i}`);

describe('list chips', () => {
  it('splits pasted text on comma, newline and tab into chips', () => {
    const onPatch = mount(['a']);
    fireEvent.paste(valuesInput(), {
      clipboardData: { getData: () => 'b,c\nd\te\n' },
    });
    expect(onPatch).toHaveBeenCalledTimes(1);
    expect(JSON.parse(onPatch.mock.calls[0][0].value)).toEqual(['a', 'b', 'c', 'd', 'e']);
  });

  it('prints the same filter after a paste as after typing the same values one by one', () => {
    const { unmount } = render(<Stateful initial={['a']} />);
    fireEvent.paste(valuesInput(), { clipboardData: { getData: () => 'b,c\nd\te\n' } });
    const afterPaste = printed();
    unmount();

    render(<Stateful initial={['a']} />);
    // Mantine drops a change to an unfocused combobox input as autofill.
    act(() => valuesInput().focus());
    for (const v of ['b', 'c', 'd', 'e']) {
      fireEvent.change(valuesInput(), { target: { value: v } });
      fireEvent.keyDown(valuesInput(), { key: 'Enter' });
    }
    expect(printed()).toBe(afterPaste);
    expect(afterPaste).toBe('{"f":{"$in":["a","b","c","d","e"]}}');
  });

  it('skips pasted values the list already holds', () => {
    const onPatch = mount(['a']);
    fireEvent.paste(valuesInput(), {
      clipboardData: { getData: () => 'a,b,b' },
    });
    expect(JSON.parse(onPatch.mock.calls[0][0].value)).toEqual(['a', 'b']);
  });

  it('shows no footer for a short list', () => {
    mount(many(9));
    expect(screen.queryByRole('button', { name: 'Show all' })).toBeNull();
  });

  it('shows the count and Show all once the list passes three lines', () => {
    mount(many(10));
    expect(screen.getByText(/10 values/)).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Show all' })).toBeTruthy();
  });

  it('Show all expands to the editing cap and can collapse again', () => {
    mount(many(12));
    const cap = () =>
      [...document.querySelectorAll<HTMLElement>('[data-value-box] *')].find((el) => el.style.maxHeight !== '')?.style
        .maxHeight;
    expect(cap()).toBe('84px');
    fireEvent.click(screen.getByRole('button', { name: 'Show all' }));
    expect(cap()).toBe('224px');
    expect(screen.getByRole('button', { name: 'Show fewer' })).toBeTruthy();
  });

  it('focusing the box raises the cap to eight lines without the Show all button', () => {
    mount(many(12));
    const cap = () =>
      [...document.querySelectorAll<HTMLElement>('[data-value-box] *')].find((el) => el.style.maxHeight !== '')?.style
        .maxHeight;
    expect(cap()).toBe('84px');
    fireEvent.focus(valuesInput());
    expect(cap()).toBe('224px');
    expect(screen.queryByRole('button', { name: 'Show all' })).toBeNull();
    expect(screen.getByText(/12 values/)).toBeTruthy();
  });

  it('writes the footer as the count, a dot and the button', () => {
    mount(many(10));
    expect(screen.getByText(/10 values/).textContent).toContain('·');
    expect(screen.getByText(/10 values/).textContent).toContain('Show all');
  });
});


describe('a list switching to its JSON text', () => {
  it('observes the textarea that appears, though the value did not change', () => {
    const observed: Element[] = [];
    class SpyObserver {
      observe(el: Element) {
        observed.push(el);
      }
      disconnect() {}
      unobserve() {}
    }
    vi.stubGlobal('ResizeObserver', SpyObserver);
    mount(['a', 'b']);
    expect(observed.some((el) => el.tagName === 'TEXTAREA')).toBe(false);
    fireEvent.click(screen.getByRole('button', { name: 'Edit as JSON' }));
    expect(observed.some((el) => el.tagName === 'TEXTAREA')).toBe(true);
    vi.unstubAllGlobals();
  });
});

describe('a value box returning from a switch row', () => {
  it('observes the textarea again after $exists and back, with the value unchanged', () => {
    const observed: Element[] = [];
    class SpyObserver {
      observe(el: Element) {
        observed.push(el);
      }
      disconnect() {}
      unobserve() {}
    }
    vi.stubGlobal('ResizeObserver', SpyObserver);
    const base: CondNode = { kind: 'cond', field: 'f', op: '$eq', valType: 'string', value: 'a long value' };
    const props = {
      readOnly: false,
      problem: undefined,
      onPatch: vi.fn(),
      onTypeChange: vi.fn(),
      suggestionContext: null,
      wide: true,
      dim: undefined,
    };
    const { rerender } = render(<CondValueEditor node={base} {...props} />);
    const first = observed.filter((el) => el.tagName === 'TEXTAREA').length;
    expect(first).toBeGreaterThan(0);
    rerender(<CondValueEditor node={{ ...base, op: '$exists' }} {...props} />);
    rerender(<CondValueEditor node={base} {...props} />);
    expect(observed.filter((el) => el.tagName === 'TEXTAREA').length).toBeGreaterThan(first);
    vi.unstubAllGlobals();
  });
});
