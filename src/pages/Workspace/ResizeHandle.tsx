import React from 'react';
import { themeVars } from '../../theme/themeVars';
import { resizeKeyStep } from './resizeKeyStep';

interface ResizeHandleProps {
  /**
   * Which side of the handle owns the size.
   *
   * Horizontal (col-resize):
   * - `left`: panel sits left of the handle. Dragging right grows the panel.
   * - `right`: panel sits right of the handle. Dragging right shrinks it.
   *
   * Vertical (row-resize):
   * - `top`: panel sits below the handle. Dragging up grows the panel
   *   (used for the bottom shell pane).
   * - `bottom`: panel sits above the handle. Dragging down grows the panel.
   */
  edge: 'left' | 'right' | 'top' | 'bottom';
  value: number;
  min: number;
  max: number;
  onChange: (next: number) => void;
  onCommit?: (next: number) => void;
  ariaLabel?: string;
}

export function ResizeHandle({
  edge,
  value,
  min,
  max,
  onChange,
  onCommit,
  ariaLabel,
}: ResizeHandleProps) {
  const T = themeVars;
  const [hover, setHover] = React.useState(false);
  const [active, setActive] = React.useState(false);
  const [focused, setFocused] = React.useState(false);

  const horizontal = edge === 'left' || edge === 'right';

  const handleMouseDown = (e: React.MouseEvent<HTMLDivElement>) => {
    e.preventDefault();
    const startCoord = horizontal ? e.clientX : e.clientY;
    const startValue = value;
    setActive(true);
    const prevBodyCursor = document.body.style.cursor;
    const prevBodySelect = document.body.style.userSelect;
    document.body.style.cursor = horizontal ? 'col-resize' : 'row-resize';
    document.body.style.userSelect = 'none';

    let latest = startValue;
    const onMove = (me: MouseEvent) => {
      const cur = horizontal ? me.clientX : me.clientY;
      const deltaPx = cur - startCoord;
      // Edges where the panel sits on the trailing side of the handle
      // (right/top) need the delta inverted: dragging toward the panel
      // shrinks it.
      const delta = edge === 'left' || edge === 'bottom' ? deltaPx : -deltaPx;
      const next = Math.min(max, Math.max(min, startValue + delta));
      latest = next;
      onChange(next);
    };
    const onUp = () => {
      document.body.style.cursor = prevBodyCursor;
      document.body.style.userSelect = prevBodySelect;
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
      setActive(false);
      onCommit?.(latest);
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  };

  // Keyboard equivalent of the drag above. `value`/`min`/`max` are already
  // the props the mouse path clamps against, so the shared step helper needs
  // no extra wiring here (see `resizeKeyStep.ts`) — a key it doesn't own
  // (anything but Arrow/Home/End) comes back `null` and is left to bubble.
  const onKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    const next = resizeKeyStep(e.key, horizontal ? 'horizontal' : 'vertical', value, min, max);
    if (next === null) return;
    e.preventDefault();
    e.stopPropagation();
    onChange(next);
    onCommit?.(next);
  };

  // Mousedown above calls `preventDefault()`, which blocks the browser's
  // default click-to-focus step — so `focused` only ever goes true from Tab,
  // and this can safely double as the keyboard-modality indicator without a
  // `:focus-visible` selector (inline styles can't express one).
  const visible = hover || active || focused;

  return (
    <div
      role="separator"
      aria-orientation={horizontal ? 'vertical' : 'horizontal'}
      aria-label={ariaLabel ?? 'Resize panel'}
      aria-valuenow={value}
      aria-valuemin={min}
      aria-valuemax={max}
      tabIndex={0}
      onMouseDown={handleMouseDown}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      onFocus={() => setFocused(true)}
      onBlur={() => setFocused(false)}
      onKeyDown={onKeyDown}
      style={{
        ...(horizontal ? { width: 4 } : { height: 4 }),
        flexShrink: 0,
        cursor: horizontal ? 'col-resize' : 'row-resize',
        background: visible ? T.accent : 'transparent',
        transition: active ? undefined : 'background 120ms',
        position: 'relative',
        zIndex: 2,
      }}
    />
  );
}
