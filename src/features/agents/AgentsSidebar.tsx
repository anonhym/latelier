import React from 'react';
import { ActionIcon, Button, Menu, Tooltip } from '@mantine/core';
import { IconDots, IconHome, IconKey, IconPlus, IconSettings } from '@tabler/icons-react';
import { themeVars } from '../../theme/themeVars';
import { isContextMenuKey } from '../../utils/contextMenuKey';
import type { AgentAccessState, AgentSessionInfo, AgentSessionRow, AgentTokenInfo } from '@shared/types';
import type { AgentsPage } from './agentsPage';
import { sessionWhere } from './agentsPage';
import { NeedsYouBadge } from './AgentsModeSwitch';
import { needsYouCount, requestsBySession } from './needsYou';
import { agentRows, endedSessionLine, endedSlice, isExpanded, liveSessionLine, type AgentRow } from './sidebarModel';
import { useEndedSessions } from './useEndedSessions';
import { useNow } from './useNow';
import { useAgentTokenActions } from './useAgentTokenActions';
import { AgentTokenDialogs } from './AgentTokenDialogs';

const T = themeVars;

/** One focusable row of the tree, in on-screen order. */
type Item =
  | { kind: 'agent'; key: string; row: AgentRow; expanded: boolean }
  | { kind: 'live'; key: string; parent: string; session: AgentSessionInfo }
  | { kind: 'ended'; key: string; parent: string; session: AgentSessionRow }
  | { kind: 'more'; key: string; parent: string };

function itemPage(item: Item, tokenName: (id: string) => string): AgentsPage {
  switch (item.kind) {
    case 'agent':
      return { kind: 'agent', tokenId: item.row.id };
    case 'more':
      return { kind: 'agent', tokenId: item.parent };
    case 'live':
      return { kind: 'session', sessionId: item.session.id, agentName: item.session.tokenName, where: sessionWhere(item.session) };
    case 'ended':
      return {
        kind: 'session',
        sessionId: item.session.id,
        agentName: item.session.tokenName ?? tokenName(item.parent),
        where: sessionWhere(item.session),
      };
  }
}

function isCurrent(item: Item, page: AgentsPage | null): boolean {
  if (!page) return false;
  if (item.kind === 'agent') return page.kind === 'agent' && page.tokenId === item.row.id;
  if (item.kind === 'live' || item.kind === 'ended') return page.kind === 'session' && page.sessionId === item.session.id;
  return false;
}

