import type { AgentProposal, AgentProposalBacker, AgentProposalCheck } from '@shared/types';

/**
 * The parts every surface shows of a Proposal (X28 §5): the pair, who
 * proposed it, their words, and the check. Every name here came from an
 * Agent: callers render the strings as text only.
 */

type Pair = Pick<AgentProposal, 'sourceDb' | 'sourceCollection' | 'sourceField' | 'targetDb' | 'targetCollection' | 'targetField'>;

/**
 * The pair as X26 writes it, `orders.customerId → customers._id`, with each
 * side's database in front when the two databases differ.
 */
export function proposalPairText(p: Pair): string {
  const withDb = p.sourceDb !== p.targetDb;
  const side = (db: string, coll: string, field: string) => `${withDb ? `${db}.` : ''}${coll}.${field}`;
  return `${side(p.sourceDb, p.sourceCollection, p.sourceField)} → ${side(p.targetDb, p.targetCollection, p.targetField)}`;
}

/** A backer's name, or a stand-in when the token's name was not kept. */
export function backerName(b: Pick<AgentProposalBacker, 'tokenName'> | undefined): string {
  return b?.tokenName || 'An Agent';
}

/** "laptop-claude · claude-code", or the name alone when the client was not reported. */
export function backerLine(b: Pick<AgentProposalBacker, 'tokenName' | 'clientName'>): string {
  return b.clientName ? `${backerName(b)} · ${b.clientName}` : backerName(b);
}

/** The label over a backer's reason. */
export function reasonLabel(b: Pick<AgentProposalBacker, 'tokenName'>): string {
  return `In ${backerName(b)}'s words`;
}

/**
 * Who proposes it: the first backer, and the rest of the sentence's subject
 * and verb. `{ agent: 'laptop-claude', rest: ' and 1 other Agent propose' }`.
 */
export function proposalWho(p: Pick<AgentProposal, 'backers'>): { agent: string; rest: string } {
  const others = Math.max(p.backers.length - 1, 0);
  const agent = backerName(p.backers[0]);
  if (others === 0) return { agent, rest: ' proposes' };
  return { agent, rest: ` and ${others} other ${others === 1 ? 'Agent' : 'Agents'} propose` };
}

/** The session a Review opens: the first backer's, or null when it was not kept. */
export function reviewSessionId(p: Pick<AgentProposal, 'backers'>): string | null {
  return p.backers[0]?.sessionId ?? null;
}

/** One run of the check's sentence; a `code` run is a field name. */
export interface CheckSegment {
  text: string;
  code?: true;
}

/** Why a Proposal that is no longer open has nothing to check. */
const CLOSED_TEXT: Record<Extract<AgentProposalCheck, { kind: 'closed' }>['status'], string> = {
  expired: 'This Proposal expired',
  obsolete: 'A Reference Rule already covers this field',
  accepted: 'This Proposal was added',
  declined: 'This Proposal was declined',
};

/**
 * The check's sentence (X28 §5): "3 of 3 sampled documents in orders
 * resolve", "No sampled document in orders has `customerId`", "Open Shop to
 * check this relation", or why a Proposal no longer open has none. The sentence counts documents and names the
 * collection after "in": a collection's name is not always an English plural
 * to count with.
 */
export function checkSegments(check: AgentProposalCheck): CheckSegment[] {
  if (check.kind === 'not-open') return [{ text: `Open ${check.connectionName} to check this relation` }];
  if (check.kind === 'closed') return [{ text: CLOSED_TEXT[check.status] }];
  if (check.sampled === 0) {
    return [{ text: `No sampled document in ${check.sourceCollection} has ` }, { text: check.sourceField, code: true }];
  }
  const one = check.sampled === 1;
  return [{ text: `${check.resolved} of ${check.sampled} sampled ${one ? 'document' : 'documents'} in ${check.sourceCollection} ${one ? 'resolves' : 'resolve'}` }];
}

/** The check as one line of text, for a tooltip or an accessible name. */
export function checkText(check: AgentProposalCheck): string {
  return checkSegments(check)
    .map((s) => s.text)
    .join('');
}

export type CheckTone = 'ok' | 'warn' | 'neutral';

/** Green when a sample resolved, warning when none did, neutral when nothing was read. */
export function checkTone(check: AgentProposalCheck): CheckTone {
  if (check.kind !== 'sampled') return 'neutral';
  return check.resolved > 0 ? 'ok' : 'warn';
}

/**
 * The accept button's label: "Add anyway" once a check read and none
 * resolved; otherwise, a check not run or not able to read included, "Add
 * Reference Rule". Never a reason to disable the button.
 */
export function addLabel(check: AgentProposalCheck | null): 'Add Reference Rule' | 'Add anyway' {
  return check?.kind === 'sampled' && check.resolved === 0 ? 'Add anyway' : 'Add Reference Rule';
}

/**
 * The Proposals X28 §7's strip may show on a collection tab: `pending`, on the
 * tab's Connection, whose source namespace is the tab's, oldest first.
 */
export function proposalsForTab(
  proposals: readonly AgentProposal[],
  tab: { connectionId: string; dbName: string; collection: string },
): AgentProposal[] {
  return proposals
    .filter(
      (p) =>
        p.status === 'pending' &&
        p.connectionId === tab.connectionId &&
        p.sourceDb === tab.dbName &&
        p.sourceCollection === tab.collection,
    )
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id));
}
