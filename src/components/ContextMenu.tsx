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
  return (
    <Menu opened onClose={onClose} position="bottom-start" shadow="md" width={200}>
      <Menu.Target>
        <div
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
                onClose();
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