/** Text from the Agent's side: one line, cut with an ellipsis, the whole value in the tooltip. */
function Untrusted({ text, style }: { text: string; style?: React.CSSProperties }) {
  return (
    <span
      title={text}
      style={{ display: 'block', minWidth: 0, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', ...style }}
    >
      {text}
    </span>
  );
}

/**
 * The Agents sidebar (X30 §3): Home, then every Agent with its live sessions
 * and its last ended ones, then Connect an Agent. The Agents list is a tree
 * with the navigator's keys: arrows move, Right and Left expand and collapse,
 * Enter opens.
 */
export function AgentsSidebar({
  state,
  page,
  onNavigate,
}: {
  state: AgentAccessState | null;
  /** What the Agents tab shows while it is open, to mark the row; null while it is closed. */
  page: AgentsPage | null;
  onNavigate: (page: AgentsPage) => void;
}) {
  const now = useNow();
  const actions = useAgentTokenActions();
  const [choices, setChoices] = React.useState<ReadonlyMap<string, boolean>>(new Map());
  const [focusKey, setFocusKey] = React.useState<string | null>(null);
  const [menuFor, setMenuFor] = React.useState<string | null>(null);
  const itemRefs = React.useRef(new Map<string, HTMLDivElement>());

  const tokens = React.useMemo(() => state?.tokens ?? [], [state]);
  const rows = React.useMemo(() => agentRows(tokens, state?.sessions ?? [], now), [tokens, state, now]);
  const expandedIds = rows.filter((r) => isExpanded(r, choices)).map((r) => r.id);
  // A session starting or ending changes what the log holds for its Agent.
  const liveKey = (state?.sessions ?? []).map((s) => s.id).join(',');
  const ended = useEndedSessions(expandedIds, liveKey);
  const requests = requestsBySession(state);
  const tokenName = (id: string) => tokens.find((t) => t.id === id)?.name ?? 'Agent';

  const items: Item[] = [];
  for (const row of rows) {
    const expanded = isExpanded(row, choices);
    items.push({ kind: 'agent', key: `a:${row.id}`, row, expanded });
    if (!expanded) continue;
    for (const s of row.live) items.push({ kind: 'live', key: `s:${s.id}`, parent: row.id, session: s });
    // A live session can still be in the stored list until the state catches up; it is drawn once, as live.
    const liveIds = new Set(row.live.map((s) => s.id));
    const slice = endedSlice((ended.get(row.id) ?? []).filter((r) => !liveIds.has(r.id)));
    for (const s of slice.shown) items.push({ kind: 'ended', key: `e:${s.id}`, parent: row.id, session: s });
    if (slice.more) items.push({ kind: 'more', key: `m:${row.id}`, parent: row.id });
  }

  const tabStop = items.some((i) => i.key === focusKey) ? focusKey : (items[0]?.key ?? null);

  const focusItem = (key: string) => {
    setFocusKey(key);
    itemRefs.current.get(key)?.focus();
  };

  const setExpanded = (id: string, value: boolean) => setChoices((prev) => new Map(prev).set(id, value));

  const onItemKeyDown = (e: React.KeyboardEvent, item: Item, index: number) => {
    if (isContextMenuKey(e) && item.kind === 'agent') {
      e.preventDefault();
      setMenuFor(item.row.id);
      return;
    }
    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault();
        if (items[index + 1]) focusItem(items[index + 1]!.key);
        break;
      case 'ArrowUp':
        e.preventDefault();
        if (index > 0) focusItem(items[index - 1]!.key);
        break;
      case 'Home':
        e.preventDefault();
        if (items[0]) focusItem(items[0].key);
        break;
      case 'End':
        e.preventDefault();
        if (items.length > 0) focusItem(items[items.length - 1]!.key);
        break;
      case 'ArrowRight':
        e.preventDefault();
        if (item.kind !== 'agent') break;
        if (!item.expanded) setExpanded(item.row.id, true);
        else if (items[index + 1] && items[index + 1]!.kind !== 'agent') focusItem(items[index + 1]!.key);
        break;
      case 'ArrowLeft':
        e.preventDefault();
        if (item.kind === 'agent') {
          if (item.expanded) setExpanded(item.row.id, false);
        } else {
          focusItem(`a:${item.parent}`);
        }
        break;
      case 'Enter':
      case ' ':
        e.preventDefault();
        onNavigate(itemPage(item, tokenName));
        break;
    }
  };

  const rowStyle = (current: boolean): React.CSSProperties => ({
    background: current ? T.accentSoft : undefined,
    color: current ? T.accentInk : T.text,
    boxShadow: current ? `inset 2px 0 0 ${T.accent}` : undefined,
    cursor: 'pointer',
    outlineOffset: -2,
  });

  const renderItem = (item: Item, index: number) => {
    const current = isCurrent(item, page);
    const common = {
      ref: (el: HTMLDivElement | null) => {
        if (el) itemRefs.current.set(item.key, el);
        else itemRefs.current.delete(item.key);
      },
      role: 'treeitem' as const,
      tabIndex: item.key === tabStop ? 0 : -1,
      'aria-selected': current,
      onFocus: () => setFocusKey(item.key),
      onKeyDown: (e: React.KeyboardEvent) => onItemKeyDown(e, item, index),
      onClick: () => {
        setFocusKey(item.key);
        onNavigate(itemPage(item, tokenName));
      },
    };

    if (item.kind === 'agent') {
      const token = tokens.find((t) => t.id === item.row.id)!;
      return (
        <div
          key={item.key}
          {...common}
          aria-level={1}
          aria-expanded={item.expanded}
          aria-label={`${item.row.name}, ${item.row.meta}`}
          data-testid="agents-sidebar-agent"
          style={{
            ...rowStyle(current),
            minHeight: 28,
            display: 'flex',
            alignItems: 'center',
            gap: themeVars.gapSm,
            padding: '0 6px 0 10px',
            fontSize: T.fsMd,
            marginTop: index > 0 ? 4 : 0,
          }}
        >
          <span
            aria-hidden
            onClick={(e) => {
              e.stopPropagation();
              setExpanded(item.row.id, !item.expanded);
            }}
            style={{ color: T.textGhost, fontSize: T.fsXs, width: 10, flexShrink: 0 }}
          >
            {item.expanded ? '▾' : '▸'}
          </span>
          <IconKey size={13} stroke={1.5} aria-hidden="true" style={{ flexShrink: 0 }} />
          <Untrusted text={item.row.name} style={{ fontWeight: 600, flex: '0 1 auto' }} />
          <span style={{ marginLeft: 'auto', fontSize: T.fsXs, color: T.textGhost, whiteSpace: 'nowrap', flexShrink: 0 }}>
            {item.row.meta}
          </span>
          <AgentMenu
            token={token}
            opened={menuFor === token.id}
            onChange={(o) => setMenuFor(o ? token.id : null)}
            onCopy={() => actions.askCopySetup(token)}
            onRename={() => actions.askRename(token)}
            onRevoke={() => void actions.revoke(token)}
          />
        </div>
      );
    }

    if (item.kind === 'more') {
      return (
        <div
          key={item.key}
          {...common}
          aria-level={2}
          style={{ ...rowStyle(false), minHeight: 28, display: 'flex', alignItems: 'center', padding: '0 10px 0 30px', fontSize: T.fsSm, color: T.accentInk }}
        >
          Show all
        </div>
      );
    }

    const liveRow = item.kind === 'live';
    const s = item.session;
    const client = s.clientName ?? 'Unknown client';
    const sub = liveRow ? liveSessionLine(item.session, now) : endedSessionLine(item.session, now);
    const open = requests.get(s.id) ?? 0;
    return (
      <div
        key={item.key}
        {...common}
        aria-level={2}
        aria-label={`${client}, ${liveRow ? 'live' : 'ended'}, ${sub}`}
        data-testid={liveRow ? 'agents-sidebar-live-session' : 'agents-sidebar-ended-session'}
        style={{
          ...rowStyle(current),
          minHeight: 40,
          display: 'grid',
          gridTemplateColumns: '12px minmax(0,1fr) auto',
          gap: themeVars.gapSm,
          alignItems: 'center',
          padding: '4px 10px 4px 30px',
          boxSizing: 'border-box',
          opacity: liveRow ? 1 : 0.62,
        }}
      >
        <span
          aria-hidden
          style={
            liveRow
              ? { width: 8, height: 8, borderRadius: 4, background: T.greenDot, boxShadow: `0 0 0 3px ${T.greenSoft}` }
              : { width: 8, height: 8, borderRadius: 4, border: `1.5px solid ${T.textGhost}`, boxSizing: 'border-box' }
          }
        />
        <span style={{ minWidth: 0 }}>
          <Untrusted text={client} style={{ fontWeight: 500, fontSize: T.fsMd }} />
          <Untrusted
            text={sub}
            style={{ fontSize: T.fsXs, color: T.textGhost, fontFamily: liveRow ? 'var(--atelier-font-mono, monospace)' : undefined }}
          />
        </span>
        <NeedsYouBadge count={open} tone="warn" />
      </div>
    );
  };

  const homeCurrent = page?.kind === 'home';
  const requestCount = needsYouCount(state);

  return (
    <div
      data-testid="agents-sidebar"
      aria-label="Agents"
      role="navigation"
      style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}
    >
      <button
        type="button"
        onClick={() => onNavigate({ kind: 'home' })}
        aria-current={homeCurrent ? 'page' : undefined}
        data-testid="agents-sidebar-home"
        style={{
          ...rowStyle(homeCurrent),
          minHeight: 28,
          display: 'flex',
          alignItems: 'center',
          gap: themeVars.gapSm,
          padding: '0 10px',
          fontSize: T.fsMd,
          border: 0,
          background: homeCurrent ? T.accentSoft : 'transparent',
          textAlign: 'left',
          marginBottom: 4,
          flexShrink: 0,
        }}
      >
        <IconHome size={14} stroke={1.4} aria-hidden="true" />
        <span>Home</span>
        <span style={{ marginLeft: 'auto', display: 'flex' }}>
          <NeedsYouBadge count={requestCount} />
        </span>
      </button>

      {tokens.length > 0 && (
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: themeVars.gapXs,
            padding: '6px 6px 4px 14px',
            fontSize: T.fsXs,
            fontWeight: 600,
            letterSpacing: '.05em',
            textTransform: 'uppercase',
            color: T.textGhost,
            flexShrink: 0,
          }}
        >
          <span id="agents-sidebar-heading">Agents</span>
          <Tooltip label="Setup & capabilities" withArrow>
            <ActionIcon
              variant="subtle"
              color="gray"
              size="sm"
              style={{ marginLeft: 'auto' }}
              aria-label="Setup & capabilities"
              onClick={() => onNavigate({ kind: 'setup' })}
            >
              <IconSettings size={14} stroke={1.4} />
            </ActionIcon>
          </Tooltip>
        </div>
      )}

      <div style={{ flex: 1, minHeight: 0, overflowY: 'auto' }}>
        {items.length > 0 && (
          <div role="tree" aria-labelledby="agents-sidebar-heading">
            {items.map(renderItem)}
          </div>
        )}
      </div>

      <div style={{ padding: 10, borderTop: `1px solid ${T.border}`, flexShrink: 0 }}>
        <Button
          variant="default"
          size="xs"
          fullWidth
          leftSection={<IconPlus size={12} />}
          onClick={() => onNavigate({ kind: 'connect' })}
        >
          Connect an Agent
        </Button>
      </div>
      <AgentTokenDialogs actions={actions} />
    </div>
  );
}

