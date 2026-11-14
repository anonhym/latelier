import { themeVars } from '../../theme/themeVars';
import type { CollectionDetails } from '@shared/ipc';
import { humanBytes } from '../../utils/humanBytes';

interface Props {
  details: CollectionDetails | null;
  error: string | null;
  loading: boolean;
}

/**
 * Schema & indexes' stat strip (W16 §16.3): one collection's counts and sizes,
 * from the `meta:collectionDetails` read StructureView owns. Natural height and
 * `flex: 'none'` like its siblings, because StructureView's single scroller
 * sizes them (see StructureView's comment).
 */
export function CollectionStatsSection({ details, error, loading }: Props) {
  const T = themeVars;
  const stats = details?.stats;
  const size = (n: number | undefined) => (n === undefined ? '—' : humanBytes(n));

  return (
    <section
      aria-label="Statistics"
      style={{ flex: 'none', display: 'flex', flexDirection: 'column', overflow: 'visible' }}
    >
      {error && (
        <div
          role="alert"
          style={{
            padding: '6px 16px',
            fontSize: T.fsSm,
            color: T.warn,
            background: T.surface,
            borderBottom: `1px solid ${T.border}`,
          }}
        >
          {error}
        </div>
      )}

      {loading && !details && !error && (
        <div style={{ padding: '10px 16px', fontSize: T.fsSm, color: T.textMuted }}>Loading…</div>
      )}

      {details?.type === 'view' && (
        <div style={{ padding: '10px 16px', fontSize: T.fsSm, color: T.textMuted }}>
          View on {details.options.viewOn}
        </div>
      )}

      {details && stats && (
        <div
          style={{
            display: 'flex',
            flexWrap: 'wrap',
            gap: T.gapSm,
            padding: '10px 16px',
            borderBottom: `1px solid ${T.border}`,
          }}
        >
          <Tile label="Documents" value={stats.documentCount?.toLocaleString() ?? '—'} />
          <Tile label="Data size" value={size(stats.sizeBytes)} />
          <Tile label="Storage" value={size(stats.storageSizeBytes)} />
          <Tile label="Avg document" value={size(stats.avgObjSizeBytes)} />
          <Tile label="Indexes" value={`${stats.indexCount ?? '—'} · ${size(stats.totalIndexSizeBytes)}`} />
          {details.capped && <Tile label="Capped" value="Yes" />}
        </div>
      )}
    </section>
  );
}

/** A 64px tile: a 13px label over an 18px value (W16 §16.3). */
function Tile({ label, value }: { label: string; value: string }) {
  const T = themeVars;
  return (
    <div
      style={{
        height: 64,
        boxSizing: 'border-box',
        minWidth: 110,
        flex: '1 1 110px',
        padding: '8px 12px',
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'center',
        border: `1px solid ${T.border}`,
        borderRadius: T.rs,
        background: T.surface,
      }}
    >
      <span style={{ color: T.textMuted, fontSize: T.fsMd }}>{label}</span>
      {/* eslint-disable-next-line no-restricted-syntax -- W16 §16.3 sets the value at 18px; no token is that size */}
      <span style={{ color: T.text, fontSize: 18, fontVariantNumeric: 'tabular-nums' }}>{value}</span>
    </div>
  );
}
