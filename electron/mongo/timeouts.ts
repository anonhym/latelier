/**
 * One source for every `maxTimeMS` bound the mongo services apply. Kept as
 * per-operation `maxTimeMS` rather than a handle-level `timeoutMS` — see
 * specs/X18-deepening-seams.md §6 for the empirical reason that rejection
 * still holds (wrong error shape, and it overrides an explicit per-call
 * value instead of deferring to it).
 *
 * Three classes, not one number: a stats probe, an interactive op and a
 * structural admin op legitimately need different slack, and collapsing
 * them either makes the fast path sluggish or the slow path trigger-happy.
 */

/**
 * An operation the user is waiting on right now: find/findOne/explain, an
 * aggregation Run, or a document write. 30s is long enough to survive an
 * unindexed scan of a medium collection but short enough that an
 * unresponsive server surfaces to the user instead of pinning an IPC
 * handler and a pool connection indefinitely.
 */
export const QUERY_TIMEOUT_MS = 30_000;

/**
 * A cheap, disposable probe: a count, or a stage preview that fires on
 * every edit rather than an explicit Run. These compete for the same
 * connection as the interactive op above and their result is worth little
 * if slow, so they give up well before it does.
 */
export const PROBE_TIMEOUT_MS = 5_000;

/**
 * Server-side metadata: index/collection stats, schema sampling, and the
 * admin user/role commands. These read small, already-materialized
 * structures rather than scanning collection data, so a tight bound still
 * catches a hung server without punishing a normal call.
 */
export const STATS_TIMEOUT_MS = 3_000;

/**
 * A structural admin op — drop a collection or a whole database — that can
 * legitimately run long on a large namespace (WiredTiger has to free every
 * page). Still bounded, because unbounded means an unresponsive server
 * holds the IPC handler open forever, but with far more slack than an
 * interactive query.
 */
export const ADMIN_LONG_TIMEOUT_MS = 120_000;
