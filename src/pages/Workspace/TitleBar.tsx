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
  /** The welcome canvas's bar: with nothing saved there is no sidebar to toggle and no Console to open. */
  bare?: boolean;
  sidebarCollapsed: boolean;
  onToggleSidebar: () => void;
  onOpenSettings: () => void;
  onOpenPalette: () => void;
  shellOpen: boolean;
  shellAvailable: boolean;
  onToggleShell: () => void;
  /** Whether the Inspector (the Query Builder's panel) is on screen. */
  builderOpen: boolean;
  /** A collection tab on Documents: otherwise there is no panel to toggle. */
  builderAvailable: boolean;
  onToggleBuilder: () => void;
}

const NO_DRAG = { WebkitAppRegion: 'no-drag' } as React.CSSProperties;

export function TitleBar({
  breadcrumb,
  bare = false,
  sidebarCollapsed,
  onToggleSidebar,
  onOpenSettings,
  onOpenPalette,
  shellOpen,
  shellAvailable,
  onToggleShell,
  builderOpen,
  builderAvailable,
  onToggleBuilder,
}: TitleBarProps) {
  const T = themeVars;
  const builderShortcut = formatShortcut('⌘⇧B', isMacRenderer());
  const builderTooltip = builderAvailable
    ? `Toggle Query Builder (${builderShortcut})`
    : "Open a collection's Documents view to use the Query Builder";
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
      {!bare && (
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
      )}
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
      {!bare && (
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
      )}
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
      {/* The sidebar toggle's twin, mirrored to the bar's right edge: the
          panel it opens sits on that side. */}
      {!bare && (
        <Tooltip label={builderTooltip} withArrow>
          <ActionIcon
            variant="subtle"
            color="gray"
            size="md"
            onClick={onToggleBuilder}
            disabled={!builderAvailable}
            aria-label={`Toggle Query Builder (${builderShortcut})`}
            aria-pressed={builderOpen}
            style={NO_DRAG}
          >
            {I.inspector}
          </ActionIcon>
        </Tooltip>
      )}
    </Group>
  );
}
