import React from 'react';

/**
 * X19/#55 — focus management for a hand-rolled (non-`ContextMenu`-component)
 * context menu, for the surfaces (`TableView`'s cell/field menus) that render
 * their own plain-`<button>` dropdown rather than the shared Mantine-backed
 * `ContextMenu`. That shared component gets focus-enter for free from
 * Mantine's `FocusTrap` (see its own `returnFocusTo` docstring for the half
 * Mantine *can't* do); a plain `<div>` gets neither, so a keyboard-opened
 * instance needs both spelled out here.
 *
 * Mouse-driven opens are untouched: `menu.returnFocusTo` is only ever set by
 * a keyboard-open call site, so this is a no-op for the existing right-click
 * flow.
 */
export function useKeyboardMenuFocus(
  menuRef: React.RefObject<HTMLElement | null>,
  menu: { returnFocusTo?: HTMLElement | null } | null,
): void {
  React.useEffect(() => {
    if (!menu?.returnFocusTo) return;
    const { returnFocusTo } = menu;
    menuRef.current?.querySelector('button')?.focus();
    return () => returnFocusTo.focus();
  }, [menu, menuRef]);
}
