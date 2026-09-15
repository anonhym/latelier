import { isRecord } from './displayValue';

/**
 * Compact, defensive summary of a MongoDB explain plan — used to drive the
 * `ExplainDrawer` summary strip (winning-plan stage chain, index usage,
 * execution metrics). Always total: never throws, returns `null` when the
 * shape isn't recognized so callers can degrade to the full raw tree.
 *
 * Handles the shape variance across:
 * - find explains: `queryPlanner.winningPlan` (+ `executionStats` at verbosity
 *   `executionStats`/`allPlansExecution`).
 * - aggregation explains: `{ stages: [{ $cursor: { queryPlanner, executionStats } }] }`.
 * - sharded plans: `winningPlan.shards[]`, each carrying its own `winningPlan`.
 * - SBE / 5.1+ plans: `winningPlan.queryPlan` nests the classic stage tree.
 */
export interface ExplainSummary {
  /** Stage names from the winning plan root down to the innermost input stage. */
  stages: string[];
  usesIndex: boolean;
  collscan: boolean;
  indexName?: string;
  keyPattern?: unknown;
  nReturned?: number;
  docsExamined?: number;
  keysExamined?: number;
  executionTimeMillis?: number;
}

function nextStage(stage: Record<string, unknown>): unknown {
  if (isRecord(stage.inputStage)) return stage.inputStage;
  if (Array.isArray(stage.inputStages) && stage.inputStages.length > 0) {
    return stage.inputStages[0];
  }
  return undefined;
}

function collectStageChain(stage: unknown, acc: string[]): void {
  if (!isRecord(stage)) return;
  if (typeof stage.stage === 'string') acc.push(stage.stage);
  collectStageChain(nextStage(stage), acc);
}

function findIndexInfo(stage: unknown): { indexName?: string; keyPattern?: unknown } | null {
  if (!isRecord(stage)) return null;
  if (stage.stage === 'IXSCAN') {
    return {
      indexName: typeof stage.indexName === 'string' ? stage.indexName : undefined,
      keyPattern: stage.keyPattern,
    };
  }
  return findIndexInfo(nextStage(stage));
}

/** Follows the aggregation `{ stages: [{ $cursor }] }` wrapper down to the
 * find-shaped object (`{ queryPlanner, executionStats? }`) both the winning
 * plan and execution stats live on. Returns the find-shaped object as-is when
 * there's no aggregation wrapper. */
function unwrapCursorStage(plan: Record<string, unknown>): Record<string, unknown> | null {
  if (!Array.isArray(plan.stages)) return plan;
  const cursorStage = plan.stages.find(
    (s): s is Record<string, unknown> => isRecord(s) && isRecord(s.$cursor),
  );
  if (!cursorStage) return null;
  return isRecord(cursorStage.$cursor) ? cursorStage.$cursor : null;
}

function extractWinningPlan(inner: Record<string, unknown>): Record<string, unknown> | null {
  if (!isRecord(inner.queryPlanner)) return null;
  const rootPlan: unknown = inner.queryPlanner.winningPlan;
  if (!isRecord(rootPlan)) return null;

  // Sharded: winningPlan.shards[] each carry their own winningPlan.
  let winningPlan: Record<string, unknown> = rootPlan;
  if (Array.isArray(winningPlan.shards) && winningPlan.shards.length > 0) {
    const shard0: unknown = winningPlan.shards[0];
    if (isRecord(shard0) && isRecord(shard0.winningPlan)) {
      winningPlan = shard0.winningPlan;
    }
  }

  // SBE / 5.1+: the classic stage tree lives under winningPlan.queryPlan.
  const nested: unknown = winningPlan.queryPlan;
  if (isRecord(nested)) {
    winningPlan = nested;
  }

  return winningPlan;
}

export function summarizeExplain(plan: unknown): ExplainSummary | null {
  if (!isRecord(plan)) return null;

  const inner = unwrapCursorStage(plan);
  if (!inner) return null;

  const winningPlan = extractWinningPlan(inner);
  if (!winningPlan) return null;

  const stages: string[] = [];
  collectStageChain(winningPlan, stages);
  if (stages.length === 0) return null;

  const collscan = stages.includes('COLLSCAN');
  const usesIndex = stages.includes('IXSCAN');
  const idx = findIndexInfo(winningPlan);

  const summary: ExplainSummary = { stages, usesIndex, collscan };
  if (idx?.indexName !== undefined) summary.indexName = idx.indexName;
  if (idx && 'keyPattern' in idx) summary.keyPattern = idx.keyPattern;

  const stats = inner.executionStats;
  if (isRecord(stats)) {
    if (typeof stats.nReturned === 'number') summary.nReturned = stats.nReturned;
    if (typeof stats.totalDocsExamined === 'number') summary.docsExamined = stats.totalDocsExamined;
    if (typeof stats.totalKeysExamined === 'number') summary.keysExamined = stats.totalKeysExamined;
    if (typeof stats.executionTimeMillis === 'number') {
      summary.executionTimeMillis = stats.executionTimeMillis;
    }
  }

  return summary;
}
