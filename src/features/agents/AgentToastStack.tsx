import React from 'react';
import { Button, CloseButton } from '@mantine/core';
import { IconLink, IconPlugConnectedX } from '@tabler/icons-react';
import { themeVars } from '../../theme/themeVars';
import type { AgentAccessState, AgentProposal } from '@shared/types';
import { INITIAL_TOASTS, foldTitle, hideRequestToasts, hideToast, stepToasts, toastCards, type ToastState } from './agentToasts';
import { needsYouItems, type ConnectionRequestItem, type ProposalItem } from './needsYou';
import { ProposalSentence, RequestSentence } from './NeedsYouList';
import { useProposalActions } from './useProposalActions';
import { useNow } from './useNow';

const T = themeVars;

export interface AgentToastHandlers {
  /** The user's ordinary connect action. */
  onOpenConnection: (connectionId: string) => void;
  onViewSession: (item: ConnectionRequestItem) => void;
  /** Switches to Agents mode on the Proposal. */
  onReview: (item: ProposalItem) => void;
  onOpenAgents: () => void;
}

function Card({
  tone,
  icon,
  title,
  sub,
  onDismiss,
  children,
  testId,
}: {
  tone: 'warn' | 'accent';
  icon: React.ReactNode;
  title: React.ReactNode;
  sub: React.ReactNode;
  onDismiss: () => void;
  children: React.ReactNode;
  testId: string;
}) {
  return (
    <div
      role="status"
      data-testid={testId}
      style={{
        pointerEvents: 'auto',
        display: 'flex',
        flexDirection: 'column',
        gap: themeVars.gapSm,
        padding: '12px 14px',
        background: T.surface,
        border: `1px solid ${tone === 'warn' ? T.warnBorder : T.border}`,
        borderRadius: T.r,
        boxShadow: T.shadowLg,
      }}
    >
      <div style={{ display: 'grid', gridTemplateColumns: '24px minmax(0,1fr) 20px', gap: themeVars.gapSm, alignItems: 'start' }}>
        <span
          aria-hidden
          style={{
            width: 24,
            height: 24,
            borderRadius: T.rs,
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            background: tone === 'warn' ? T.warnSoft : T.accentSoft,
            color: tone === 'warn' ? T.warn : T.accentInk,
          }}
        >
          {icon}
        </span>
        <div style={{ minWidth: 0 }}>
          <div style={{ fontSize: T.fsMd, overflowWrap: 'anywhere' }}>{title}</div>
          <div style={{ fontSize: T.fsSm, color: T.textMuted, marginTop: 2, overflowWrap: 'anywhere' }}>{sub}</div>
        </div>
        <CloseButton size="sm" aria-label="Dismiss" onClick={onDismiss} />
      </div>
      <div style={{ display: 'flex', gap: themeVars.gapXs, paddingLeft: 32, flexWrap: 'wrap' }}>{children}</div>
    </div>
  );
}

function ProposalToast({ item, hide, onReview }: { item: ProposalItem; hide: () => void; onReview: (item: ProposalItem) => void }) {
  const actions = useProposalActions(item.proposal);
  return (
    <Card tone="accent" icon={<IconLink size={13} />} title={<ProposalSentence item={item} />} sub={item.meta} onDismiss={hide} testId="agent-toast-proposal">
      <Button
        size="compact-sm"
        onClick={() => {
          hide();
          onReview(item);
        }}
      >
        Review
      </Button>
      {/* Later: the Proposal leaves the toasts and waits under Later in Needs you. */}
      <Button size="compact-sm" variant="subtle" color="gray" disabled={actions.busy} onClick={() => void actions.later()}>
        Later
      </Button>
    </Card>
  );
}

/**
 * Agent toasts in Databases mode (X30 §10.1): one per new Needs you item,
 * newest on top, bottom right above the status bar. A request toast stays
 * until it is acted on or dismissed; dismissing hides it only, the badge
 * keeps it. From the fourth request they fold into one. Nothing shows in
 * Agents mode. Each toast is a status line and never takes the focus.
 */
export function AgentToastStack({
  state,
  proposals,
  proposalsLoaded,
  agentsMode,
  handlers,
}: {
  state: AgentAccessState | null;
  proposals: readonly AgentProposal[];
  proposalsLoaded: boolean;
  agentsMode: boolean;
  handlers: AgentToastHandlers;
}) {
  const now = useNow();
  const items = needsYouItems(state, now, proposals, state?.sessions ?? []);
  const [toasts, setToasts] = React.useState<ToastState>(INITIAL_TOASTS);
  // Stepped while rendering: the step returns the same state when nothing changed, so this settles.
  const next = stepToasts(toasts, { items, agentsMode, proposalsLoaded });
  if (next !== toasts) setToasts(next);
  const cards = toastCards(next, items, agentsMode);
  const hide = (key: string) => setToasts((s) => hideToast(s, key));

  return (
    <div
      role="region"
      aria-label="Agent requests"
      data-testid="agent-toasts"
      style={{
        position: 'fixed',
        right: 20,
        bottom: 40,
        width: 380,
        maxWidth: 'calc(100vw - 40px)',
        display: 'flex',
        flexDirection: 'column',
        gap: themeVars.gapSm,
        zIndex: 300,
        pointerEvents: 'none',
      }}
    >
      {cards.map((card) => {
        if (card.kind === 'fold') {
          return (
            <Card
              key={card.key}
              tone="warn"
              icon={<IconPlugConnectedX size={13} />}
              title={<b>{foldTitle(card.count)}</b>}
              sub="Agents asked for Connections that are shared but not open."
              onDismiss={() => setToasts((s) => hideRequestToasts(s, items))}
              testId="agent-toast-fold"
            >
              <Button
                size="compact-sm"
                onClick={() => {
                  setToasts((s) => hideRequestToasts(s, items));
                  handlers.onOpenAgents();
                }}
              >
                Open Agents
              </Button>
            </Card>
          );
        }
        if (card.kind === 'proposal') {
          return <ProposalToast key={card.key} item={card.item} hide={() => hide(card.key)} onReview={handlers.onReview} />;
        }
        const item = card.item;
        return (
          <Card
            key={card.key}
            tone="warn"
            icon={<IconPlugConnectedX size={13} />}
            title={<RequestSentence item={item} />}
            sub={item.meta}
            onDismiss={() => hide(card.key)}
            testId="agent-toast-request"
          >
            <Button
              size="compact-sm"
              onClick={() => {
                hide(card.key);
                handlers.onOpenConnection(item.connectionId);
              }}
            >
              Open {item.connectionName}
            </Button>
            <Button
              size="compact-sm"
              variant="subtle"
              color="gray"
              onClick={() => {
                hide(card.key);
                handlers.onViewSession(item);
              }}
            >
              View session
            </Button>
          </Card>
        );
      })}
    </div>
  );
}