/**
 * An Agent row's ⋯ menu. The row opens the Agent page on a click, so every
 * event from the button and the dropdown (a portal, but still a React child)
 * stops here, Escape included.
 */
function AgentMenu({
  token,
  opened,
  onChange,
  onCopy,
  onRename,
  onRevoke,
}: {
  token: AgentTokenInfo;
  opened: boolean;
  onChange: (opened: boolean) => void;
  onCopy: () => void;
  onRename: () => void;
  onRevoke: () => void;
}) {
  const stop = (e: React.SyntheticEvent) => e.stopPropagation();
  return (
    <Menu opened={opened} onChange={onChange} position="bottom-end" withinPortal>
      <Menu.Target>
        <ActionIcon
          variant="subtle"
          color="gray"
          size="sm"
          tabIndex={-1}
          aria-label={`Actions for ${token.name}`}
          onClick={stop}
          onKeyDown={stop}
        >
          <IconDots size={14} />
        </ActionIcon>
      </Menu.Target>
      <Menu.Dropdown onClick={stop} onKeyDown={stop}>
        <Menu.Item onClick={onCopy}>Copy setup again…</Menu.Item>
        <Menu.Item onClick={onRename}>Rename…</Menu.Item>
        <Menu.Item color="red" onClick={onRevoke}>
          Revoke…
        </Menu.Item>
      </Menu.Dropdown>
    </Menu>
  );
}
