/**
 * "Find a field" in the column picker scrolls that column into view in the
 * Table. The picker and the Table are siblings with no shared owner, so the
 * request travels over a module-level event target: whichever Table is mounted scrolls, and
 * a picker with no Table on screen simply finds no listener.
 */
// Stryker disable next-line StringLiteral: the name only has to match between the two ends below
const EVENT = 'scroll-to-column';
const bus = new EventTarget();

export function requestColumnScroll(field: string): void {
  bus.dispatchEvent(new CustomEvent<string>(EVENT, { detail: field }));
}

/** Calls `handler` with the requested field name; returns the unsubscribe. */
export function onColumnScrollRequest(handler: (field: string) => void): () => void {
  const listener = (e: Event) => handler((e as CustomEvent<string>).detail);
  bus.addEventListener(EVENT, listener);
  return () => bus.removeEventListener(EVENT, listener);
}

export interface ColumnReveal {
  scrollLeft: number;
  /** The scroll container's visible width. */
  clientWidth: number;
  /** The column's left and right edge, in scroll-content coordinates. */
  left: number;
  right: number;
  /** Width pinned at the left that a column must clear (the sticky `_id`), and at the right (the actions column). */
  leftObstruction: number;
  rightObstruction: number;
}

/**
 * The smallest scroll change that shows the whole column between the two
 * pinned edges. A column wider than the free space aligns its left edge, the
 * side a reader starts from.
 */
export function scrollLeftToReveal({
  scrollLeft,
  clientWidth,
  left,
  right,
  leftObstruction,
  rightObstruction,
}: ColumnReveal): number {
  const farthestLeft = left - leftObstruction;
  const nearestRight = right - (clientWidth - rightObstruction);
  return Math.max(0, Math.min(farthestLeft, Math.max(nearestRight, scrollLeft)));
}
