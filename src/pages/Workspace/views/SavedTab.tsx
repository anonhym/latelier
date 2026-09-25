import React from 'react';
import { I } from '../../../icons';
import { api, getErrorMessage } from '../../../api/atelier';
import { confirmDestructive } from '../../../utils/confirm';
import type { SavedKind, SavedQuery, SavedQuerySummary } from '@shared/types';

const KIND_BADGE: Record<SavedKind, string> = {
  find: 'QUE',
  aggregation: 'AGG',
  script: 'SCR',
};

interface SavedTabProps {
  connectionId: string;
  dbName: string;
  collection: string;
  refreshKey?: number;
  onRunHere: (saved: SavedQuery) => void;
  /**
   * Opens a saved aggregation or script as its own top-level workspace tab.
   * Those kinds don't share a runtime surface with the Documents view, so
   * they can't run in place the way a find query does.
   */
  onOpenInTab: (saved: SavedQuerySummary) => void;
}

export function SavedTab({
  connectionId,
  dbName,
  collection,
  refreshKey,
  onRunHere,
  onOpenInTab,
}: SavedTabProps) {
  const [items, setItems] = React.useState<SavedQuerySummary[]>([]);
  const [loading, setLoading] = React.useState(false);
  const [err, setErr] = React.useState<string | null>(null);
  const [deleting, setDeleting] = React.useState(false);

  const load = React.useCallback(async () => {
    setLoading(true);
    setErr(null);
    try {
      const list = await api.saved.list({ connectionId, dbName, collection });
      setItems(list);
    } catch (e) {
      setErr(getErrorMessage(e, 'Failed to load saved queries'));
    } finally {
      setLoading(false);
    }
  }, [connectionId, dbName, collection]);

  React.useEffect(() => {
    queueMicrotask(() => { void load(); });
  }, [load, refreshKey]);

  const handlePrimary = async (summary: SavedQuerySummary) => {
    if (summary.kind !== 'find') {
      onOpenInTab(summary);
      return;
    }
    try {
      const full = await api.saved.get({ id: summary.id });
      onRunHere(full);
    } catch (e) {
      setErr(getErrorMessage(e, 'Failed to load query'));
    }
  };

  // N4.7 — this used to be a hand-rolled `role="alertdialog"` overlay
  // with its own backdrop, its own Escape listener and its own focus
  // behaviour, one tab away from the drawer's Reset, which already used the
  // modal manager. `confirmDestructive` is that same manager; Escape, the
  // backdrop and focus trapping come with it rather than being re-implemented.
  const requestDelete = async (target: SavedQuerySummary) => {
    const proceed = await confirmDestructive({
      title: `Delete "${target.name}"?`,
      body: 'This removes the saved query. This action cannot be undone.',
      confirmLabel: 'Delete',
    });
    if (!proceed) return;
    setDeleting(true);
    try {
      await api.saved.delete({ id: target.id });
      setItems((prev) => prev.filter((i) => i.id !== target.id));
    } catch (e) {
      setErr(getErrorMessage(e, 'Failed to delete'));
    } finally {
      setDeleting(false);
    }
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
        <span style={{ flex: 1 }}>Saved · {collection}</span>
        <button
          onClick={() => void load()}
          disabled={loading}
          aria-label="Refresh saved queries"
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
          Nothing saved yet. Use Save in the toolbar above to keep one here.
        </div>
      )}

      {!loading && !err && items.map((item) => (
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
          {/* Kind badge — QUE/AGG/SCR. SavedStrip carried this same badge;
              now that SavedTab lists every kind (not just find), the label
              is what tells a find, an aggregation and a script apart at a
              glance. */}
          <span
            title={item.kind}
            style={{
              fontSize: 9,
              padding: '1px 5px',
              background: 'var(--atelier-accent-soft)',
              color: 'var(--atelier-accent)',
              borderRadius: 'var(--atelier-radius-xs)',
              fontWeight: 700,
              textTransform: 'uppercase',
              letterSpacing: 0.4,
              flexShrink: 0,
              fontFamily: '"JetBrains Mono", monospace',
            }}
          >
            {KIND_BADGE[item.kind]}
          </span>
          <div style={{ flex: 1, overflow: 'hidden' }}>
            <div
              style={{
                fontWeight: 600,
                color: 'var(--atelier-text)',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
              }}
            >
              {item.name}
            </div>
            <div style={{ fontSize: 10, color: 'var(--atelier-text-ghost)', marginTop: 1 }}>
              {new Date(item.updatedAt).toLocaleDateString()}
            </div>
            {item.description && (
              <div
                title={item.description}
                style={{
                  fontSize: 10,
                  color: 'var(--atelier-text-ghost)',
                  marginTop: 1,
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                }}
              >
                {item.description}
              </div>
            )}
          </div>
          <button
            onClick={() => void handlePrimary(item)}
            title={item.kind === 'find' ? 'Run here' : 'Open in a new tab'}
            aria-label={
              item.kind === 'find'
                ? `Run "${item.name}" in this tab`
                : `Open "${item.name}" in a new tab`
            }
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
            {item.kind === 'find' ? <>{I.play} Run</> : '↗ Open'}
          </button>
          {/* W15 §13.5 — `title` is not an accessible name for an
              icon-only button; it is kept for the hover tooltip and
              the real name says which query it deletes. */}
          <button
            onClick={() => void requestDelete(item)}
            disabled={deleting}
            title="Delete"
            aria-label={`Delete "${item.name}"`}
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
      ))}
    </div>
  );
}
