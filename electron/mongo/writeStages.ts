/**
 * Aggregation stage operators that write to MongoDB rather than read from
 * it. Shared between AggregationService (gating agg:run/runAndSave) and
 * dbProxy (gating db.collection(x).aggregate([...]) from the script/shell
 * panes on a read-only connection) — see ADR 0005.
 */
export const WRITE_STAGES: ReadonlySet<string> = new Set(['$out', '$merge']);

export function isWriteStage(op: string): boolean {
  return WRITE_STAGES.has(op);
}
