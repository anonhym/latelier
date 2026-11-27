import { Button } from '@mantine/core';
import { IconPlugConnectedX } from '@tabler/icons-react';
import { themeVars } from '../../theme/themeVars';
import { NeedsYouBadge } from './AgentsModeSwitch';
import type { ConnectionRequestItem, NeedsYouItem } from './needsYou';

const T = themeVars;

export const NEEDS_YOU_EMPTY = 'Nothing needs you. Agents never write; when one needs something, it shows here.';

export interface NeedsYouHandlers {
  /** The user's ordinary connect action. */
  onOpenConnection: (connectionId: string) => void;
  onNotNow: (item: ConnectionRequestItem) => void;
}

/** The sentence of a Connection request (X30 §8). Every name in it came from elsewhere: text only. */
function RequestSentence({ item }: { item: ConnectionRequestItem }) {
  return (
    <>
      <b>{item.agent}</b> asked for <b>{item.connectionName}</b>. It is shared, but not open, so the call{' '}
      {item.outcome === 'waiting' ? (
        <>is waiting for you; then accept in {item.client ?? 'the client'} to continue.</>
      ) : (
        <>was refused.</>
      )}
    </>
  );
}

function RequestRow({ item, handlers, first }: { item: ConnectionRequestItem; handlers: NeedsYouHandlers; first: boolean }) {
  return (
    <li
      data-testid="needs-you-request"
      style={{
        display: 'grid',
        gridTemplateColumns: '28px minmax(0,1fr) auto',
        gap: themeVars.gapMd,
        alignItems: 'center',
        padding: '12px 16px',
        borderTop: first ? undefined : `1px solid ${T.border}`,
      }}
    >
      <span
        aria-hidden
        style={{
          width: 28,
          height: 28,
          borderRadius: T.rs,
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'center',
          background: T.warnSoft,
          color: T.warn,
        }}
      >
        <IconPlugConnectedX size={14} stroke={1.5} />
      </span>
      <div style={{ minWidth: 0 }}>
        <div style={{ fontSize: T.fsMd, overflowWrap: 'anywhere' }}>
          <RequestSentence item={item} />
        </div>
        <div style={{ fontSize: T.fsSm, color: T.textGhost, marginTop: 2, overflowWrap: 'anywhere' }}>{item.meta}</div>
      </div>
      <div style={{ display: 'flex', gap: themeVars.gapXs, alignItems: 'center' }}>
        <Button size="compact-sm" onClick={() => handlers.onOpenConnection(item.connectionId)}>
          Open {item.connectionName}
        </Button>
        <Button size="compact-sm" variant="subtle" color="gray" onClick={() => handlers.onNotNow(item)}>
          Not now
        </Button>
      </div>
    </li>
  );
}

/**
 * Needs you (X30 §8): one list model for Home, a session page and the toasts.
 * Connection requests only for now; Proposals and the Later group join as
 * more kinds of item.
 */
export function NeedsYouList({ items, handlers }: { items: readonly NeedsYouItem[]; handlers: NeedsYouHandlers }) {
  return (
    <section
      aria-labelledby="needs-you-heading"
      data-testid="needs-you"
      style={{ background: T.surface, border: `1px solid ${T.border}`, borderRadius: T.r }}
    >
      <div style={{ display: 'flex', alignItems: 'center', padding: '12px 16px 4px' }}>
        <h2 id="needs-you-heading" style={{ margin: 0, fontSize: T.fsMd, fontWeight: 600, display: 'flex', alignItems: 'center', gap: themeVars.gapSm }}>
          Needs you <NeedsYouBadge count={items.length} />
        </h2>
      </div>
      {items.length === 0 ? (
        <p style={{ margin: 0, padding: '8px 16px 14px', fontSize: T.fsSm, color: T.textMuted }}>{NEEDS_YOU_EMPTY}</p>
      ) : (
        <ul style={{ listStyle: 'none', margin: 0, padding: 0 }}>
          {items.map((item, i) => (
            <RequestRow key={item.key} item={item} handlers={handlers} first={i === 0} />
          ))}
        </ul>
      )}
    </section>
  );
}
