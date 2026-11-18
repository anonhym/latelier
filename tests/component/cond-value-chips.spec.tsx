// $in / $nin chips: paste splits into chips, and a long list is capped with a
// count and a "Show all" button (jsdom has no layout, so the cap is by count).
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '../helpers/render';
import { CondValueEditor } from '../../src/pages/Workspace/CondValueEditor';
import type { CondNode } from '@shared/types';

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
});
