import React from 'react';
import { Button, UnstyledButton } from '@mantine/core';
import { IconChevronDown, IconChevronRight, IconLink, IconPlugConnectedX } from '@tabler/icons-react';
import { themeVars } from '../../theme/themeVars';
import { NeedsYouBadge } from './AgentsModeSwitch';
import type { ConnectionRequestItem, NeedsYouItem, ProposalItem } from './needsYou';
import { ProposalCard } from './ProposalCard';
import { useProposalActions } from './useProposalActions';

const T = themeVars;
const MONO = 'var(--atelier-font-mono, "JetBrains Mono", monospace)';

export const NEEDS_YOU_EMPTY = 'Nothing needs you. Agents never write; when one needs something, it shows here.';

export interface NeedsYouHandlers {
  /** The user's ordinary connect action. */
  onOpenConnection: (connectionId: string) => void;
  onNotNow: (item: ConnectionRequestItem) => void;
  /** Review: open the Proposal with its reasons and check. */
  onReview: (item: ProposalItem) => void;
}

/** The sentence of a Connection request (X30 §8). Every name in it came from elsewhere: text only. */
export function RequestSentence({ item }: { item: ConnectionRequestItem }) {
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

/** The sentence of a Proposal (X30 §8). Agent-supplied names: text only. */
export function ProposalSentence({ item }: { item: ProposalItem }) {
  return (
    <>
      <b>{item.agent}</b>
      {item.rest} a Reference Rule <code style={{ fontFamily: MONO, overflowWrap: 'anywhere' }}>{item.pair}</code>
    </>
  );
}

function IconTile({ kind }: { kind: NeedsYouItem['kind'] }) {
  const request = kind === 'connection-request';
  return (
    <span
      aria-hidden
      style={{
        width: 28,
        height: 28,
        borderRadius: T.rs,
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: request ? T.warnSoft : T.accentSoft,
        color: request ? T.warn : T.accentInk,
      }}
    >
      {request ? <IconPlugConnectedX size={14} stroke={1.5} /> : <IconLink size={14} stroke={1.5} />}
    </span>
  );
}

function Row({ item, first, sentence, actions }: { item: NeedsYouItem; first: boolean; sentence: React.ReactNode; actions: React.ReactNode }) {
  return (
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: '28px minmax(0,1fr) auto',
        gap: themeVars.gapMd,
        alignItems: 'center',
        padding: '12px 16px',
        borderTop: first ? undefined : `1px solid ${T.border}`,
      }}
    >
      <IconTile kind={item.kind} />
      <div style={{ minWidth: 0 }}>
        <div style={{ fontSize: T.fsMd, overflowWrap: 'anywhere' }}>{sentence}</div>
        <div style={{ fontSize: T.fsSm, color: T.textGhost, marginTop: 2, overflowWrap: 'anywhere' }}>{item.meta}</div>
      </div>
      <div style={{ display: 'flex', gap: themeVars.gapXs, alignItems: 'center', flexWrap: 'wrap', justifyContent: 'flex-end' }}>{actions}</div>
    </div>
  );
}

function RequestRow({ item, handlers, first }: { item: ConnectionRequestItem; handlers: NeedsYouHandlers; first: boolean }) {
  return (
    <li data-testid="needs-you-request">
      <Row
        item={item}
        first={first}
        sentence={<RequestSentence item={item} />}
        actions={
          <>
            <Button size="compact-sm" onClick={() => handlers.onOpenConnection(item.connectionId)}>
              Open {item.connectionName}
            </Button>
            <Button size="compact-sm" variant="subtle" color="gray" onClick={() => handlers.onNotNow(item)}>
              Not now
            </Button>
          </>
        }
      />
    </li>
  );
}

