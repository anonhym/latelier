import { useCallback, useEffect, useRef, useState } from 'react';
import type { CollectionTabState } from '@shared/types';
import { api, getErrorMessage } from '../../api/atelier';
import { queryRunKey } from '../../utils/queryRunKey';
import { repairOnCommit } from '../../utils/shellSyntax';
import {
  compileFindOptions,
  currentFilterJson,
  effectivePageLimit,
  projectionProblem,
  sortProblem,
} from './builder';

/** Minimum tab slice the runner needs, decoupled from `CollectionTab` for synthetic consumers. */
export interface RunnerTarget {
  id: string;
  connectionId: string;
  dbName: string;
  collection: string;
  state: CollectionTabState;
}

export interface UseQueryRunnerArgs {
  /** Read via a ref so the returned `run` stays stable while observing the latest target. */
  active: RunnerTarget | null;
  patchCollectionState: (id: string, patch: Partial<CollectionTabState>) => void;
  /** Optional so non-Workspace consumers can skip telemetry. */
  recordSessionEvent?: (event: string, key: string) => void;
  /** Delay before `isLoading` flips true, to avoid a flash on fast finds. */
  loadingDelayMs?: number;
}

export interface UseQueryRunnerResult {
  /**
   * `override` merges into the active state for a caller that just
   * dispatched a patch this tick. `target` runs against a tab other than
   * the Focused Tab — resolved fresh at completion time, not snapshotted at
   * open time, so a pinned drawer refreshes the right tab with its current filter/sort/page.
   */
  run: (
    override?: Partial<CollectionTabState>,
    target?: RunnerTarget,
  ) => Promise<void>;
  /** True once the loading delay elapses for a find still in flight against `active`. */
  isLoading: boolean;
}

