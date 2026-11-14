import React from 'react';
import { ActionIcon, Button, Group, Tooltip, UnstyledButton } from '@mantine/core';
import { themeVars } from '../../theme/themeVars';
import { I } from '../../icons';
import { formatShortcut } from '../../commands/shortcutLabel';
import { isMacRenderer } from '../../utils/platform';

interface TitleBarProps {
  /**
   * The location breadcrumb. A slot rather than threading the Switcher's and
   * the navigator's props through TitleBar: the breadcrumb owns its dropdowns.
   * Omitted when no Connection is saved.
   */
  breadcrumb?: React.ReactNode;
  sidebarCollapsed: boolean;
  onToggleSidebar: () => void;
  onOpenSettings: () => void;
  onOpenPalette: () => void;
  shellOpen: boolean;
  shellAvailable: boolean;
  onToggleShell: () => void;
}

const NO_DRAG = { WebkitAppRegion: 'no-drag' } as React.CSSProperties;

export function TitleBar({
  breadcrumb,
  sidebarCollapsed,
  onToggleSidebar,
  onOpenSettings,
  onOpenPalette,
  shellOpen,
  shellAvailable,
  onToggleShell,
}: TitleBarProps) {
  const T = themeVars;
  const shellTooltip = shellAvailable
    ? 'Interactive shell for the focused connection (⌃`)'
    : 'Open a connection to use the Console';
  return (
    <Group
      gap={themeVars.gapSm}
      wrap="nowrap"
      style={{
        height: 40,
        padding: '0 14px',
        borderBottom: `1px solid ${T.border}`,
        background: T.surface,
        flexShrink: 0,
        WebkitAppRegion: 'drag',
      } as React.CSSProperties}
    >
      <div style={{ width: 70, flexShrink: 0 }} />
      <Tooltip label="Toggle sidebar" withArrow>
        <ActionIcon
          variant="subtle"
          color="gray"
          size="md"
          onClick={onToggleSidebar}
          aria-label="Toggle sidebar"
          aria-pressed={!sidebarCollapsed}
          style={NO_DRAG}
        >
          {I.sidebar}
        </ActionIcon>
      </Tooltip>
      {breadcrumb && (
        // Only the breadcrumb's own buttons opt out of dragging; the bar
        // around them stays part of the window's drag area.
        <div style={{ display: 'flex', flex: '0 1 auto', minWidth: 0, ...NO_DRAG }}>{breadcrumb}</div>
      )}
      {/* Plain drag spacer, not a no-drag Group — a flex:1 no-drag box
          made the whole middle of the bar undraggable. */}
      <div style={{ flex: 1 }} />
      {/* A button drawn as an input: it opens the palette, it takes no text. */}
      <UnstyledButton
        onClick={onOpenPalette}
        data-hint-anchor="palette.discover"
        aria-label="Search collections and actions"
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: T.gapSm,
          width: 320,
          minWidth: 120,
          flexShrink: 1,
          height: 26,
          padding: '0 8px',
          border: `1px solid ${T.borderMed}`,
          borderRadius: 6,
          background: T.bg,
          color: T.textMuted,
          fontSize: T.fsSm,
          ...NO_DRAG,
        }}
      >
        <span aria-hidden style={{ display: 'flex' }}>{I.search}</span>
        <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          Search collections and actions
        </span>
        <kbd
          aria-hidden
          style={{
            fontFamily: 'inherit',
            fontSize: T.fsXs,
            padding: '0 5px',
            border: `1px solid ${T.borderMed}`,
            borderRadius: 4,
            whiteSpace: 'nowrap',
          }}
        >
          {formatShortcut('⌘K', isMacRenderer())}
        </kbd>
      </UnstyledButton>
      <Tooltip label={shellTooltip} withArrow>
        <Button
          variant={shellOpen ? 'light' : 'default'}
          color={shellOpen ? 'violet' : 'gray'}
          size="compact-xs"
          onClick={onToggleShell}
          disabled={!shellAvailable}
          aria-pressed={shellOpen}
          leftSection={I.terminal}
          style={NO_DRAG}
        >
          Console
        </Button>
      </Tooltip>
      <Tooltip label="Settings" withArrow>
        <ActionIcon
          variant="default"
          size="md"
          onClick={onOpenSettings}
          aria-label="Open settings"
          style={NO_DRAG}
        >
          {I.gear}
        </ActionIcon>
      </Tooltip>
    </Group>
  );
}
