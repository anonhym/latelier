import React from 'react';

/**
 * X19/#55/#69 — focus management for a hand-rolled (non-`ContextMenu`-
 * component) context menu, for the surfaces (`TableView`'s cell/field menus,
 * `TreeView`'s field menu) that render their own plain-`<button>` dropdown
 * rather than the shared Mantine-backed `ContextMenu`. That shared component
 * gets focus-enter for free from Mantine's `FocusTrap` regardless of how it
 * was opened (see its own `returnFocusTo` docstring for the half Mantine
 * *can't* do — restoring focus on close); a plain `<div>` gets neither, so a
 * keyboard-opened instance needs both spelled out here.
 *
 * `returnFocusTo` alone now drives *restore-on-close* for both a keyboard
 * and a mouse open (#69 — one mechanism for both paths, so right-click then
 * Escape/click-away no longer strands focus on `<body>`). But *grab focus
 * into the menu on open* stays keyboard-only, gated by the separate
 * `focusMenuOnOpen` flag: unlike `ContextMenu`'s Mantine `FocusTrap`, a
 * mouse-driven open of one of these hand-rolled menus never used to move
 * focus at all, and a mouse user mid-right-click doesn't expect focus to
 * jump out from under the cursor. Only `returnFocusTo` is set on a mouse
 * open — `focusMenuOnOpen` stays `undefined` — so that open-time behaviour
 * is unchanged; only the close-time restore is new.
 */
export function useKeyboardMenuFocus(
  menuRef: React.RefObject<HTMLElement | null>,
  menu: { returnFocusTo?: HTMLElement | null; focusMenuOnOpen?: boolean } | null,
): void {
  React.useEffect(() => {
    if (!menu?.returnFocusTo) return;
    const { returnFocusTo, focusMenuOnOpen } = menu;
    if (focusMenuOnOpen) menuRef.current?.querySelector('button')?.focus();
    return () => returnFocusTo.focus();
  }, [menu, menuRef]);
}
