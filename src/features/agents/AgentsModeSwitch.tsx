import React from 'react';
import { Tooltip, VisuallyHidden } from '@mantine/core';
import { IconPlugConnected } from '@tabler/icons-react';
import { themeVars } from '../../theme/themeVars';
import { formatShortcut } from '../../commands/shortcutLabel';
import { isMacRenderer } from '../../utils/platform';
import { needsYouLabel } from './needsYou';
import type { SidebarMode } from './useSidebarMode';

/** The count pill of Needs you, on the switch and on Home's row; nothing at zero. */
export function NeedsYouBadge({ count, tone = 'accent' }: { count: number; tone?: 'accent' | 'warn' }) {
  if (count <= 0) return null;
  return (
    <>
      <span
        aria-hidden="true"
        data-testid="needs-you-badge"
        style={{
          fontSize: themeVars.fsXs,
          fontWeight: 600,
          lineHeight: '16px',
          minWidth: 16,
          height: 16,
          borderRadius: 8,
          padding: '0 5px',
          boxSizing: 'border-box',
          textAlign: 'center',
          background: tone === 'warn' ? themeVars.warn : themeVars.accent,
          color: '#fff',
          display: 'inline-block',
        }}
      >
        {count}
      </span>
      <VisuallyHidden>{needsYouLabel(count)}</VisuallyHidden>
    </>
  );
}

const MODES: ReadonlyArray<SidebarMode> = ['databases', 'agents'];

/**
 * The two-segment switch at the top of the sidebar (X30 §2): a tablist with
 * one tab stop, arrow keys moving and choosing. The Agents segment carries
 * the plug and the Needs you count.
 */
export function AgentsModeSwitch({
  mode,
  onChange,
  needsYou,
}: {
  mode: SidebarMode;
  onChange: (mode: SidebarMode) => void;
  needsYou: number;
}) {
  const T = themeVars;
  const refs = React.useRef<Record<SidebarMode, HTMLButtonElement | null>>({ databases: null, agents: null });
  const shortcut = formatShortcut('⌘⇧A', isMacRenderer());

  const onKeyDown = (e: React.KeyboardEvent) => {
    const at = MODES.indexOf(mode);
    let next: SidebarMode | null = null;
    if (e.key === 'ArrowRight' || e.key === 'ArrowDown') next = MODES[(at + 1) % MODES.length]!;
    else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') next = MODES[(at + MODES.length - 1) % MODES.length]!;
    else if (e.key === 'Home') next = MODES[0]!;
    else if (e.key === 'End') next = MODES[MODES.length - 1]!;
    if (!next) return;
    e.preventDefault();
    if (next !== mode) onChange(next);
    refs.current[next]?.focus();
  };

  const segment = (m: SidebarMode, label: string) => {
    const selected = m === mode;
    return (
      <Tooltip label={`${label} · ${shortcut} switches`} withArrow openDelay={400}>
        <button
          ref={(el) => {
            refs.current[m] = el;
          }}
          type="button"
          role="tab"
          id={`sidebar-mode-${m}`}
          aria-selected={selected}
          tabIndex={selected ? 0 : -1}
          data-hint-anchor={m === 'agents' ? 'agents.share' : undefined}
          onClick={() => {
            if (!selected) onChange(m);
          }}
          style={{
            flex: 1,
            minWidth: 0,
            border: 0,
            borderRadius: T.rx,
            background: selected ? T.surface : 'transparent',
            color: selected ? T.text : T.textMuted,
            fontWeight: selected ? 600 : 400,
            fontSize: T.fsSm,
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: themeVars.gapXs,
            cursor: 'pointer',
            boxShadow: selected ? '0 1px 2px rgba(0,0,0,.08)' : undefined,
          }}
        >
          {m === 'agents' && <IconPlugConnected size={13} stroke={1.5} aria-hidden="true" />}
          <span>{label}</span>
          {m === 'agents' && <NeedsYouBadge count={needsYou} />}
        </button>
      </Tooltip>
    );
  };

  return (
    <div
      role="tablist"
      aria-label="Sidebar mode"
      data-testid="sidebar-mode-switch"
      onKeyDown={onKeyDown}
      style={{
        margin: '8px 10px 8px',
        height: 30,
        flexShrink: 0,
        borderRadius: T.rs,
        background: T.surfaceRaised,
        display: 'flex',
        padding: 2,
        gap: themeVars.gapXs,
        boxSizing: 'border-box',
      }}
    >
      {segment('databases', 'Databases')}
      {segment('agents', 'Agents')}
    </div>
  );
}
