import { assertTargetAllowed } from './namespaceGuard.ts';
import { assertProposalFields, type GetProposalInput, type ProposeInput } from './proposalInput.ts';
import type { ToolContext, ToolOutcome } from './tools.ts';

/** X28 §4: the two Proposal tools. Neither reads a document. */

/** What every accepted proposal call answers, new, joined or repeated alike, so an Agent cannot learn another proposed the pair. */
export const PROPOSED_TEXT = "Proposed. The user will review it in L'Atelier; nothing changes until they accept it.";

/**
 * `propose_reference_rule`, checks in X28 §4.1's order: the gates (a closed
 * shared Connection is refused NOT_OPEN, which the runner may turn into X29's
 * question), both namespaces, the field paths, then the service's checks 4–8.
 * The answer carries only app-written text and the app's own id: no name the
 * Agent sent comes back, so nothing needs the untrusted-data envelope.
 */
export function runProposeReferenceRule(input: ProposeInput, ctx: ToolContext): ToolOutcome {
  ctx.gate.assertConnection(input.connectionId);
  assertTargetAllowed(input.sourceDb, input.sourceCollection);
  assertTargetAllowed(input.targetDb, input.targetCollection);
  assertProposalFields(input);
  const { id } = ctx.proposals.propose(ctx.session, input);
  return { text: `${PROPOSED_TEXT}\n${JSON.stringify({ proposalId: id })}`, count: 1 };
}

/**
 * `get_proposal`: the status, and once accepted who the rule was saved for.
 * Only a backer's token sees it; for any other it reads as unknown. It names
 * no Connection, so no gate but the token's applies, and it reads nothing.
 */
export function runGetProposal(input: GetProposalInput, ctx: ToolContext): ToolOutcome {
  const { status, savedFor } = ctx.proposals.statusFor(ctx.session.tokenId, input.proposalId);
  const body = status === 'accepted' && savedFor !== null ? { proposalId: input.proposalId, status, savedFor } : { proposalId: input.proposalId, status };
  return { text: JSON.stringify(body), count: 1 };
}
