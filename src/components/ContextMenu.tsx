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
  const handleClose = () => {
    onClose();
    menu.returnFocusTo?.focus();
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
              onClick={() => {
                if (it.disabled) return;
                it.onClick();
                handleClose();
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
