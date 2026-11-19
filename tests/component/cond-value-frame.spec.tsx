// Every value box shares one frame: the type chip at its right end, the error
// colour on its border, and one helper line under it that shows the problem
// before anything else.
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '../helpers/render';
import { CondValueEditor } from '../../src/pages/Workspace/CondValueEditor';
import { themeVars } from '../../src/theme/themeVars';
import type { CondNode, ValType } from '@shared/types';

const BOX_TYPES: ValType[] = ['string', 'number', 'long', 'decimal', 'date', 'regex', 'objectid', 'array'];

function mount(node: Partial<CondNode>, problem?: string) {
  const full: CondNode = { kind: 'cond', field: 'f', op: '$eq', valType: 'string', value: '', ...node };
  return render(
    <CondValueEditor
      node={full}
      readOnly={false}
      problem={problem}
      onPatch={vi.fn()}
      onTypeChange={vi.fn()}
      suggestionContext={null}
      wide
      dim={undefined}
    />,
  );
}

function boxOf(container: HTMLElement): HTMLElement {
  const box = container.querySelector<HTMLElement>('[data-value-box]');
  if (!box) throw new Error('no value box rendered');
  return box;
}

describe('value box frame, every type', () => {
  it.each(BOX_TYPES)('%s: type chip is the last item in the box', (valType) => {
    const { container } = mount({ valType, value: '1' });
    const chip = screen.getByRole('button', { name: `Value type: ${valType}` });
    const box = boxOf(container);
    expect(box.contains(chip)).toBe(true);
    expect(box.lastElementChild?.contains(chip)).toBe(true);
  });

  it.each(BOX_TYPES)('%s: a problem turns the border red and shows as the one line under the box', (valType) => {
    const { container } = mount({ valType, value: 'x' }, 'Not a valid value');
    const box = boxOf(container);
    expect(box.style.border).toContain(themeVars.red);
    const note = screen.getByText('Not a valid value');
    expect(box.contains(note)).toBe(false);
    expect(note.style.color).toBe(themeVars.redText);
    expect(screen.getByRole('textbox').getAttribute('aria-describedby')).toBe(note.id);
  });

  it.each(BOX_TYPES)('%s: without a problem the border is neutral and no error is shown', (valType) => {
    const { container } = mount({ valType, value: '1' });
    expect(boxOf(container).style.border).not.toContain(themeVars.red);
    expect(screen.getByRole('textbox').hasAttribute('aria-invalid')).toBe(false);
  });

  it.each(['boolean', 'null'] as const)('%s has no box to frame', (valType) => {
    const { container } = mount({ valType });
    expect(container.querySelector('[data-value-box]')).toBeNull();
  });
});

describe('value box helper line', () => {
  it('shows the parsed date preview when nothing is wrong', () => {
    mount({ valType: 'date', value: '2026-04-01' });
    expect(screen.getByText('ISODate("2026-04-01")').textContent).toBe('ISODate("2026-04-01")');
  });

  it('shows the problem instead of the date preview, never both', () => {
    mount({ valType: 'date', value: 'nope' }, 'Not a date');
    expect(screen.getByText('Not a date').textContent).toBe('Not a date');
    expect(screen.queryByText(/ISODate/)).toBeNull();
  });

  it('shows no line for a plain valid string', () => {
    const { container } = mount({ valType: 'string', value: 'abc' });
    expect(container.querySelectorAll('[data-value-box] ~ div')).toHaveLength(0);
  });
});

describe('text value box', () => {
  it('is a textarea that starts at one row and does not take Enter as a new line', () => {
    mount({ valType: 'string', value: 'a long value' });
    const input = screen.getByRole('textbox');
    expect(input.tagName).toBe('TEXTAREA');
    expect(input.getAttribute('rows')).toBe('1');
    // fireEvent returns false when the handler called preventDefault.
    expect(fireEvent.keyDown(input, { key: 'Enter' })).toBe(false);
  });
});

