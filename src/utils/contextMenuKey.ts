/**
 * X19/#55 — the shared `ContextMenu` had a mouse trigger (`onContextMenu`) at
 * every call site and no keyboard trigger anywhere. These two platform
 * conventions open "the context menu for the focused thing": the dedicated
 * ContextMenu key, and Shift+F10. Every caller (DbCollectionNavigator,
 * TableView, TabStrip) shares this one predicate instead of re-deriving it in
 * each key handler.
 */
export function isContextMenuKey(e: { key: string; shiftKey: boolean }): boolean {
  return e.key === 'ContextMenu' || (e.shiftKey && e.key === 'F10');
}

/** A `DOMRect`-shaped input — deliberately structural, not `DOMRect` itself,
 * so this stays testable with a plain object and no DOM. */
export interface RectLike {
  left: number;
  bottom: number;
}

/**
 * Where a keyboard-opened context menu anchors: the bottom-left corner of the
 * focused row, matching where Mantine's `position="bottom-start"` would put
 * the dropdown for a real anchor element there. A keyboard open has no cursor
 * coordinate to reuse.
 */
export function anchorFromRect(rect: RectLike): { x: number; y: number } {
  return { x: rect.left, y: rect.bottom };
}
