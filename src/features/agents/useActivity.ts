import React from 'react';
import { api } from '../../api/atelier';
import { logFailure } from '../../utils/rendererLog';
import type { AgentCallRow, AgentCallSummary, AgentSessionRow } from '@shared/types';
import { callMatches, type ActivityFilter } from './activityRow';

const PAGE = 50;
/** How long live calls wait before the newest page is read again for their requests. */
const HEAD_REFRESH_MS = 250;


export interface ActivityRows {
  /** Newest first. A row pushed live has `request: null` until the newest page is read again. */
  rows: readonly AgentCallRow[];
  /** Ids of rows pushed live whose request is not read yet. */
  pending: ReadonlySet<string>;
  loading: boolean;
  /** True once a read of older rows came back empty. */
  exhausted: boolean;
  failed: boolean;
  loadOlder: () => void;
}

/** The filter as a stable key; parsed back inside the effects, so they depend on the key alone. */
function filterKey(filter: ActivityFilter): string {
  const keys = ['sessionId', 'tokenId', 'connectionId', 'database', 'collection', 'tool'] as const;
  const out: Record<string, string> = { outcome: filter.outcome };
  for (const k of keys) if (filter[k] !== undefined) out[k] = filter[k];
  return JSON.stringify(out);
}

/** A pushed summary as a row, until its request is read. */
function summaryRow(call: AgentCallSummary): AgentCallRow {
  return { ...call, request: null, requestTruncated: false };
}

/** Merges rows by id, the later list winning, newest first. */
function mergeRows(a: readonly AgentCallRow[], b: readonly AgentCallRow[]): AgentCallRow[] {
  const byId = new Map<string, AgentCallRow>();
  for (const r of a) byId.set(r.id, r);
  for (const r of b) byId.set(r.id, r);
  return [...byId.values()].sort((x, y) => y.ts.localeCompare(x.ts) || y.id.localeCompare(x.id));
}

interface RowsState {
  key: string;
  rows: AgentCallRow[];
  pending: Set<string>;
  loading: boolean;
  exhausted: boolean;
  failed: boolean;
}

const fresh = (key: string): RowsState => ({ key, rows: [], pending: new Set(), loading: true, exhausted: false, failed: false });

/** The state for `key`: the one held when it is that key's, else a fresh one. */
const forKey = (s: RowsState, key: string): RowsState => (s.key === key ? s : fresh(key));

/**
 * The Agent Read Log for one filter (X30 §5.2): the newest page, older pages
 * on request, and each new call pushed by `call-event` added on top. A pushed
 * call carries no request, so the newest page is read again shortly after,
 * which fills it in. Only an empty page ends the older rows, never a short one.
 */
export function useActivityRows(filter: ActivityFilter): ActivityRows {
  const key = filterKey(filter);
  const [state, setState] = React.useState<RowsState>(() => fresh(key));

  React.useEffect(() => {
    let live = true;
    const query = JSON.parse(key) as ActivityFilter;
    const readHead = () =>
      api.agentAccess.listCalls({ ...query, limit: PAGE }).then(
        (page) => {
          if (!live) return;
          setState((prev) => {
            const s = forKey(prev, key);
            const pending = new Set(s.pending);
            for (const r of page) pending.delete(r.id);
            return { ...s, rows: mergeRows(s.rows, page), pending, loading: false, failed: false };
          });
        },
        (err: unknown) => {
          logFailure('listing Agent calls', err);
          if (live) setState((prev) => ({ ...forKey(prev, key), loading: false, failed: true }));
        },
      );
    void readHead();
    let timer: ReturnType<typeof setTimeout> | null = null;
    let unsubscribe: (() => void) | undefined;
    try {
      unsubscribe = api.agentAccess.onCall((call) => {
        if (!live || !callMatches(call, query)) return;
        setState((prev) => {
          const s = forKey(prev, key);
          if (s.rows.some((r) => r.id === call.id)) return s;
          return { ...s, rows: mergeRows(s.rows, [summaryRow(call)]), pending: new Set(s.pending).add(call.id) };
        });
        if (timer !== null) clearTimeout(timer);
        timer = setTimeout(() => {
          timer = null;
          void readHead();
        }, HEAD_REFRESH_MS);
      });
    } catch (err) {
      logFailure('subscribing to Agent calls', err);
    }
    return () => {
      live = false;
      if (timer !== null) clearTimeout(timer);
      unsubscribe?.();
    };
  }, [key]);

  const current = forKey(state, key);
  const loadingOlder = React.useRef(false);
  const exhausted = current.exhausted;
  const last = current.rows[current.rows.length - 1];
  const loadOlder = React.useCallback(() => {
    if (loadingOlder.current || exhausted || !last) return;
    loadingOlder.current = true;
    const query = JSON.parse(key) as ActivityFilter;
    api.agentAccess
      .listCalls({ ...query, limit: PAGE, before: { ts: last.ts, id: last.id } })
      .then(
        (page) =>
          setState((prev) => {
            // An answer for a filter no longer shown is dropped.
            if (prev.key !== key) return prev;
            return page.length === 0 ? { ...prev, exhausted: true } : { ...prev, rows: mergeRows(prev.rows, page) };
          }),
        (err: unknown) => logFailure('listing older Agent calls', err),
      )
      .finally(() => {
        loadingOlder.current = false;
      });
  }, [key, exhausted, last]);

  return { rows: current.rows, pending: current.pending, loading: current.loading, exhausted, failed: current.failed, loadOlder };
}

