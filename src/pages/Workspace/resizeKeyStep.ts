export type ResizeAxis = 'horizontal' | 'vertical';

/**
 * Default keyboard nudge for a resize separator. Matches the 10px step
 * TableView's column-resize separator already ships (`views/TableView.tsx`),
 * so keyboard-resize feels the same everywhere in the app.
 */
export const RESIZE_STEP = 10;

/**
 * Maps a keydown on a `role="separator"` resize handle to the next clamped
 * value, or `null` if the key isn't one this widget owns — the caller then
 * lets it bubble untouched (e.g. ScriptTab's root Cmd+Enter listener).
 *
 * Up/Right increase the value, Down/Left decrease it — the ARIA
 * window-splitter convention, matching the shipped `react-resizable-panels`
 * handle (`tests/e2e/separator-highlight.e2e.ts`) and TableView's column
 * resize. Home/End jump straight to the bounds.
 */
export function resizeKeyStep(
  key: string,
  axis: ResizeAxis,
  value: number,
  min: number,
  max: number,
  step: number = RESIZE_STEP,
): number | null {
  const increaseKey = axis === 'horizontal' ? 'ArrowRight' : 'ArrowUp';
  const decreaseKey = axis === 'horizontal' ? 'ArrowLeft' : 'ArrowDown';
  if (key === increaseKey) return Math.min(max, value + step);
  if (key === decreaseKey) return Math.max(min, value - step);
  if (key === 'Home') return min;
  if (key === 'End') return max;
  return null;
}
