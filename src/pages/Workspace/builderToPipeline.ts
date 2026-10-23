import type { CollectionTabState, Stage } from '@shared/types';
import { compileFindOptions, findProblem, parseSortString } from './builder';
import { ejsonParse } from '../../utils/ejson';

/**
 * `$sort` takes only 1, -1 or `{ $meta }`, where a find sort also takes
 * "asc"/"desc"; those are rewritten to their number. A sort without one is
 * kept verbatim. Only runs past `sortProblem`, so every string is a direction.
 */
function stageSort(sort: string): string {
  const parsed = ejsonParse<Record<string, unknown>>(sort);
  if (!Object.values(parsed).some((v) => typeof v === 'string')) return sort;
  const dirs = parseSortString(sort);
  return JSON.stringify(
    Object.fromEntries(
      Object.entries(parsed).map(([k, v]) => [k, typeof v === 'string' ? dirs[k] : v]),
    ),
  );
}

export type StagesResult = { ok: true; stages: Stage[] } | { ok: false; problem: string };

/**
 * The builder's query as aggregation stages: `$match`, `$sort`, `$limit`,
 * `$project`, in the order the find applies them. Refused through the same
 * `findProblem` gate as Run and Copy code.
 *
 * Bodies are the builder's own text, never re-serialized, so a Long or an
 * ObjectId reaches the pipeline byte-for-byte. The limit is the user's cap
 * (`builder.limit`), not the page's: the page skip/limit is how the table
 * pages the result, not part of the query.
 */
export function builderToStages(state: CollectionTabState): StagesResult {
  const problem = findProblem(state);
  if (problem) return { ok: false, problem };
  const opts = compileFindOptions(state.builder);
  const bodies: [string, string][] = [];
  if (state.queryRaw.trim() !== '{}') bodies.push(['$match', state.queryRaw]);
  if (opts.sort) bodies.push(['$sort', stageSort(opts.sort)]);
  if (opts.limit !== null) bodies.push(['$limit', String(opts.limit)]);
  if (opts.projection) bodies.push(['$project', opts.projection]);
  return {
    ok: true,
    stages: bodies.map(([op, body], i) => ({ id: i + 1, op, body, enabled: true })),
  };
}
