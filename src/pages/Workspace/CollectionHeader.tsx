import React from 'react';
import { themeVars } from '../../theme/themeVars';
import { api } from '../../api/atelier';
import { useElementWidth } from '../../hooks/useElementWidth';
import { humanBytes } from '../../utils/humanBytes';

/** Below this the counts would crowd the name; Schema & indexes still has them. */
const STATS_MIN_WIDTH = 480;

interface CollectionHeaderProps {
  connectionId: string;
  dbName: string;
  collection: string;
  /**
   * Re-reads the counts whenever it changes. PanelBody builds it from
   * `useDocumentDialogs`'s write-completion counter (once per finished
   * insert/edit/delete/delete-many) and Structure's index changes. Not the
   * query re-run or a view switch: that would fire on every sort/filter/page
   * re-run too, and `collectionDetails` runs a stats aggregation on the
   * server, so it isn't free.
   */
  refreshSignal?: number;
}

/**
 * The collection's figures, on the view-header row beside Documents /
 * Aggregation / Schema & indexes, so they show in all three (W01 §14.5).
 */
export function CollectionHeader({
  connectionId,
  dbName,
  collection,
  refreshSignal,
}: CollectionHeaderProps) {
  const T = themeVars;
  const cacheKey = `${connectionId}|${dbName}|${collection}`;
  const [stats, setStats] = React.useState<{
    key: string;
    docCount: number | null;
    indexCount: number | null;
    sizeBytes: number | null;
  } | null>(null);
  const current = stats && stats.key === cacheKey ? stats : null;

  React.useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const { stats: figures } = await api.meta.collectionDetails({ connectionId, dbName, collection });
        if (cancelled) return;
        // A figure the server did not report (every one, for a view) stays absent rather than 0.
        setStats({
          key: cacheKey,
          docCount: figures?.documentCount ?? null,
          indexCount: figures?.indexCount ?? null,
          sizeBytes: figures?.sizeBytes ?? null,
        });
      } catch {
        // Best-effort — but a failed refresh must not leave a pre-write count
        // on screen looking current, so clear rather than hold the last value.
        if (!cancelled) setStats(null);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [connectionId, dbName, collection, cacheKey, refreshSignal]);

  // A count shows whole or not at all: "1…" would read as one document.
  const [rowRef, rowWidth] = useElementWidth<HTMLDivElement>();
  const roomForStats = rowWidth === null || rowWidth >= STATS_MIN_WIDTH;
  const figure = (n: number) => <strong style={{ fontWeight: 500, color: T.text }}>{n.toLocaleString()}</strong>;
  const parts: React.ReactNode[] = [];
  if (current?.docCount != null) parts.push(<>{figure(current.docCount)}{current.docCount === 1 ? ' document' : ' documents'}</>);
  if (current?.indexCount != null) parts.push(<>{figure(current.indexCount)}{current.indexCount === 1 ? ' index' : ' indexes'}</>);
  if (current?.sizeBytes != null) parts.push(humanBytes(current.sizeBytes));

  return (
    <div ref={rowRef} style={{ flex: 1, minWidth: 0, display: 'flex', justifyContent: 'flex-end', padding: '0 14px 0 10px' }}>
      {/* The namespace is the title bar's breadcrumb (W01 §14.2); only the figures stay here, muted, at the right. */}
      {roomForStats && parts.length > 0 && (
        <span data-testid="collection-figures" style={{ fontSize: T.fsXs, color: T.textMuted, whiteSpace: 'nowrap' }}>
          {parts.map((part, i) => (
            <React.Fragment key={i}>
              {i > 0 && ' · '}
              {part}
            </React.Fragment>
          ))}
        </span>
      )}
    </div>
  );
}
