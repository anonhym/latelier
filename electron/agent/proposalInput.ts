import { z } from 'zod';
import { pairKey, type RulePair } from '../../src/utils/referenceDiscovery.ts';
import { MAX_NAME } from '../services/familyExportFormat.ts';
import { AgentToolError, defaultAgentMessage } from './errorMap.ts';
import { hasUnsafeChars } from './safeText.ts';

/**
 * The input of the two Proposal tools (X28 §4). The schema checks only the
 * shape: the field path rules are check 3 of `propose_reference_rule`, after
 * the gates and the namespace check, so a malformed path on a closed
 * Connection still reports the Connection first.
 */

/** The longest name or field path a Proposal holds: what a saved Reference Rule accepts, so an accepted Proposal always fits one. */
export const MAX_FIELD_PATH = MAX_NAME;
/** The two control characters a reason may hold, to lay out plain text over lines. */
const REASON_LAYOUT = /[\n\t]/g;

/** The longest reason an Agent may give. */
export const MAX_REASON = 500;
/** A bound on what the schema accepts before check 3 refuses it: no Agent input is unbounded. */
const MAX_RAW_FIELD = 4096;

const name = z.string().min(1).max(MAX_NAME);
const field = z.string().max(MAX_RAW_FIELD);

export const proposeInputSchema = z.strictObject({
  connectionId: z.uuid(),
  sourceDb: name,
  sourceCollection: name,
  sourceField: field,
  targetDb: name,
  targetCollection: name,
  targetField: field.default('_id'),
  reason: z.string().min(1).max(MAX_REASON),
});

export const getProposalInputSchema = z.strictObject({
  proposalId: z.uuid(),
});

export type ProposeInput = z.infer<typeof proposeInputSchema>;
export type GetProposalInput = z.infer<typeof getProposalInputSchema>;

/** An all-digit segment is an array index, which names no field (X26 §1). */
const ALL_DIGITS = /^\d+$/;

/** Why `path` cannot name a field, or null when it can. Never quotes the path. */
export function fieldPathProblem(path: string): string | null {
  if (path.length === 0 || path.length > MAX_FIELD_PATH) return `must be 1 to ${MAX_FIELD_PATH} characters`;
  for (const segment of path.split('.')) {
    if (segment === '') return 'has an empty segment';
    if (segment.startsWith('$')) return 'has a segment that starts with $';
    if (ALL_DIGITS.test(segment)) return 'has an array index as a segment';
  }
  return null;
}

function refuse(key: string, problem: string): never {
  throw new AgentToolError('INVALID_INPUT', `${defaultAgentMessage('INVALID_INPUT')} ${key}: ${problem}`);
}

/**
 * Check 3: both field paths name a field, no name or the reason carries a
 * character that could disguise what the user reads (a reason may still hold
 * line feeds and tabs), and the pair does not
 * point a field at itself. Throws INVALID_INPUT naming the argument, never its value.
 */
export function assertProposalFields(input: PairFields & Pick<ProposeInput, 'reason'>): void {
  for (const key of ['sourceField', 'targetField'] as const) {
    const problem = fieldPathProblem(input[key]);
    if (problem !== null) refuse(key, problem);
  }
  // Every one of these is shown to the user: a bidi override or a line separator would let the Agent reorder or forge what they read.
  for (const key of ['sourceDb', 'sourceCollection', 'sourceField', 'targetDb', 'targetCollection', 'targetField'] as const) {
    if (hasUnsafeChars(input[key])) refuse(key, 'has a control, format or separator character');
  }
  // The reason is plain text that may span lines, shown as such: a line feed and a tab are its only control characters.
  if (hasUnsafeChars(input.reason.replace(REASON_LAYOUT, ''))) refuse('reason', 'has a control, format or separator character');
  if (
    input.sourceDb === input.targetDb &&
    input.sourceCollection === input.targetCollection &&
    input.sourceField === input.targetField
  ) {
    throw new AgentToolError('INVALID_INPUT', `${defaultAgentMessage('INVALID_INPUT')} the source and target are the same field`);
  }
}

type PairFields = Pick<ProposeInput, 'sourceDb' | 'sourceCollection' | 'sourceField' | 'targetDb' | 'targetCollection' | 'targetField'>;

/** The pair in X26's shape. */
export function proposalPair(input: PairFields): RulePair {
  return {
    source: { dbName: input.sourceDb, collection: input.sourceCollection, field: input.sourceField },
    target: { dbName: input.targetDb, collection: input.targetCollection, field: input.targetField },
  };
}

/**
 * The Proposal's pair key: X26's own `pairKey`, so Never for this pair, the
 * discovery strip and the one-open-Proposal-per-pair rule all read one key.
 */
export function proposalPairKey(connectionId: string, input: PairFields): string {
  return pairKey(connectionId, proposalPair(input));
}
