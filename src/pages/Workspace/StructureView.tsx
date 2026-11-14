import React from 'react';
import { Button } from '@mantine/core';
import type { SchemaTabState } from '@shared/types';
import { themeVars } from '../../theme/themeVars';
import { I } from '../../icons';
import { SubmitButton } from '../../components/SubmitButton';
import { IndexesTab, type IndexCreateRequest } from '../IndexesTab';
import { CollectionStatsSection } from './CollectionStatsSection';
import { SchemaView } from './SchemaView';
import { ValidationSection } from './ValidationSection';
import { useCollectionDetails } from './useCollectionDetails';

interface Props {
  connectionId: string;
  dbName: string;
  collection: string;
  state: SchemaTabState;
  onPatch: (patch: Partial<SchemaTabState>) => void;
  /** See `IndexCreateRequest` — threaded straight through to `IndexesTab`. */
  initialCreate?: IndexCreateRequest | null;
  onInitialCreateConsumed?: () => void;
  /** An index was created or dropped: the collection header's index count is stale. */
  onChanged?: () => void;
  /** Schema row menu: adds the field to the Documents filter. Omitted: no such item. */
  onFilterField?: (path: string) => void;
  /** A Read-Only Connection: the schema row menu offers no index creation. */
  readOnly?: boolean;
}

type SectionKey = 'Indexes' | 'Schema' | 'Validation';

const findSection = (root: ParentNode, key: SectionKey) =>
  root.querySelector<HTMLElement>(`[role="region"][aria-label="${key}"]`);

/**
 * The collection tab's "Schema & indexes" view (W16 §16, ADR 0003): a stat
 * strip, section pills, then the namespace-scoped indexes, the sampled schema
 * and the validation rules, in one scrolling pane rather than extra tabs.
 * `IndexesTab` and `SchemaView` lay out at natural content height, so this
 * pane is the only scroller (a `flex:1; overflow:auto` child of an auto-height
 * ancestor collapses toward zero). The one Refresh reloads the statistics, the
 * indexes and the validation rules; sampling the schema stays its own button.
 */
export function StructureView({
  connectionId,
  dbName,
  collection,
  state,
  onPatch,
  initialCreate,
  onInitialCreateConsumed,
  onChanged,
  onFilterField,
  readOnly,
}: Props) {
  const T = themeVars;
  const { details, error, loading, reload } = useCollectionDetails(connectionId, dbName, collection);
  const [indexesReload, setIndexesReload] = React.useState(0);
  // A row menu's "Create index" is a request like the explain drawer's; the
  // latest of the two wins, and either clears through the one consumed callback.
  const [rowCreate, setRowCreate] = React.useState<IndexCreateRequest | null>(null);
  const [active, setActive] = React.useState<SectionKey>('Indexes');
  const pane = React.useRef<HTMLDivElement>(null);
  const isView = details?.type === 'view';
  const hasValidation = details?.type === 'collection';
  const pills: { key: SectionKey; label: string }[] = [
    { key: 'Indexes', label: `Indexes${details?.stats?.indexCount === undefined ? '' : ` ${details.stats.indexCount}`}` },
    { key: 'Schema', label: `Schema${state.entries && !state.errorMessage ? ` ${state.entries.length} ${state.entries.length === 1 ? 'field' : 'fields'}` : ''}` },
    ...(hasValidation ? [{ key: 'Validation' as const, label: 'Validation' }] : []),
  ];
  const ready = !!(details || error);

  // Scroll-spy: the section nearest the top of the pane is the one in view.
  // ponytail: jsdom and old engines have no IntersectionObserver; the pills still jump, they just don't follow.
  React.useEffect(() => {
    if (!ready || typeof IntersectionObserver === 'undefined') return;
    const root = pane.current;
    if (!root) return;
    const visible = new Map<SectionKey, number>();
    const observer = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          const key = (e.target as HTMLElement).getAttribute('aria-label') as SectionKey;
          if (e.isIntersecting) visible.set(key, e.boundingClientRect.top);
          else visible.delete(key);
        }
        const first = [...visible.entries()].sort((a, b) => a[1] - b[1])[0];
        if (first) setActive(first[0]);
      },
      { root },
    );
    for (const k of ['Indexes', 'Schema', 'Validation'] as const) {
      const el = findSection(root, k);
      if (el) observer.observe(el);
    }
    return () => observer.disconnect();
  }, [ready, hasValidation, isView]);

  const refresh = () => {
    void reload();
    setIndexesReload((n) => n + 1);
  };

  return (
    <div ref={pane} data-structure-pane="" style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'auto' }}>
      <div
        style={{
          flex: 'none',
          // The marked pill is only useful while it is in view.
          position: 'sticky',
          top: 0,
          zIndex: 2,
          display: 'flex',
          alignItems: 'center',
          gap: T.gapSm,
          padding: '8px 16px',
          borderBottom: `1px solid ${T.border}`,
          background: T.surface,
        }}
      >
        <nav aria-label="Sections" style={{ flex: 1, display: 'flex', gap: T.gapSm }}>
          {ready &&
            pills.map((p) => (
              <Button
                key={p.key}
                size="compact-xs"
                radius="xl"
                variant={active === p.key ? 'light' : 'subtle'}
                aria-current={active === p.key ? 'true' : undefined}
                onClick={(e) => {
                  setActive(p.key);
                  const root = e.currentTarget.closest('[data-structure-pane]');
                  if (root) findSection(root, p.key)?.scrollIntoView?.({ block: 'start' });
                }}
              >
                {p.label}
              </Button>
            ))}
        </nav>
        <SubmitButton size="compact-xs" variant="subtle" leftSection={I.sync} onClick={refresh} submitting={loading}>
          Refresh
        </SubmitButton>
      </div>
      <CollectionStatsSection details={details} error={error} loading={loading} />
      {/* Held until the details settle: a view must never be asked for its
          indexes, and everything below appears in place at once rather than
          being pushed down by the sections above it as they arrive. */}
      {ready && (
        <>
          <IndexesTab
            connectionId={connectionId}
            dbName={dbName}
            collection={collection}
            viewOn={details?.type === 'view' ? details.options.viewOn : undefined}
            expectedCount={details?.stats?.indexCount}
            initialCreate={rowCreate ?? initialCreate}
            onInitialCreateConsumed={() => {
              // Only the request that opened the drawer is spent; a pending
              // explain-drawer request behind a row's one still opens next.
              if (rowCreate) setRowCreate(null);
              else onInitialCreateConsumed?.();
            }}
            reloadSignal={indexesReload}
            onChanged={() => {
              void reload();
              onChanged?.();
            }}
          />
          <SchemaView
            connectionId={connectionId}
            dbName={dbName}
            collection={collection}
            state={state}
            onPatch={onPatch}
            onFilterField={onFilterField}
            onCreateIndex={
              isView || readOnly
                ? undefined
                : (path) =>
                    setRowCreate({
                      requestId: crypto.randomUUID(),
                      suggestion: { keys: [{ field: path, direction: 1 }], reason: `An index on ${path}.` },
                    })
            }
          />
          {/* The server refuses collMod rules on a view and on a time-series collection. */}
          {details?.type === 'collection' && (
            <ValidationSection
              connectionId={connectionId}
              dbName={dbName}
              collection={collection}
              details={details}
              onSaved={reload}
            />
          )}
        </>
      )}
    </div>
  );
}
