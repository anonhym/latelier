import { describe, it, expect, afterEach, vi } from 'vitest';
import * as React from 'react';
import { render, act } from '@testing-library/react';
import { useGrowToLines } from '../../src/pages/Workspace/useGrowToLines';

type Callback = () => void;
const observers: Array<{ cb: Callback; disconnect: ReturnType<typeof vi.fn> }> = [];

class FakeResizeObserver {
  disconnect = vi.fn();
  constructor(cb: Callback) {
    observers.push({ cb, disconnect: this.disconnect });
  }
  observe(): void {}
  unobserve(): void {}
}

function Box({ text }: { text: string }) {
  const ref = React.useRef<HTMLTextAreaElement>(null);
  useGrowToLines(ref, text, 4);
  return <textarea ref={ref} defaultValue={text} />;
}

afterEach(() => {
  observers.length = 0;
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('useGrowToLines', () => {
  it('sizes the box again when its width changes, and stops observing on unmount', () => {
    vi.stubGlobal('ResizeObserver', FakeResizeObserver);
    let width = 300;
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(
      () => ({ width }) as DOMRect,
    );
    vi.spyOn(window, 'getComputedStyle').mockReturnValue({
      lineHeight: '20px',
      paddingTop: '4px',
      paddingBottom: '4px',
    } as CSSStyleDeclaration);
    let scrollHeight = 28;
    vi.spyOn(HTMLElement.prototype, 'scrollHeight', 'get').mockImplementation(() => scrollHeight);

    const { container, unmount } = render(<Box text="long text" />);
    const el = container.querySelector('textarea')!;
    expect(el.style.height).toBe('28px');
    expect(observers).toHaveLength(1);

    // A resize that leaves the width alone (the box's own height change) is ignored.
    scrollHeight = 52;
    act(() => observers[0].cb());
    expect(el.style.height).toBe('28px');

    // A narrower box wraps to more lines.
    width = 200;
    act(() => observers[0].cb());
    expect(el.style.height).toBe('52px');

    unmount();
    expect(observers[0].disconnect).toHaveBeenCalled();
  });

  it('renders without a ResizeObserver', () => {
    vi.stubGlobal('ResizeObserver', undefined);
    const { container } = render(<Box text="x" />);
    expect(container.querySelector('textarea')).not.toBeNull();
  });
});
