import { Button, Loader } from '@mantine/core';
import { IconLink } from '@tabler/icons-react';
import { themeVars } from '../../theme/themeVars';
import type { AgentProposal, AgentProposalCheck } from '@shared/types';
import { ago } from './agentsTime';
import { addLabel, backerLine, checkSegments, checkTone, proposalPairText, proposalWho, reasonLabel } from './proposalView';
import { useFamilyOf, useProposalCheck, type ProposalActions } from './useProposalActions';
import { useNow } from './useNow';

const T = themeVars;
const MONO = 'var(--atelier-font-mono, "JetBrains Mono", monospace)';

/** The pair in code style. Agent-supplied names: text only. */
export function ProposalPair({ proposal, size }: { proposal: AgentProposal; size?: string }) {
  return (
    <code style={{ fontFamily: MONO, fontSize: size ?? T.fsMd, fontWeight: 600, overflowWrap: 'anywhere' }}>{proposalPairText(proposal)}</code>
  );
}

/** The check's result as a pill: green when a sample resolved, warning when none did. */
export function CheckPill({ check, failed }: { check: AgentProposalCheck | null; failed: boolean }) {
  if (!check) {
    return (
      <span data-testid="proposal-check" style={{ fontSize: T.fsSm, color: T.textMuted, display: 'inline-flex', alignItems: 'center', gap: themeVars.gapXs }}>
        {failed ? (
          'Could not check this relation.'
        ) : (
          <>
            <Loader size={10} aria-hidden="true" /> Checking…
          </>
        )}
      </span>
    );
  }
  const tone = checkTone(check);
  const colors =
    tone === 'ok'
      ? { background: T.greenSoft, borderColor: T.greenBorder, color: T.greenText }
      : tone === 'warn'
        ? { background: T.warnSoft, borderColor: T.warnBorder, color: T.warnText }
        : { background: 'transparent', borderColor: T.borderMed, color: T.textMuted };
  return (
    <span
      data-testid="proposal-check"
      data-tone={tone}
      style={{ fontSize: T.fsSm, borderRadius: 10, padding: '1px 8px', border: '1px solid', overflowWrap: 'anywhere', ...colors }}
    >
      {checkSegments(check).map((s, i) =>
        s.code ? (
          <code key={i} style={{ fontFamily: MONO }}>
            {s.text}
          </code>
        ) : (
          <span key={i}>{s.text}</span>
        ),
      )}
    </span>
  );
}

/**
 * Each backer, first first, with its reason in its own words: plain text in a
 * quoted style, its line breaks kept, never Markdown or HTML, never a link.
 */
export function ProposalReasons({ proposal, withBackers }: { proposal: AgentProposal; withBackers: boolean }) {
  const now = useNow();
  return (
    <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: themeVars.gapXs }}>
      {proposal.backers.map((b) => (
        <li key={b.tokenId} data-testid="proposal-backer" style={{ minWidth: 0 }}>
          {withBackers && (
            <div style={{ fontSize: T.fsSm, color: T.textGhost, marginBottom: 3, overflowWrap: 'anywhere' }}>
              {backerLine(b)} · {ago(b.createdAt, now)}
            </div>
          )}
          {b.reason !== null && (
            <figure
              data-testid="proposal-reason"
              style={{
                margin: 0,
                fontSize: T.fsSm,
                color: T.textMuted,
                border: `1px dashed ${T.borderMed}`,
                background: T.surface,
                borderRadius: T.rs,
                padding: '6px 8px',
              }}
            >
              <figcaption style={{ fontSize: T.fsXs, color: T.textGhost, marginBottom: 2 }}>{reasonLabel(b)}</figcaption>
              <blockquote style={{ margin: 0, whiteSpace: 'pre-wrap', overflowWrap: 'anywhere', fontStyle: 'italic' }}>{b.reason}</blockquote>
            </figure>
          )}
        </li>
      ))}
    </ul>
  );
}

/** Add Reference Rule (or Add anyway), Save for the Family, Not now or Move back, Never for this pair. */
export function ProposalDecisions({
  proposal,
  actions,
  check,
  order,
}: {
  proposal: AgentProposal;
  /** The surface's one set of actions, so a decision in flight holds every other way out. */
  actions: ProposalActions;
  check: AgentProposalCheck | null;
  /** The strip reads right to left (Never, Not now, Add); a card left to right. */
  order: 'card' | 'strip';
}) {
  const family = useFamilyOf(proposal.connectionId);
  const add = (
    <Button key="add" size="compact-sm" disabled={actions.busy} onClick={() => void actions.accept('connection')}>
      {addLabel(check)}
    </Button>
  );
  const forFamily = family && (
    <Button key="family" size="compact-sm" variant="default" disabled={actions.busy} onClick={() => void actions.accept('family')}>
      Save for the Family
    </Button>
  );
  const notNow =
    proposal.status === 'later' ? (
      <Button key="back" size="compact-sm" variant="default" disabled={actions.busy} onClick={() => void actions.reopen()}>
        Move back
      </Button>
    ) : (
      <Button key="later" size="compact-sm" variant="default" disabled={actions.busy} onClick={() => void actions.later()}>
        Not now
      </Button>
    );
  const never = (
    <Button key="never" size="compact-sm" variant="subtle" color="gray" disabled={actions.busy} onClick={() => void actions.decline()}>
      Never for this pair
    </Button>
  );
  const buttons = order === 'card' ? [add, forFamily, notNow, never] : [never, notNow, forFamily, add];
  return <div style={{ display: 'flex', flexWrap: 'wrap', gap: themeVars.gapXs, alignItems: 'center' }}>{buttons}</div>;
}

/**
 * A Proposal opened for review (X28 §5–§6): who proposes what, their words,
 * the check (asked for now that it is open), and the decision.
 */
export function ProposalCard({ proposal, actions }: { proposal: AgentProposal; actions: ProposalActions }) {
  const { check, failed } = useProposalCheck(proposal.id);
  const who = proposalWho(proposal);
  return (
    <section
      aria-label="Agent proposal"
      data-testid="proposal-card"
      data-proposal-id={proposal.id}
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: themeVars.gapSm,
        padding: '12px 14px',
        borderRadius: T.r,
        border: `1px solid ${T.accentBorder}`,
        background: T.accentSoft,
        minWidth: 0,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: themeVars.gapSm, fontSize: T.fsMd, overflowWrap: 'anywhere' }}>
        <IconLink size={14} aria-hidden="true" style={{ color: T.accentInk, flexShrink: 0, marginTop: 3 }} />
        <span>
          <b>{who.agent}</b>
          {who.rest} a Reference Rule: <ProposalPair proposal={proposal} />
        </span>
      </div>
      <div style={{ fontSize: T.fsSm, color: T.textGhost }}>On {proposal.connectionName}</div>
      <ProposalReasons proposal={proposal} withBackers />
      <div>
        <CheckPill check={check} failed={failed} />
      </div>
      <ProposalDecisions proposal={proposal} actions={actions} check={check} order="card" />
    </section>
  );
}
