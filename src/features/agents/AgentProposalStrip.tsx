import type React from 'react';
import { IconLink } from '@tabler/icons-react';
import { themeVars } from '../../theme/themeVars';
import { useReferenceSuggestion } from '../../state/referenceDiscovery';
import type { AgentProposal } from '@shared/types';
import { CheckPill, ProposalDecisions, ProposalPair, ProposalReasons } from './ProposalCard';
import { proposalWho, proposalsForTab } from './proposalView';
import { useOpenProposals } from './proposalStore';
import { useProposalActions, useProposalCheck } from './useProposalActions';

const T = themeVars;

/**
 * An Agent's Proposal on the collection it is about (X28 §7), in the strip
 * under the Filter Bar. One strip per tab: a discovery suggestion from the
 * user's own copy takes it first, and the Proposal waits in Needs you until
 * the strip is free. Several Proposals show one at a time, oldest first.
 */
export function AgentProposalStrip({
  tabId,
  connectionId,
  dbName,
  collection,
}: {
  tabId: string;
  connectionId: string;
  dbName: string;
  collection: string;
}) {
  const suggestion = useReferenceSuggestion(tabId);
  const { list } = useOpenProposals();
  if (suggestion) return null;
  const proposal = proposalsForTab(list, { connectionId, dbName, collection })[0];
  if (!proposal) return null;
  // Keyed: the next Proposal gets its own check and its own busy state.
  return <StripBody key={proposal.id} proposal={proposal} />;
}

function StripBody({ proposal }: { proposal: AgentProposal }) {
  const { check, failed } = useProposalCheck(proposal.id);
  const actions = useProposalActions(proposal);
  const who = proposalWho(proposal);
  // Escape is Not now, as on X26's strip; it stops here so nothing behind the strip takes it too.
  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key !== 'Escape') return;
    e.stopPropagation();
    if (!actions.busy) void actions.later();
  };
  return (
    <section
      aria-label="Agent proposal"
      data-testid="agent-proposal-strip"
      data-proposal-id={proposal.id}
      onKeyDown={onKeyDown}
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: themeVars.gapXs,
        padding: '6px 12px',
        fontSize: T.fsSm,
        background: T.accentSoft,
        borderTop: `1px solid ${T.accentBorder}`,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: themeVars.gapSm }}>
        <IconLink size={13} aria-hidden="true" style={{ color: T.accentInk, flexShrink: 0 }} />
        <span style={{ flex: '1 1 auto', minWidth: 0, overflowWrap: 'anywhere' }}>
          <b>{who.agent}</b>
          {who.rest} a Reference Rule: <ProposalPair proposal={proposal} size={T.fsSm} />
        </span>
        <CheckPill check={check} failed={failed} />
        <ProposalDecisions proposal={proposal} check={check} order="strip" />
      </div>
      <ProposalReasons proposal={proposal} withBackers={proposal.backers.length > 1} />
    </section>
  );
}
