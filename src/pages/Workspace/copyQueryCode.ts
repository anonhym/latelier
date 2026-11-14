import type { CollectionTabState } from '@shared/types';
import { notify } from '../../theme/notifications';
import { copyToClipboard } from '../../utils/clipboard';
import { findCode, type CodeLang } from '../../utils/driverCode';
import { compileFindOptions, effectivePageLimit, findProblem, requireFilterJson } from './builder';

/**
 * Copies `state`'s find as code (W05 §9.5), the builder footer's Copy code and
 * the Run menu's Copy query as… alike. Reproduces the query as actually run,
 * not the user's raw inputs: same skip/limit split `useQueryRunner` computes
 * from the page (`effectivePageLimit`), same projection and sort it hands to
 * `api.query.find` — so the copied command matches the page on screen.
 */
export function copyQueryAsCode(lang: CodeLang, state: CollectionTabState, collection: string): void {
  // Refused through the same `findProblem` the Run button gates on: one
  // rule for "is this query runnable", not a copy-path opinion beside it.
  // An unparseable filter, sort, or raw projection copies nothing rather
  // than verbatim text that won't run — the notification names the
  // clause rather than saying the copy failed, since the clipboard is
  // working fine; the query is not.
  const problem = findProblem(state);
  if (problem) {
    notify.error(`Nothing copied — ${problem}`);
    return;
  }
  const opts = compileFindOptions(state.builder);
  const { skip, limit } = effectivePageLimit(opts.limit, state.page, state.pageSize);
  // A `limit` of 0 means the page is past the user's cap and the runner
  // short-circuits to an empty result (`useQueryRunner.ts:143`) — there is
  // no `find` that reproduces that, so there is nothing to copy.
  //
  // A `.limit(0)` reads to the driver as "no limit", not zero — so
  // emitting one here to represent an exhausted page would paste an
  // *unbounded* cursor while the app itself shows zero rows: a
  // full-collection scan hiding behind code that looks like it matches
  // the screen. Refused, like every other unrunnable state above it,
  // rather than emitted with an explanatory comment attached — a comment
  // does not disarm the expression in front of it.
  if (limit <= 0) {
    notify.error(
      'Nothing copied — this page is past the limit, so the query returns no documents.',
    );
    return;
  }
  // `findProblem` passing means every clause is already strict JSON — the
  // filter once trimmed of the Unicode spaces the gate allows around it,
  // which `requireFilterJson` does — so there is no Shell Syntax left to
  // repair here. Canonical EJSON is still
  // not shell syntax (`{"$oid": …}` pasted into mongosh is an unknown
  // operator): `findCode` routes such a document through EJSON.parse.
  //
  // A clause the gates above let through but `findCode` cannot write is a
  // bug in one of the two; from a menu click it would otherwise surface as
  // an uncaught page error with nothing copied and nothing said.
  const filter = requireFilterJson(state);
  let code: string;
  try {
    code = findCode(lang, {
      collection,
      filter,
      projection: opts.projection,
      sort: opts.sort,
      collation: opts.collation,
      hint: opts.hint,
      skip,
      limit,
    });
  } catch (err) {
    notify.error(`Nothing copied — ${err instanceof Error ? err.message : String(err)}`);
    return;
  }
  void copyToClipboard(code, 'Command copied to the clipboard');
}
