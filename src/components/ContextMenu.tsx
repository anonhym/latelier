import React from 'react';
import { Menu } from '@mantine/core';

export type ContextMenuItem =
  | {
      kind: 'item';
      label: string;
      icon?: React.ReactNode;
      onClick: () => void;
      disabled?: boolean;
      disabledTitle?: string;
      destructive?: boolean;
      /**
       * X19/#70 — overrides `ContextMenuState.returnFocusTo` for this one
       * item. `returnFocusTo` is picked once, at menu-open time, as "the
       * widget's own focusable element" — right for most items, but wrong
       * for one that goes on to destroy that exact element (e.g. TabStrip's
       * "Close tab", which unmounts the tab `returnFocusTo` points at).
       * A thunk, not a value: the override is typically a ref (e.g.
       * `stripRef.current`), and `react-hooks/refs` (rightly) refuses a
       * `.current` read during render — this defers it to click time,
       * the same as `onClick` itself. Unset falls back to
       * `menu.returnFocusTo`, so every existing call site is unaffected.
       */
      focusReturnTo?: () => HTMLElement | null;
    }
  | { kind: 'sep' };

export interface ContextMenuState {
  x: number;
  y: number;
  items: ContextMenuItem[];
  /**
   * X19/#55 — real DOM focus lived here when the menu opened via keyboard
   * (Shift+F10 / the ContextMenu key); set only by a keyboard-open call site,
   * left `undefined` for a mouse-driven right-click so that path is unchanged.
   *
   * Mantine's own `returnFocus` can't do this: it hangs off `useFocusReturn`'s
   * `useDidUpdate([opened, ...])`, which only fires on a *transition* of
   * `opened`. This component always mounts with `opened` hard-coded `true`
   * and is dismissed by unmounting entirely (the caller nulls its `menu`
   * state) rather than by flipping `opened` to `false` — so that transition
   * never happens and `useFocusReturn` silently never captures or restores
   * anything (verified against `@mantine/hooks`' `use-focus-return` source).
   * Restoring it here ourselves is the only way it happens at all.
   */
  returnFocusTo?: HTMLElement | null;
}

interface ContextMenuProps {
  menu: ContextMenuState;
  onClose: () => void;
}

// Right-click context menu, driven by external {x, y, items} state.
// Implemented as a Mantine Menu anchored to a 0x0 fixed-position div at
// the cursor coordinates. Mantine's Floating UI integration handles
// viewport-edge auto-flipping, outside-click dismissal, and ESC.
export function ContextMenu({ menu, onClose }: ContextMenuProps) {
  const handleClose = (focusTo: HTMLElement | null | undefined = menu.returnFocusTo) => {
    onClose();
    focusTo?.focus();
  };
  return (
    <Menu opened onClose={handleClose} position="bottom-start" shadow="md" width={200}>
      <Menu.Target>
        <div
          data-testid="context-menu-anchor"
          style={{
            position: 'fixed',
            top: menu.y,
            left: menu.x,
            width: 0,
            height: 0,
            pointerEvents: 'none',
          }}
        />
      </Menu.Target>
      <Menu.Dropdown>
        {menu.items.map((it, i) =>
          it.kind === 'sep' ? (
            <Menu.Divider key={`sep-${i}`} />
          ) : (
            <Menu.Item
              key={`${it.label}-${i}`}
              leftSection={it.icon}
              disabled={it.disabled}
              color={it.destructive ? 'red' : undefined}
              title={it.disabled ? it.disabledTitle : undefined}
              // X19/#70 — Mantine's own item click also auto-closes the menu
              // (`closeOnItemClick`, default true), calling `onClose` a
              // second time with none of our arguments. Harmless when every
              // item shares one `returnFocusTo`, but that second, bare call
              // would re-focus `menu.returnFocusTo` and clobber a per-item
              // `focusReturnTo` override. `handleClose` below is the only
              // close this menu needs.
              closeMenuOnClick={false}
              onClick={() => {
                if (it.disabled) return;
                it.onClick();
                handleClose(it.focusReturnTo?.());
              }}
            >
              {it.label}
            </Menu.Item>
          ),
        )}
      </Menu.Dropdown>
    </Menu>
  );
}
