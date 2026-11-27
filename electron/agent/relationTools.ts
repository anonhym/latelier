import { calculateObjectSize } from 'bson';
import { z } from 'zod';
import { detectCandidateFieldsFromDocs, matchCandidates } from '../services/referenceCandidates.ts';
import { wrap } from './envelope.ts';
import { AgentToolError } from './errorMap.ts';
import { assertTargetAllowed, cutName, filterCollections, isDeniedCollection, isDeniedDatabase } from './namespaceGuard.ts';
import { checked, closeQuietly, LISTING_LIMIT, listingNote, MAX_SAMPLE_BYTES, readOptions, withLease } from './readOps.ts';
import { takeWithinBudget } from './resultBudget.ts';
import type { ToolContext, ToolOutcome } from './tools.ts';

/** X27 §16.7: the relation tools (X05 Reference Rules, X23 Family rules), read-only. */

const name = z.string().min(1).max(256);

/** `suggest_references` reads as many documents as X05 §5 does unless asked for more. */
export const SUGGEST_SAMPLE_DEFAULT = 25;
export const SUGGEST_SAMPLE_MAX = 200;

export const listReferencesInputSchema = z.strictObject({
  connectionId: z.uuid(),
  database: name.optional(),
  collection: name.optional(),
});

export const suggestReferencesInputSchema = z.strictObject({
  connectionId: z.uuid(),
  database: name,
  collection: name,
  sampleSize: z.number().int().min(1).max(SUGGEST_SAMPLE_MAX).default(SUGGEST_SAMPLE_DEFAULT),
});

export type ListReferencesInput = z.infer<typeof listReferencesInputSchema>;
export type SuggestReferencesInput = z.infer<typeof suggestReferencesInputSchema>;

const RULE_NOUN = { one: 'rule', many: 'rules' };

/**
 * The Connection's effective rules: its own, then its Family's it does not
 * override. No Mongo call, but the gate still runs, so a closed Connection is
 * refused (or paused) like any other call that names one. A rule with either
 * end in a §7.4 namespace is left out: an Agent never learns of those.
 */
export async function runListReferences(input: ListReferencesInput, ctx: ToolContext): Promise<ToolOutcome> {
  if (input.database !== undefined && isDeniedDatabase(input.database)) throw new AgentToolError('NAMESPACE_DENIED');
  if (input.collection !== undefined && isDeniedCollection(input.collection)) throw new AgentToolError('NAMESPACE_DENIED');
  ctx.gate.assertConnection(input.connectionId);
  const rules = ctx.refs
    .effective(input.connectionId)
    .filter((r) => input.database === undefined || r.sourceDb === input.database)
    .filter((r) => input.collection === undefined || r.sourceCollection === input.collection)
    .filter(
      (r) =>
        !isDeniedDatabase(r.sourceDb) &&
        !isDeniedCollection(r.sourceCollection) &&
        !isDeniedDatabase(r.targetDb) &&
        !isDeniedCollection(r.targetCollection),
    )
    .map((r) => ({
      sourceDb: cutName(r.sourceDb),
      sourceCollection: cutName(r.sourceCollection),
      sourceField: cutName(r.sourceField),
      targetDb: cutName(r.targetDb),
      targetCollection: cutName(r.targetCollection),
      targetField: cutName(r.targetField),
      enabled: r.enabled,
    }));
  const result = await takeWithinBudget(rules, { limit: LISTING_LIMIT });
  return {
    text: wrap(result.json, { truncationNote: listingNote(result.count, result.appliedLimits, RULE_NOUN) }),
    count: result.count,
    truncated: result.truncated,
    appliedLimits: result.appliedLimits,
  };
}

/**
 * X05 §5's heuristic on the agent client. It never goes through
 * `ReferenceRulesService.autodetect`, whose handle comes from
 * `MongoPool.readDb` and would connect a closed Connection. Every read here
 * goes through the gate's lease, with §6.4's time limit and comment; a failed
 * read is an error code, never an empty list, which would read as "no
 * relations here".
 */
export function runSuggestReferences(input: SuggestReferencesInput, ctx: ToolContext): Promise<ToolOutcome> {
  assertTargetAllowed(input.database, input.collection);
  return withLease(input, ctx, async (lease) => {
    const db = lease.client.db(input.database);
    const listed = await db
      .listCollections({}, { ...readOptions, nameOnly: true, authorizedCollections: true, signal: lease.signal })
      .toArray();
    lease.assertStill();
    // A system.* collection is never offered as a target.
    const collectionNames = new Set(filterCollections(listed.map((c) => c.name)));
    const cursor = db
      .collection(input.collection)
      .find({}, { ...readOptions, limit: input.sampleSize, signal: lease.signal });
    const docs: unknown[] = [];
    let bytes = 0;
    let cutByBytes = false;
    try {
      for await (const doc of checked(cursor, lease.assertStill)) {
        bytes += calculateObjectSize(doc);
        if (bytes > MAX_SAMPLE_BYTES) {
          cutByBytes = true;
          break;
        }
        docs.push(doc);
      }
    } finally {
      await closeQuietly(cursor, ctx);
    }
    lease.assertStill();
    const existing = new Set(ctx.refs.effective(input.connectionId, input.database, input.collection).map((r) => r.sourceField));
    const candidates = matchCandidates(
      detectCandidateFieldsFromDocs(docs, input.sampleSize),
      collectionNames,
      input.database,
      existing,
    ).map((c) => ({
      sourceField: cutName(c.sourceField),
      targetDb: cutName(c.targetDb),
      targetCollection: cutName(c.targetCollection),
      targetField: c.targetField,
      alreadyConfigured: c.alreadyConfigured,
    }));
    const result = await takeWithinBudget(candidates, { limit: LISTING_LIMIT });
    const noun = docs.length === 1 ? 'document' : 'documents';
    const cuts: string[] = [];
    if (cutByBytes) cuts.push('the sample hit its size limit');
    if (result.appliedLimits.includes('limit')) cuts.push('more candidates exist than are shown');
    if (result.appliedLimits.includes('bytes')) cuts.push('the answer hit the 1 MiB size limit');
    const note =
      `Suggested from ${docs.length} sampled ${noun} (up to ${input.sampleSize} requested): ${result.count} candidate` +
      `${result.count === 1 ? '' : 's'}, matched by field name only. A candidate is not verified against the data.` +
      (cuts.length === 0 ? '' : ` Incomplete: ${cuts.join(' and ')}.`);
    const applied = cutByBytes && !result.appliedLimits.includes('bytes') ? [...result.appliedLimits, 'bytes' as const] : result.appliedLimits;
    return {
      text: wrap(result.json, { truncationNote: note }),
      // What was read from the database, which is what the Agent Read Log counts.
      count: docs.length,
      truncated: applied.length > 0,
      appliedLimits: applied,
    };
  });
}
