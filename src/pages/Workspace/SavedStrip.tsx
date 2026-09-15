import React from 'react';
import { Button, Group, Tooltip } from '@mantine/core';
import { themeVars } from '../../theme/themeVars';
import { api, getErrorMessage } from '../../api/atelier';
import { relativeTime } from '../../utils/relativeTime';
import type { SavedKind, SavedQuery, SavedQuerySummary } from '@shared/types';

interface SavedStripProps {
  connectionId: string;
  dbName: string;
  collection: string;
  /** Bumped by BuilderPane after a save so the strip re-fetches. */
  refreshKey?: number;
  /** Loads a saved find into the current builder and runs it. */
  onRunHere: (saved: SavedQuery) => void;
  /**
   * Opens a saved aggregation or script as its own top-level workspace tab.
   * Non-find kinds can't replace the builder state and don't share a runtime
   * surface with the Documents view, so the design routes them through new
   * tabs.
   */
  onOpenInTab: (saved: SavedQuerySummary) => void;
  /** Switches the right pane to the full Saved tab so the user can edit. */
  onOpenSavedTab: () => void;
}

const STRIP_LIMIT = 4;

const KIND_BADGE: Record<SavedKind, string> = {
  find: 'QUE',
  aggregation: 'AGG',
  script: 'SCR',
};

/**
 * Compact list of the most recent saved items (queries + aggregations +
 * scripts) for the current collection. Shows up to {@link STRIP_LIMIT} rows
 * inside the Builder tab — matches the "Saved · {collection}" panel in the
 * L'Atelier app-v2 design with QUE / AGG / SCR badges.
 *
 * Find-kind items run in-place (load into builder + run); aggregation and
 * script items open as their own top-level tabs since they don't share a
 * runtime surface with the Documents view.
 */
export function SavedStrip({
  connectionId,
  dbName,
  collection,
  refreshKey,
  onRunHere,
  onOpenInTab,
  onOpenSavedTab,
}: SavedStripProps) {
  const T = themeVars;
  const cacheKey = `${connectionId}|${dbName}|${collection}|${refreshKey ?? 0}`;
  const [state, setState] = React.useState<{
    key: string;
    items: SavedQuerySummary[] | null;
    err: string | null;
  }>({ key: cacheKey, items: null, err: null });
  const current = state.key === cacheKey ? state : { key: cacheKey, items: null, err: null };
  const items = current.items;
  const err = current.err;

  React.useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const list = await api.saved.list({
          connectionId,
          dbName,
          collection,
        });
        if (!cancelled) setState({ key: cacheKey, items: list, err: null });
      } catch (e) {
        if (!cancelled)
          setState({
            key: cacheKey,
            items: null,
            err: getErrorMessage(e, 'Failed to load saved items'),
          });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [connectionId, dbName, collection, refreshKey, cacheKey]);

  const handlePrimary = async (summary: SavedQuerySummary) => {
    if (summary.kind === 'find') {
      try {
        const full = await api.saved.get({ id: summary.id });
        onRunHere(full);
      } catch (e) {
        setState((prev) => ({ ...prev, err: getErrorMessage(e, 'Failed to load query') }));
      }
    } else {
      onOpenInTab(summary);
    }
  };

  const visible = (items ?? []).slice(0, STRIP_LIMIT);

  return (
    <div
      style={{
        marginTop: 12,
        // Match the 12px horizontal inset of the Builder body and footer so the
        // SAVED label/text line up with CONDITIONS/SORT/LIMIT above. The full-
        // width top border (drawn at the box edge) is preserved.
        padding: '10px 12px 0',
        borderTop: `1px solid ${T.border}`,
      }}
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          marginBottom: 6,
          fontSize: 10,
          fontWeight: 700,
          letterSpacing: 0.6,
          textTransform: 'uppercase',
          color: T.textMuted,
        }}
      >
        <span style={{ flex: 1 }}>Saved · {collection}</span>
        {/* W15 §13.3 — the one control that opens the Saved tab. Each
            row used to carry its own ↗ promising `Show "<name>" in Saved tab`
            while calling a no-argument handler that merely flipped the tab;
            N identical buttons telling N lies is worse than one honest one,
            so the per-row control is gone and this one always shows while
            there is anything to open. */}
        {items && items.length > 0 && (
          <Button
            variant="subtle"
            size="compact-xs"
            onClick={onOpenSavedTab}
            styles={{ root: { fontSize: 10, padding: 0 } }}
          >
            see all ({items.length})
          </Button>
        )}
      </div>

      {err && (
        <div style={{ fontSize: 11, color: T.warn, marginBottom: 6 }}>{err}</div>
      )}

      {items === null && !err && (
        <div style={{ fontSize: 11, color: T.textMuted, padding: '4px 0' }}>
          Loading…
        </div>
      )}

      {items !== null && visible.length === 0 && !err && (
        <div style={{ fontSize: 11, color: T.textMuted, padding: '4px 0', lineHeight: 1.4 }}>
          No saved queries yet. Use <strong>Save</strong> below to bookmark the
          current query.
        </div>
      )}

      {visible.map((s) => {
        const isFind = s.kind === 'find';
        const meta = relativeTime(s.updatedAt);
        return (
          <Group
            key={s.id}
            gap={6}
            wrap="nowrap"
            style={{
              padding: '5px 7px',
              background: T.bg,
              border: `1px solid ${T.border}`,
              borderRadius: T.rs,
              marginBottom: 4,
            }}
          >
            <Tooltip label={s.kind} withArrow>
              <span
                style={{
                  fontSize: 9,
                  padding: '1px 5px',
                  background: T.accentSoft,
                  color: T.accent,
                  borderRadius: T.rx,
                  fontWeight: 700,
                  textTransform: 'uppercase',
                  letterSpacing: 0.4,
                  flexShrink: 0,
                  fontFamily: '"JetBrains Mono", monospace',
                }}
              >
                {KIND_BADGE[s.kind]}
              </span>
            </Tooltip>
            <Tooltip label={s.name} withArrow disabled={s.name.length < 24}>
              <span
                style={{
                  flex: 1,
                  fontSize: 11,
                  color: T.text,
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                }}
              >
                {s.name}
              </span>
            </Tooltip>
            {meta && (
              <span style={{ fontSize: 10, color: T.textMuted, flexShrink: 0 }}>{meta}</span>
            )}
            <Tooltip
              label={isFind ? `Run "${s.name}" in this tab` : `Open "${s.name}" in a new tab`}
              withArrow
            >
              <Button
                variant="light"
                size="compact-xs"
                onClick={() => void handlePrimary(s)}
                styles={{ root: { fontSize: 10 } }}
              >
                {isFind ? '▶ Run' : '↗ Open'}
              </Button>
            </Tooltip>
          </Group>
        );
      })}
    </div>
  );
}
