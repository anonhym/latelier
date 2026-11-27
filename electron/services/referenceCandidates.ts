import type { ReferenceAutodetectCandidate } from '@shared/types';

/**
 * X05 §5's naming heuristic, with no database handle: the sampled documents
 * and the collection list come in, candidate rules go out. The user's
 * Reference Rules editor (`ReferenceRulesService.autodetect`, on the user's own
 * client) and the Agent's `suggest_references` (on the agent client) both
 * use it, so the two can never disagree on what a candidate is.
 */

/** How many sampled documents the walk reads unless told otherwise: X05 §5's sample. */
export const DEFAULT_CANDIDATE_DOCS = 25;

/** Array elements read per array: enough to see a reference field, without walking a huge array. */
const ARRAY_ELEMENTS_READ = 3;

/** Convert `"contacts"` → `"contact"` using a few forgiving rules. */
export function singularize(word: string): string {
  if (word.length <= 2) return word;
  if (word.endsWith('ies')) return word.slice(0, -3) + 'y';
  if (word.endsWith('ses')) return word.slice(0, -2);
  if (word.endsWith('s')) return word.slice(0, -1);
  return word;
}

export function pluralize(word: string): string {
  if (word.endsWith('s')) return word;
  if (word.endsWith('y') && !/[aeiou]y$/.test(word)) return word.slice(0, -1) + 'ies';
  return word + 's';
}

/**
 * Find candidate reference fields by naming convention. Matches:
 *   - `<stem>_id`   → collection `<plural(stem)>`
 *   - `<stem>Id`    → collection `<plural(stem)>`
 * Returns one candidate per unique source field, from the first `limit`
 * documents. The caller checks the target collection exists before offering it.
 */
export function detectCandidateFieldsFromDocs(
  sampleDocs: unknown[],
  limit = DEFAULT_CANDIDATE_DOCS,
): Array<{ sourceField: string; stem: string }> {
  const seen = new Map<string, string>();
  const walk = (obj: unknown, prefix: string): void => {
    if (obj === null || obj === undefined) return;
    if (Array.isArray(obj)) {
      for (const item of obj.slice(0, ARRAY_ELEMENTS_READ)) walk(item, prefix);
      return;
    }
    if (typeof obj !== 'object') return;
    for (const [key, val] of Object.entries(obj as Record<string, unknown>)) {
      const path = prefix ? `${prefix}.${key}` : key;
      if (key === '_id') continue;
      const stem = /^(.+)_id$/.exec(key)?.[1] ?? /^(.+)Id$/.exec(key)?.[1];
      if (stem && !seen.has(path)) seen.set(path, stem);
      // Recurse one level, skipping EJSON sentinels like {$oid, $date}.
      if (!prefix && val && typeof val === 'object' && !Array.isArray(val)) {
        const keys = Object.keys(val);
        if (!keys.some((k) => k.startsWith('$'))) walk(val, path);
      }
    }
  };
  for (const doc of sampleDocs.slice(0, limit)) walk(doc, '');
  return [...seen.entries()].map(([sourceField, stem]) => ({ sourceField, stem }));
}

/** The collection names a stem may point at, most likely first, without repeats. */
export function stemGuesses(stem: string): string[] {
  return [...new Set([pluralize(stem), stem, pluralize(singularize(stem))])];
}

/**
 * Pairs each candidate field with the first collection its stem names, in
 * `stemGuesses` order. A candidate whose stem names no collection in
 * `collectionNames` is dropped; the target field is always `_id`.
 */
export function matchCandidates(
  candidates: ReadonlyArray<{ sourceField: string; stem: string }>,
  collectionNames: ReadonlySet<string>,
  dbName: string,
  existingSourceFields: ReadonlySet<string>,
): ReferenceAutodetectCandidate[] {
  const out: ReferenceAutodetectCandidate[] = [];
  for (const { sourceField, stem } of candidates) {
    const match = stemGuesses(stem).find((g) => collectionNames.has(g));
    if (match === undefined) continue;
    out.push({
      sourceField,
      targetDb: dbName,
      targetCollection: match,
      targetField: '_id',
      alreadyConfigured: existingSourceFields.has(sourceField),
    });
  }
  return out;
}
