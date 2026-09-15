import React from 'react';
import { I } from '../../../icons';
import { api, getErrorMessage } from '../../../api/atelier';
import { relativeTime } from '../../../utils/relativeTime';
import { copyToClipboard } from '../../../utils/clipboard';
import { confirmDestructive } from '../../../utils/confirm';
import type { RecentQuery } from '@shared/types';

interface RecentTabProps {
  connectionId: string;
  dbName: string;
  collection: string;
  onRunHere: (recent: RecentQuery) => void;
}

/**
 * The filter a recent run actually used, or `null` for a row recorded before
 * `queryRaw` existed. W15 §13.4: the row's primary slot used to hold
 * only a bare time and a duration, so every row looked the same and "Run"
 * was a blind action. `legacyCompileFilter` could reconstruct the pre-W13
 * rows, but dragging the frozen legacy shim into a read-only view to render
 * a preview is not worth it — those rows say so instead.
 */
function previewOf(item: RecentQuery): string | null {
  return item.payload.kind === 'find' && item.payload.queryRaw
    ? item.payload.queryRaw
    : null;
}

export function RecentTab({ connectionId, dbName, collection, onRunHere }: RecentTabProps) {
  const [items, setItems] = React.useState<RecentQuery[]>([]);
  const [loading, setLoading] = React.useState(false);
  const [err, setErr] = React.useState<string | null>(null);
  const [deleting, setDeleting] = React.useState(false);

  // A reviewer flagged that this instance is reused when the active collection
  // changes, and two `recent.list` calls can be in flight at once. If the older
  // one resolves last it repopulates the list with the *previous* collection's
  // rows under the new header. Combined with a delete that carried only the
  // row's id, confirming then destroyed history from a collection the user was
  // no longer looking at. The token makes a stale response a no-op.
  const loadToken = React.useRef(0);

  const load = React.useCallback(async () => {
    const token = ++loadToken.current;
    setLoading(true);
    setErr(null);
    try {
      const list = await api.recent.list({ connectionId, dbName, collection, kind: 'find' });
      if (token !== loadToken.current) return;
      setItems(list);
    } catch (e) {
      if (token !== loadToken.current) return;
      setErr(getErrorMessage(e, 'Failed to load recent queries'));
    } finally {
      if (token === loadToken.current) setLoading(false);
    }
  }, [connectionId, dbName, collection]);

  React.useEffect(() => {
    queueMicrotask(() => { void load(); });
  }, [load]);

  // both paths go through `recent:clear`; a per-row delete is just the
  // same filter narrowed to one `id`. Same confirm as Saved's.
  const runDelete = async (
    filter: Parameters<typeof api.recent.clear>[0],
    failure: string,
  ) => {
    setDeleting(true);
    try {
      await api.recent.clear(filter);
      await load();
    } catch (e) {
      setErr(getErrorMessage(e, failure));
    } finally {
      setDeleting(false);
    }
  };

  const requestDelete = async (item: RecentQuery, preview: string | null) => {
    const proceed = await confirmDestructive({
      title: 'Delete this run?',
      body: `Removes ${preview ?? 'this run'} from the recent history. This action cannot be undone.`,
      confirmLabel: 'Delete',
    });
    if (!proceed) return;
    // The id alone would be enough to find the row — and that was the problem.
    // Sending the scope too means the delete is bounded by what this tab is
    // showing, so even a row that reached the list by some other route cannot
    // take history from another collection with it. The `AND` of id + scope
    // matches nothing rather than the wrong thing.
    await runDelete(
      { id: item.id, connectionId, dbName, collection, kind: 'find' },
      'Failed to delete recent query',
    );
  };

  // Scoped to exactly what the tab shows — this connection, this database,
  // this collection, `kind: 'find'`. Aggregation history for the same
  // collection is history this view never listed, so it stays.
  const requestClear = async () => {
    const proceed = await confirmDestructive({
      title: 'Clear recent history?',
      body: `Clears the find history for ${collection} in ${dbName} on this connection. Aggregation history and saved queries are not affected.`,
      confirmLabel: 'Clear history',
    });
    if (!proceed) return;
    await runDelete(
      { connectionId, dbName, collection, kind: 'find' },
      'Failed to clear recent queries',
    );
  };

  return (
    <div>
      {/* W15 §13.5 — the header survives loading, error and empty.
          This view used to early-return a bare centered message, so anyone
          switching here while it loaded got an unlabelled blank panel. */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 6,
          padding: '10px 10px 6px',
          fontSize: 10,
          fontWeight: 700,
          letterSpacing: 0.6,
          textTransform: 'uppercase',
          color: 'var(--atelier-text-muted)',
        }}
      >
        <span style={{ flex: 1 }}>Recent · {collection}</span>
        <button
          onClick={() => void load()}
          disabled={loading}
          aria-label="Refresh recent queries"
          title="Refresh"
          style={{
            fontSize: 10,
            border: '1px solid var(--atelier-border)',
            borderRadius: 'var(--atelier-radius-xs)',
            background: 'none',
            color: 'var(--atelier-text-muted)',
            cursor: loading ? 'default' : 'pointer',
            padding: '1px 6px',
          }}
        >
          Refresh
        </button>
        {/* The accessible name deliberately differs from the confirm's
            "Clear history" label — otherwise both match the same role+name
            query and the dialog is unreachable by keyboard *and* by test. */}
        <button
          onClick={() => void requestClear()}
          disabled={loading || deleting || items.length === 0}
          aria-label={`Clear recent find history for ${collection}`}
          title="Clear history"
          style={{
            fontSize: 10,
            border: '1px solid var(--atelier-border)',
            borderRadius: 'var(--atelier-radius-xs)',
            background: 'none',
            color: 'var(--atelier-red)',
            cursor: loading || deleting || items.length === 0 ? 'default' : 'pointer',
            opacity: items.length === 0 ? 0.5 : 1,
            padding: '1px 6px',
          }}
        >
          Clear
        </button>
      </div>

      {loading && (
        <div style={{ padding: '4px 10px 10px', fontSize: 12, color: 'var(--atelier-text-muted)' }}>
          Loading…
        </div>
      )}

      {!loading && err && (
        <div style={{ padding: '4px 10px 10px', fontSize: 12, color: 'var(--atelier-warn)' }}>
          {err}
        </div>
      )}

      {!loading && !err && items.length === 0 && (
        <div style={{ padding: '4px 10px 10px', fontSize: 12, color: 'var(--atelier-text-muted)' }}>
          No recent queries yet. Anything you run in this collection shows up here.
        </div>
      )}

      {!loading && !err && items.map((item) => {
        const preview = previewOf(item);
        return (
          <div
            key={item.id}
            style={{
              padding: '7px 10px',
              borderBottom: '1px solid var(--atelier-border)',
              display: 'flex',
              alignItems: 'center',
              gap: 6,
              fontSize: 12,
            }}
          >
            <div style={{ flex: 1, overflow: 'hidden' }}>
              {/* The row's identity: what was queried, not just when. */}
              <div
                title={preview ?? undefined}
                style={{
                  fontFamily: '"JetBrains Mono", monospace',
                  fontSize: 11,
                  color: preview ? 'var(--atelier-text)' : 'var(--atelier-text-ghost)',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                }}
              >
                {preview ?? 'no stored query'}
              </div>
              <div style={{ fontSize: 10, color: 'var(--atelier-text-ghost)', marginTop: 1 }}>
                {/* `toLocaleTimeString` alone made a run from last Tuesday read
                    `14:32`, indistinguishable from one an hour ago. */}
                {relativeTime(item.ranAt, item.ranAt)} — {item.durationMs}ms
                {item.resultCount !== undefined && (
                  <span style={{ marginLeft: 6 }}>{item.resultCount} docs</span>
                )}
                {item.errorCode && (
                  <span style={{ marginLeft: 6, color: 'var(--atelier-warn)' }}>{item.errorCode}</span>
                )}
              </div>
            </div>
            <button
              onClick={() => onRunHere(item)}
              title="Run here"
              aria-label={`Run ${preview ?? 'this recent query'} in this tab`}
              style={{
                padding: '2px 7px',
                fontSize: 10,
                border: '1px solid var(--atelier-accent-border)',
                borderRadius: 'var(--atelier-radius-xs)',
                background: 'var(--atelier-accent-soft)',
                color: 'var(--atelier-accent)',
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                gap: 3,
              }}
            >
              {I.play} Run
            </button>
            {/* W15 §13.7 — this used to early-return on a row with no
                stored `queryRaw`: the click did nothing and said nothing. It
                is now unavailable, and says why, next to a row that already
                shows there is no query to copy. */}
            <button
              onClick={() => { if (preview) void copyToClipboard(preview, 'Query copied to the clipboard'); }}
              disabled={!preview}
              title={preview ? 'Copy MQL' : 'This run has no stored query to copy'}
              aria-label={preview ? 'Copy MQL to the clipboard' : 'Copy MQL — this run has no stored query'}
              style={{
                padding: '2px 5px',
                fontSize: 10,
                border: '1px solid var(--atelier-border)',
                borderRadius: 'var(--atelier-radius-xs)',
                background: 'none',
                color: 'var(--atelier-text-muted)',
                cursor: preview ? 'pointer' : 'not-allowed',
                opacity: preview ? 1 : 0.5,
                display: 'flex',
                alignItems: 'center',
              }}
            >
              {I.copy}
            </button>
            {/* Icon-only, so `title` is not the accessible name; the
                real name says which run goes. */}
            <button
              onClick={() => void requestDelete(item, preview)}
              disabled={deleting}
              title="Delete"
              aria-label={`Delete ${preview ?? 'this recent query'} from recent history`}
              style={{
                padding: '2px 5px',
                fontSize: 10,
                border: '1px solid var(--atelier-border)',
                borderRadius: 'var(--atelier-radius-xs)',
                background: 'none',
                color: 'var(--atelier-red)',
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
              }}
            >
              {I.trash}
            </button>
          </div>
        );
      })}
    </div>
  );
}