function ProposalRow({
  item,
  handlers,
  first,
  open,
}: {
  item: ProposalItem;
  handlers: NeedsYouHandlers;
  first: boolean;
  /** Reviewed here: the Proposal's card opens under its row. */
  open: boolean;
}) {
  const actions = useProposalActions(item.proposal);
  return (
    <li data-testid={item.status === 'later' ? 'needs-you-later-proposal' : 'needs-you-proposal'} data-proposal-id={item.proposal.id}>
      <Row
        item={item}
        first={first}
        sentence={<ProposalSentence item={item} />}
        actions={
          <>
            <Button size="compact-sm" aria-expanded={open} onClick={() => handlers.onReview(item)}>
              Review
            </Button>
            {item.status === 'later' ? (
              <Button size="compact-sm" variant="subtle" color="gray" disabled={actions.busy} onClick={() => void actions.reopen()}>
                Move back
              </Button>
            ) : (
              <Button size="compact-sm" variant="subtle" color="gray" disabled={actions.busy} onClick={() => void actions.decline()}>
                Decline
              </Button>
            )}
          </>
        }
      />
      {open && (
        <div style={{ padding: '0 16px 12px 56px' }}>
          <ProposalCard proposal={item.proposal} />
        </div>
      )}
    </li>
  );
}

function ItemRow({ item, handlers, first, reviewing }: { item: NeedsYouItem; handlers: NeedsYouHandlers; first: boolean; reviewing: string | null }) {
  return item.kind === 'connection-request' ? (
    <RequestRow item={item} handlers={handlers} first={first} />
  ) : (
    <ProposalRow item={item} handlers={handlers} first={first} open={reviewing === item.proposal.id} />
  );
}

/**
 * Needs you (X30 §8): one list model for Home, a session page and the toasts.
 * Connection requests and pending Proposals newest first; Later Proposals
 * under a collapsed Later, counted apart from the badge.
 */
export function NeedsYouList({
  items,
  later,
  handlers,
  reviewing = null,
  heading = 'Needs you',
}: {
  items: readonly NeedsYouItem[];
  later: readonly ProposalItem[];
  handlers: NeedsYouHandlers;
  /** The Proposal opened for review in this list, by id. */
  reviewing?: string | null;
  heading?: string;
}) {
  const headingId = React.useId();
  const [laterOpen, setLaterOpen] = React.useState(false);
  // A Proposal opened for review from elsewhere opens its group.
  const reviewingLater = reviewing !== null && later.some((l) => l.proposal.id === reviewing);
  const showLater = laterOpen || reviewingLater;
  return (
    <section
      aria-labelledby={headingId}
      data-testid="needs-you"
      style={{ background: T.surface, border: `1px solid ${T.border}`, borderRadius: T.r, minWidth: 0 }}
    >
      <div style={{ display: 'flex', alignItems: 'center', padding: '12px 16px 4px' }}>
        <h2 id={headingId} style={{ margin: 0, fontSize: T.fsMd, fontWeight: 600, display: 'flex', alignItems: 'center', gap: themeVars.gapSm }}>
          {heading} <NeedsYouBadge count={items.length} />
        </h2>
      </div>
      {items.length === 0 ? (
        <p style={{ margin: 0, padding: '8px 16px 14px', fontSize: T.fsSm, color: T.textMuted }}>{NEEDS_YOU_EMPTY}</p>
      ) : (
        <ul style={{ listStyle: 'none', margin: 0, padding: 0 }}>
          {items.map((item, i) => (
            <ItemRow key={item.key} item={item} handlers={handlers} first={i === 0} reviewing={reviewing} />
          ))}
        </ul>
      )}
      {later.length > 0 && (
        <div style={{ borderTop: `1px solid ${T.border}` }}>
          <UnstyledButton
            aria-expanded={showLater}
            data-testid="needs-you-later-toggle"
            onClick={() => setLaterOpen(!showLater)}
            style={{ display: 'flex', alignItems: 'center', gap: themeVars.gapXs, padding: '8px 16px', fontSize: T.fsSm, color: T.textMuted, width: '100%' }}
          >
            {showLater ? <IconChevronDown size={12} aria-hidden="true" /> : <IconChevronRight size={12} aria-hidden="true" />}
            Later ({later.length})
          </UnstyledButton>
          {showLater && (
            <ul style={{ listStyle: 'none', margin: 0, padding: 0 }}>
              {later.map((item, i) => (
                <ItemRow key={item.key} item={item} handlers={handlers} first={i === 0} reviewing={reviewing} />
              ))}
            </ul>
          )}
        </div>
      )}
    </section>
  );
}
