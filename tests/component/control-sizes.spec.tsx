import { describe, expect, it } from 'vitest';
import { Button, SegmentedControl, Select, TextInput } from '@mantine/core';
import { render, screen } from '../helpers/render';

/**
 * One density, set once in the theme. These read the CSS variables Mantine writes
 * inline, which is what jsdom can see; the sizes are measured in the app by
 * tests/e2e/results-toolbar-no-clip.e2e.ts.
 */
describe('theme control sizes', () => {
  const buttonVar = (name: string, v: string) =>
    (screen.getByRole('button', { name }) as HTMLElement).style.getPropertyValue(v);

  it('compact buttons are 26 px with 13 px labels', () => {
    render(
      <>
        <Button size="compact-xs">a</Button>
        <Button size="compact-sm">b</Button>
      </>,
    );
    for (const name of ['a', 'b']) {
      expect(buttonVar(name, '--button-height')).toBe('26px');
      expect(buttonVar(name, '--button-fz')).toBe('13px');
    }
  });

  it('regular buttons are 36 px with 13 px labels', () => {
    render(
      <>
        <Button size="xs">a</Button>
        <Button>b</Button>
      </>,
    );
    expect(buttonVar('a', '--button-height')).toBe('36px');
    expect(buttonVar('a', '--button-fz')).toBe('13px');
    // The default size is already 36 px tall; only its label needs the override.
    expect(buttonVar('b', '--button-fz')).toBe('13px');
  });

  it('an explicit size the theme does not list is left alone', () => {
    render(<Button size="lg">a</Button>);
    expect(buttonVar('a', '--button-fz')).not.toBe('13px');
  });

  it('inputs of every kind reach 36 px with 13 px text through the one Input entry', () => {
    const { container } = render(
      <>
        <TextInput size="xs" aria-label="text" />
        <Select size="xs" aria-label="select" data={['x']} />
        <TextInput aria-label="plain" />
      </>,
    );
    const wrapperOf = (label: string) =>
      container.querySelector(`input[aria-label="${label}"]`)!.closest('.mantine-Input-wrapper') as HTMLElement;
    for (const label of ['text', 'select']) {
      expect(wrapperOf(label).style.getPropertyValue('--input-height')).toBe('36px');
      expect(wrapperOf(label).style.getPropertyValue('--input-fz')).toBe('13px');
    }
    expect(wrapperOf('plain').style.getPropertyValue('--input-fz')).toBe('13px');
  });

  it('the small segmented control lines up with a compact button', () => {
    const { container } = render(<SegmentedControl size="xs" data={['Tree', 'JSON']} />);
    const root = container.querySelector('.mantine-SegmentedControl-root') as HTMLElement;
    expect(root.style.getPropertyValue('--sc-font-size')).toBe('13px');
    expect(root.style.getPropertyValue('--sc-padding')).toBe('1px 8px');
    expect(root.style.padding).toBe('2px');
  });
});
