import React from 'react';

export interface DocMenuState {
  x: number;
  y: number;
  doc: unknown;
  returnFocusTo?: HTMLElement | null;
}

/**
 * Open state for a per-document "More actions" menu, rendered through the
 * shared `ContextMenu` (which owns focus, dismissal and arrow keys). Table
 * adds its clicked cell's menu payload and passes the clicked cell's `field`/`value`/
 * `hasValue` as `extra`, which is spread into the state.
 */
export function useDocMenu<E extends object = object>() {
  const [docMenu, setDocMenu] = React.useState<(DocMenuState & Partial<E>) | null>(null);
  const openDocMenu = React.useCallback(
    (
      doc: unknown,
      anchor: { x: number; y: number },
      focus?: { returnFocusTo?: HTMLElement | null },
      extra?: E,
    ) => {
      const base: Partial<E> = extra ?? {};
      setDocMenu({
        ...base,
        ...anchor,
        doc,
        returnFocusTo: focus?.returnFocusTo,
      });
    },
    [],
  );
  const closeDocMenu = React.useCallback(() => setDocMenu(null), []);
  return { docMenu, openDocMenu, closeDocMenu };
}