export function useQueryRunner({
  active,
  patchCollectionState,
  recordSessionEvent,
  loadingDelayMs = 180,
}: UseQueryRunnerArgs): UseQueryRunnerResult {
  const activeRef = useRef<RunnerTarget | null>(active);
  useEffect(() => {
    activeRef.current = active;
  }, [active]);
  const patchRef = useRef(patchCollectionState);
  useEffect(() => {
    patchRef.current = patchCollectionState;
  }, [patchCollectionState]);
  const recordRef = useRef(recordSessionEvent);
  useEffect(() => {
    recordRef.current = recordSessionEvent;
  }, [recordSessionEvent]);
  // Keyed by target.id, not a single flag — a pinned drawer's refresh of
  // another tab must not block on or bleed a spinner onto the focused one.
  const runningIdsRef = useRef<Set<string>>(new Set());
  // Monotonic per-target token so a slow background count() from an older
  // run can't overwrite a newer run's totalCount.
  const runTokenRef = useRef<Map<string, number>>(new Map());
  const loadingTimersRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(
    new Map(),
  );
  const [loadingIds, setLoadingIds] = useState<Set<string>>(() => new Set());

  useEffect(() => {
    const timers = loadingTimersRef.current;
    return () => {
      timers.forEach((timer) => clearTimeout(timer));
      timers.clear();
    };
  }, []);

  const run = useCallback(
    async (override?: Partial<CollectionTabState>, explicitTarget?: RunnerTarget) => {
      const target = explicitTarget ?? activeRef.current;
      if (!target || runningIdsRef.current.has(target.id)) return;
      const runToken = (runTokenRef.current.get(target.id) ?? 0) + 1;
      runTokenRef.current.set(target.id, runToken);
      const patchState = patchRef.current;
      const recordEvent = recordRef.current;
      const requested: CollectionTabState = override
        ? { ...target.state, ...override }
        : target.state;
      // Covers the Run paths that have no blur to repair Shell Syntax on
      // (auto-run, palette query.run, post-write re-runs) — run strictly
      // before the validity checks below, whose rules stay unchanged.
      // Accumulated into one patch: patchCollectionState isn't a functional
      // updater, so a second call this tick would clobber the first.
      const patch: Partial<CollectionTabState> = {};
      repairOnCommit(requested.queryRaw, (next) => {
        patch.queryRaw = next;
      });
      let builder = requested.builder;
      repairOnCommit(builder.sort, (next) => {
        builder = { ...builder, sort: next };
      });
      repairOnCommit(builder.projectionRaw ?? '', (next) => {
        builder = { ...builder, projectionRaw: next };
      });
      if (builder !== requested.builder) patch.builder = builder;
      const state: CollectionTabState =
        Object.keys(patch).length === 0 ? requested : { ...requested, ...patch };
      if (Object.keys(patch).length > 0) patchState(target.id, patch);
      runningIdsRef.current.add(target.id);
      const existingTimer = loadingTimersRef.current.get(target.id);
      if (existingTimer) clearTimeout(existingTimer);
      loadingTimersRef.current.set(
        target.id,
        setTimeout(() => {
          loadingTimersRef.current.delete(target.id);
          setLoadingIds((prev) => {
            const next = new Set(prev);
            next.add(target.id);
            return next;
          });
        }, loadingDelayMs),
      );
      try {
        const compiled = compileFindOptions(state.builder);
        const filter = currentFilterJson(state);
        if (filter === null) {
          patchState(target.id, {
            lastRun: {
              documents: target.state.lastRun?.documents ?? [],
              durationMs: 0,
              ranAt: new Date().toISOString(),
              error: {
                code: 'VALIDATION',
                message: 'Filter text is blank or not valid JSON',
              },
            },
          });
          return;
        }
        const sortError = sortProblem(state.builder.sort);
        if (sortError !== null) {
          patchState(target.id, {
            lastRun: {
              documents: target.state.lastRun?.documents ?? [],
              durationMs: 0,
              ranAt: new Date().toISOString(),
              error: { code: 'VALIDATION', message: sortError },
            },
          });
          return;
        }
        const projError = projectionProblem(state.builder);
        if (projError !== null) {
          patchState(target.id, {
            lastRun: {
              documents: target.state.lastRun?.documents ?? [],
              durationMs: 0,
              ranAt: new Date().toISOString(),
              error: { code: 'VALIDATION', message: projError },
            },
          });
          return;
        }
        const userLimit = compiled.limit;
        const { skip, limit } = effectivePageLimit(userLimit, state.page, state.pageSize);

        // Sending limit=0 to Mongo means "no limit" — short-circuit past the user's cap.
        if (limit === 0) {
          patchState(target.id, {
            lastRun: {
              documents: [],
              durationMs: 0,
              ranAt: new Date().toISOString(),
            },
            lastRunHasMore: false,
            totalCount: userLimit ?? 0,
          });
          return;
        }

        const findResult = await api.query.find({
          connectionId: target.connectionId,
          dbName: target.dbName,
          collection: target.collection,
          filter,
          sort: compiled.sort,
          projection: compiled.projection,
          limit,
          skip,
        });
        const effectiveHasMore =
          findResult.hasMore &&
          (userLimit === null || skip + limit < userLimit);
        patchState(target.id, {
          lastRun: {
            documents: findResult.documents,
            durationMs: findResult.durationMs,
            ranAt: new Date().toISOString(),
          },
          lastRunHasMore: effectiveHasMore,
        });
        recordEvent?.(
          'queryRun',
          queryRunKey({
            connectionId: target.connectionId,
            dbName: target.dbName,
            collection: target.collection,
            filter,
            sort: compiled.sort ?? '',
            projection: state.builder.projection,
            projectionRaw: state.builder.projectionRaw,
            limit,
            skip,
          }),
        );
        // Background count, capped at userLimit so the pager matches what's reachable.
        api.query
          .count({
            connectionId: target.connectionId,
            dbName: target.dbName,
            collection: target.collection,
            filter,
          })
          .then(({ count }) => {
            if (runToken !== runTokenRef.current.get(target.id)) return;
            const displayCount =
              userLimit !== null ? Math.min(count, userLimit) : count;
            patchState(target.id, { totalCount: displayCount });
          })
          .catch(() => {});
      } catch (err) {
        const code = (err as { code?: string }).code ?? 'INTERNAL';
        const message = getErrorMessage(err, 'Unknown error');
        const prevDocs = target.state.lastRun?.documents ?? [];
        patchState(target.id, {
          lastRun: {
            documents: prevDocs,
            durationMs: 0,
            ranAt: new Date().toISOString(),
            error: { code, message },
          },
        });
      } finally {
        runningIdsRef.current.delete(target.id);
        const timer = loadingTimersRef.current.get(target.id);
        if (timer) {
          clearTimeout(timer);
          loadingTimersRef.current.delete(target.id);
        }
        setLoadingIds((prev) => {
          if (!prev.has(target.id)) return prev;
          const next = new Set(prev);
          next.delete(target.id);
          return next;
        });
      }
    },
    [loadingDelayMs],
  );

  const isLoading = active ? loadingIds.has(active.id) : false;

  return { run, isLoading };
}
