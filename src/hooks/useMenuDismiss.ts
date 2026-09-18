import React from 'react';

/**
 * X19/#68 — dismiss a hand-rolled context menu on an outside click or on
 * Escape. Three copies of this effect had grown byte-for-byte identical
 * (`TableView`'s cell menu and field menu, `TreeView`'s field menu), and #68
 * was about to add the third; SonarCloud flagged the pair.
 *
 * Escape listens on the **window**, not as an `onKeyDown` on the menu
 * element. These menus open from a `contextmenu` event and, on the mouse
 * path, nothing ever gives them real DOM focus — so a handler on the menu
 * node would never receive a keydown. It would be dead code that a test
 * firing an event directly at the node would still report as working.
 * (`useKeyboardMenuFocus` is the one thing that does focus them, and only
 * on a keyboard open.)
 *
 * `close` must be stable — it is an effect dependency, and a fresh arrow per
 * render would tear the listeners down and rebuild them on every render.
 * Every call site wraps it in `useCallback` with an empty dependency array,
 * which is enough because each one only calls its own `setState` setter.
 *
 * #87 is filed against a defect in this behaviour: an outside click that
 * lands on another focusable control still pulls focus back to the owning
 * grid or tree. That fix belongs here, in the one place, which is the other
 * reason this is a hook rather than a third copy.
 */
export function useMenuDismiss(isOpen: boolean, close: () => void): void {
  React.useEffect(() => {
    if (!isOpen) return;
    const onClick = () => close();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close();
    };
    window.addEventListener('click', onClick);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('click', onClick);
      window.removeEventListener('keydown', onKey);
    };
  }, [isOpen, close]);
}