function dedupe(rows: AgentCallSummary[]): AgentCallSummary[] {
  return [...new Map(rows.map((r) => [r.id, r])).values()];
}

/** At most this many of a session's calls are read for its Reached pills. */
const REACHED_CAP = 5000;

/**
 * Every call of one session, for its Reached pills: read page by page up to
 * a cap, then kept current from `call-event`.
 */
export function useSessionCalls(sessionId: string): readonly AgentCallSummary[] {
  const [calls, setCalls] = React.useState<{ sessionId: string; rows: AgentCallSummary[] }>({ sessionId, rows: [] });
  React.useEffect(() => {
    let live = true;
    void (async () => {
      const out: AgentCallSummary[] = [];
      let before: { ts: string; id: string } | undefined;
      try {
        while (out.length < REACHED_CAP) {
          const page = await api.agentAccess.listCalls({ sessionId, outcome: 'all', limit: 200, ...(before ? { before } : {}) });
          if (!live || page.length === 0) break;
          const last = page[page.length - 1]!;
          if (before && last.id === before.id) break;
          out.push(...page);
          before = { ts: last.ts, id: last.id };
        }
      } catch (err) {
        logFailure("reading a session's Agent calls", err);
      }
      // Calls pushed meanwhile are already in; a page read later may hold them too, so ids are kept once.
      if (live) setCalls((c) => ({ sessionId, rows: dedupe([...(c.sessionId === sessionId ? c.rows : []), ...out]) }));
    })();
    let unsubscribe: (() => void) | undefined;
    try {
      unsubscribe = api.agentAccess.onCall((call) => {
        if (live && call.sessionId === sessionId) setCalls((c) => ({ sessionId, rows: dedupe([...(c.sessionId === sessionId ? c.rows : []), call]) }));
      });
    } catch (err) {
      logFailure('subscribing to Agent calls', err);
    }
    return () => {
      live = false;
      unsubscribe?.();
    };
  }, [sessionId]);
  return calls.sessionId === sessionId ? calls.rows : [];
}

/**
 * A stored session by id, live or ended, from `list-sessions` (which has no id
 * filter): the Agent's sessions when its token is known, else every session,
 * page by page until it turns up or a page comes back empty. Read again when
 * `refreshKey` changes, keeping the last row found meanwhile.
 */
export function useStoredSession(sessionId: string, tokenId: string | null | undefined, refreshKey: string): { row: AgentSessionRow | null; done: boolean } {
  const [found, setFound] = React.useState<{ sessionId: string; row: AgentSessionRow | null; done: boolean }>({ sessionId, row: null, done: false });
  React.useEffect(() => {
    let live = true;
    void (async () => {
      let before: { startedAt: string; id: string } | undefined;
      try {
        for (;;) {
          const page = await api.agentAccess.listSessions({ includeEnded: true, limit: 200, ...(tokenId ? { tokenId } : {}), ...(before ? { before } : {}) });
          if (!live) return;
          const hit = page.find((r) => r.id === sessionId);
          if (hit) return setFound({ sessionId, row: hit, done: true });
          if (page.length === 0) return setFound((f) => ({ sessionId, row: f.sessionId === sessionId ? f.row : null, done: true }));
          const last = page[page.length - 1]!;
          if (before && last.id === before.id) return setFound((f) => ({ sessionId, row: f.sessionId === sessionId ? f.row : null, done: true }));
          before = { startedAt: last.startedAt, id: last.id };
        }
      } catch (err) {
        logFailure('finding an Agent session', err);
        if (live) setFound((f) => ({ ...f, sessionId, done: true }));
      }
    })();
    return () => {
      live = false;
    };
  }, [sessionId, tokenId, refreshKey]);
  return found.sessionId === sessionId ? { row: found.row, done: found.done } : { row: null, done: false };
}
