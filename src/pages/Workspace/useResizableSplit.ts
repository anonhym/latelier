import React from 'react';
import { resizeKeyStep } from './resizeKeyStep';

/** Bounds the mouse drag has always clamped to; reused for keyboard resize and aria-value*. */
export const MIN_RESULT_HEIGHT = 80;
export const MAX_RESULT_HEIGHT = 800;

/**
 * Manages a drag-to-resize split panel.
 *
 * Visual updates flow through `liveHeight` during the drag; the final
 * committed height is written once on mouseup via `onCommit`. Listeners
 * are registered via useEffect so they are removed on unmount even if the
 * component is destroyed mid-drag.
 */
export function useResizableSplit({
  persistedHeight,
  hasContent,
  collapsedHeight,
  onCommit,
}: {
  persistedHeight: number;
  hasContent: boolean;
  collapsedHeight: number;
  onCommit: (height: number) => void;
}) {
  const [liveHeight, setLiveHeight] = React.useState<number | null>(null);
  const [isDragging, setIsDragging] = React.useState(false);
  const dragRef = React.useRef<{ startY: number; startH: number } | null>(null);

  const resultPanelHeight = liveHeight ?? (hasContent ? persistedHeight : collapsedHeight);

  React.useEffect(() => {
    if (!isDragging) return;

    const onMove = (ev: MouseEvent) => {
      const d = dragRef.current;
      if (!d) return;
      const next = Math.max(
        MIN_RESULT_HEIGHT,
        Math.min(MAX_RESULT_HEIGHT, d.startH - (ev.clientY - d.startY)),
      );
      setLiveHeight(next);
    };

    const onUp = () => {
      dragRef.current = null;
      setIsDragging(false);
      // Commit the final value once, then clear the live override.
      setLiveHeight((current) => {
        if (current !== null) onCommit(current);
        return null;
      });
    };

    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    return () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
  }, [isDragging, onCommit]);

  const onResizeStart = (e: React.MouseEvent) => {
    e.preventDefault();
    dragRef.current = { startY: e.clientY, startH: persistedHeight };
    setLiveHeight(persistedHeight);
    setIsDragging(true);
  };

  // Keyboard equivalent of the drag: each Arrow/Home/End press is a whole
  // resize in one step, so it commits straight away rather than going
  // through the live/commit split the drag needs for continuous movement.
  const onKeyDown = (e: React.KeyboardEvent) => {
    const next = resizeKeyStep(e.key, 'vertical', resultPanelHeight, MIN_RESULT_HEIGHT, MAX_RESULT_HEIGHT);
    if (next === null) return;
    e.preventDefault();
    e.stopPropagation();
    onCommit(next);
  };

  return { resultPanelHeight, onResizeStart, onKeyDown };
}
