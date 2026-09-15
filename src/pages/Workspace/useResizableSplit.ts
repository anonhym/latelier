import React from 'react';

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
      const next = Math.max(80, Math.min(800, d.startH - (ev.clientY - d.startY)));
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

  return { resultPanelHeight, onResizeStart };
}
