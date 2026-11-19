import type { Stage } from '@shared/types';

/** Stages whose output order MongoDB does not define (so it can differ between runs). */
const UNORDERING_OPS: ReadonlySet<string> = new Set(['$group', '$sample', '$unionWith']);

/**
 * True when the documents leaving stage `index` come in an unspecified order:
 * an enabled stage up to it is unordering and no `$sort` followed it. Disabled
 * stages are not part of the pipeline, so they neither unorder nor sort.
 */
export function isUnordered(stages: ReadonlyArray<Pick<Stage, 'op' | 'enabled'>>, index: number): boolean {
  let unordered = false;
  for (const stage of stages.slice(0, index + 1)) {
    if (!stage.enabled) continue;
    if (UNORDERING_OPS.has(stage.op)) unordered = true;
    else if (stage.op === '$sort' || stage.op === '$sortByCount') unordered = false;
  }
  return unordered;
}

/** The meta text beside a stage preview's heading: its scope, then `unordered` when it applies. */
export function stagePreviewMeta(opts: {
  op: string;
  shown: number;
  count: number | undefined;
  unordered: boolean;
}): string {
  const parts = [opts.op];
  const shown = opts.shown.toLocaleString('en-US');
  if (opts.shown === 0) {
    // Nothing was sampled (never run, still running): only an exact count says anything.
    if (typeof opts.count === 'number') parts.push(`${opts.count.toLocaleString('en-US')} docs`);
  } else if (typeof opts.count !== 'number') {
    // The count probe timed out or failed, so the sample is all that is known.
    parts.push(`first ${shown} docs`);
  } else if (opts.count > opts.shown) {
    parts.push(`first ${shown} of ${opts.count.toLocaleString('en-US')} docs`);
  } else {
    parts.push(`${opts.count.toLocaleString('en-US')} docs`);
  }
  if (opts.unordered) parts.push('unordered');
  return parts.join(' · ');
}

/**
 * The meta text beside the full run's heading. `hasMore` means the run returned
 * as many rows as its limit, which does not say whether more exist.
 */
export function runMeta(opts: { rows: number; durationMs: number; hasMore: boolean; unordered: boolean }): string {
  const docs = opts.hasMore
    ? `first ${opts.rows.toLocaleString('en-US')} docs, row limit reached`
    : `${opts.rows.toLocaleString('en-US')} docs`;
  const parts = [docs, `${opts.durationMs} ms`];
  if (opts.unordered) parts.push('unordered');
  return parts.join(' · ');
}
