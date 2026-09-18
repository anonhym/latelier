import { useState } from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '../helpers/render';
import userEvent from '@testing-library/user-event';
import { ResizeHandle } from '../../src/pages/Workspace/ResizeHandle';

/**
 * The reference drawer put `ResizeHandle`'s `edge="right"` branch into service for the first
 * time — the reference drawer sits to the *right* of its handle, where the
 * navigator sits to the left of its own. Until now every call site was
 * `edge="left"`, so the inverted-delta branch
 * (`edge === 'left' || edge === 'bottom' ? deltaPx : -deltaPx`) was dead code
 * and the component had no tests at all.
 *
 * A backwards sign is the failure that matters here: the drawer would grow
 * when dragged away from and shrink when dragged toward, which typechecks,
 * lints, and renders perfectly.
 */
function drag(handle: HTMLElement, from: number, to: number) {
  fireEvent.mouseDown(handle, { clientX: from, clientY: from });
  fireEvent.mouseMove(window, { clientX: to, clientY: to });
  fireEvent.mouseUp(window, { clientX: to, clientY: to });
}

describe('ResizeHandle edges', () => {
  it('shrinks a right-edge panel when dragged right, and grows it when dragged left', () => {
    const onChange = vi.fn();
    render(
      <ResizeHandle
        edge="right"
        value={380}
        min={160}
        max={560}
        onChange={onChange}
        ariaLabel="Resize reference drawer"
      />,
    );
    const handle = screen.getByRole('separator', { name: 'Resize reference drawer' });

    // Dragging right moves the handle toward the panel, so the panel shrinks.
    drag(handle, 500, 560);
    expect(onChange).toHaveBeenLastCalledWith(320);

    // And away from it grows the panel. This is the assertion that fails if
    // `right` is treated like `left`.
    drag(handle, 500, 440);
    expect(onChange).toHaveBeenLastCalledWith(440);
  });

  it('grows a left-edge panel when dragged right — the navigator, unchanged', () => {
    const onChange = vi.fn();
    render(
      <ResizeHandle
        edge="left"
        value={206}
        min={160}
        max={560}
        onChange={onChange}
        ariaLabel="Resize navigator"
      />,
    );
    const handle = screen.getByRole('separator', { name: 'Resize navigator' });

    drag(handle, 300, 360);
    expect(onChange).toHaveBeenLastCalledWith(266);
  });

  it('clamps to min and max, and commits the clamped value rather than the raw one', () => {
    const onChange = vi.fn();
    const onCommit = vi.fn();
    render(
      <ResizeHandle
        edge="right"
        value={380}
        min={160}
        max={560}
        onChange={onChange}
        onCommit={onCommit}
        ariaLabel="Resize reference drawer"
      />,
    );
    const handle = screen.getByRole('separator', { name: 'Resize reference drawer' });

    // Far past min: 380 - 900 would be -520.
    drag(handle, 500, 1400);
    expect(onChange).toHaveBeenLastCalledWith(160);
    expect(onCommit).toHaveBeenLastCalledWith(160);

    // Far past max: 380 + 900 would be 1280. `onCommit` is what reaches
    // `api.prefs.set`, so an unclamped value here would persist a width the
    // handle itself refuses to produce, and survive a relaunch.
    drag(handle, 1400, 500);
    expect(onChange).toHaveBeenLastCalledWith(560);
    expect(onCommit).toHaveBeenLastCalledWith(560);
  });
});

/**
 * `value`/`onChange` are controlled — a bare `vi.fn()` spy proves a callback
 * fired, not that `aria-valuenow` moved. This wrapper feeds `onChange` back
 * into real state so the assertions below are on the rendered attribute,
 * the thing #56 says the old tests never checked.
 */
function ControlledResizeHandle({
  edge,
  initial,
  min,
  max,
  onCommit,
}: {
  edge: 'left' | 'right' | 'top' | 'bottom';
  initial: number;
  min: number;
  max: number;
  onCommit: (next: number) => void;
}) {
  const [value, setValue] = useState(initial);
  return (
    <ResizeHandle
      edge={edge}
      value={value}
      min={min}
      max={max}
      onChange={setValue}
      onCommit={onCommit}
      ariaLabel="Resize reference drawer"
    />
  );
}

describe('ResizeHandle keyboard resize (#56)', () => {
  it('is reachable by Tab alone', async () => {
    const user = userEvent.setup();
    render(<ControlledResizeHandle edge="right" initial={380} min={160} max={560} onCommit={vi.fn()} />);
    const handle = screen.getByRole('separator', { name: 'Resize reference drawer' });

    await user.tab();

    expect(document.activeElement).toBe(handle);
  });

  it('ArrowLeft/ArrowRight resize by the shared step and commit immediately, keeping focus', async () => {
    const user = userEvent.setup();
    const onCommit = vi.fn();
    render(<ControlledResizeHandle edge="right" initial={380} min={160} max={560} onCommit={onCommit} />);
    const handle = screen.getByRole('separator', { name: 'Resize reference drawer' });
    await user.tab();

    await user.keyboard('{ArrowLeft}');
    expect(handle.getAttribute('aria-valuenow')).toBe('370');
    expect(onCommit).toHaveBeenLastCalledWith(370);
    expect(document.activeElement).toBe(handle);

    await user.keyboard('{ArrowRight}{ArrowRight}');
    expect(handle.getAttribute('aria-valuenow')).toBe('390');
    expect(onCommit).toHaveBeenLastCalledWith(390);
    expect(document.activeElement).toBe(handle);
  });

  it('Home and End jump to the bounds and stay clamped and focused past them', async () => {
    const user = userEvent.setup();
    render(<ControlledResizeHandle edge="right" initial={380} min={160} max={560} onCommit={vi.fn()} />);
    const handle = screen.getByRole('separator', { name: 'Resize reference drawer' });
    await user.tab();

    await user.keyboard('{Home}');
    expect(handle.getAttribute('aria-valuenow')).toBe('160');
    // Past the bound: still clamped at min, not below it.
    await user.keyboard('{ArrowLeft}');
    expect(handle.getAttribute('aria-valuenow')).toBe('160');
    expect(document.activeElement).toBe(handle);

    await user.keyboard('{End}');
    expect(handle.getAttribute('aria-valuenow')).toBe('560');
    await user.keyboard('{ArrowRight}');
    expect(handle.getAttribute('aria-valuenow')).toBe('560');
    expect(document.activeElement).toBe(handle);
  });

  it('shows a focus indicator on keyboard focus, not just on hover', async () => {
    const user = userEvent.setup();
    render(<ControlledResizeHandle edge="right" initial={380} min={160} max={560} onCommit={vi.fn()} />);
    const handle = screen.getByRole('separator', { name: 'Resize reference drawer' });

    expect(handle.style.background).toBe('transparent');
    await user.tab();
    expect(handle.style.background).not.toBe('transparent');
  });
});