describe('pasted line breaks', () => {
  function mountWithSpy(node: Partial<CondNode>) {
    const onPatch = vi.fn();
    const full: CondNode = { kind: 'cond', field: 'f', op: '$eq', valType: 'string', value: '', ...node };
    render(
      <CondValueEditor
        node={full}
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

  it('turns each run of line breaks into one space', () => {
    const onPatch = mountWithSpy({ valType: 'string' });
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'a\r\n\nb\nc' } });
    expect(onPatch).toHaveBeenCalledWith({ value: 'a b c' }, 'value');
  });

  it('drops line breaks at the end instead of leaving a trailing space, and keeps the inner ones as spaces', () => {
    const onPatch = mountWithSpy({ valType: 'string' });
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'abc\n' } });
    expect(onPatch).toHaveBeenLastCalledWith({ value: 'abc' }, 'value');
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'a\r\nb\r\n' } });
    expect(onPatch).toHaveBeenLastCalledWith({ value: 'a b' }, 'value');
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'abc\n\n' } });
    expect(onPatch).toHaveBeenLastCalledWith({ value: 'abc' }, 'value');
  });

  it('leaves single-line text untouched', () => {
    const onPatch = mountWithSpy({ valType: 'string' });
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'plain text' } });
    expect(onPatch).toHaveBeenCalledWith({ value: 'plain text' }, 'value');
  });
});

describe('number and date boxes', () => {
  it.each(['number', 'long', 'decimal'] as const)('%s: a numeric keypad, no helper line, no date picker', (valType) => {
    const { container } = mount({ valType, value: '42' });
    expect(screen.getByRole('textbox').getAttribute('inputmode')).toBe('decimal');
    expect(container.querySelectorAll('[data-value-box] ~ div')).toHaveLength(0);
    expect(screen.queryByRole('button', { name: 'Pick date' })).toBeNull();
  });

  it('a string box has no numeric keypad', () => {
    mount({ valType: 'string', value: '42' });
    expect(screen.getByRole('textbox').hasAttribute('inputmode')).toBe(false);
  });

  it('date: the parsed preview is the one line under the box and the picker sits in the box', () => {
    const { container } = mount({ valType: 'date', value: '2026-04-01T10:00:00Z' });
    const preview = screen.getByText('ISODate("2026-04-01T10:00:00Z")');
    expect(boxOf(container).contains(preview)).toBe(false);
    expect(boxOf(container).contains(screen.getByRole('button', { name: 'Pick date' }))).toBe(true);
  });

  it('date: an empty box has no preview', () => {
    mount({ valType: 'date', value: '' });
    expect(screen.queryByText(/ISODate/)).toBeNull();
  });
});

describe('ObjectId box helper line', () => {
  const HEX = '507f1f77bcf86cd799439011';
  const DATE_LINE = /^created 2012-10-1[78] \d{2}:\d{2}:\d{2} \S+$/;

  it('shows the hex whole in the box and the date it carries under it', () => {
    const { container } = mount({ valType: 'objectid', value: HEX });
    expect((screen.getByRole('textbox') as HTMLTextAreaElement).value).toBe(HEX);
    const line = screen.getByText(DATE_LINE);
    expect(boxOf(container).contains(line)).toBe(false);
  });

  it('shows no date while the hex is incomplete', () => {
    mount({ valType: 'objectid', value: HEX.slice(0, 23) });
    expect(screen.queryByText(DATE_LINE)).toBeNull();
  });

  it('shows no date for a list operator, which has chips', () => {
    mount({ valType: 'objectid', op: '$in', value: `["${HEX}"]` });
    expect(screen.queryByText(DATE_LINE)).toBeNull();
  });

  it('an error beats the date', () => {
    mount({ valType: 'objectid', value: HEX }, 'Not a valid ObjectId');
    expect(screen.getByText('Not a valid ObjectId').textContent).toBe('Not a valid ObjectId');
    expect(screen.queryByText(DATE_LINE)).toBeNull();
  });
});
