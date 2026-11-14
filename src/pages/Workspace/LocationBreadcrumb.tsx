import React from 'react';
import { Button, Menu, TextInput } from '@mantine/core';
import { themeVars } from '../../theme/themeVars';
import type { WorkspaceTab } from '@shared/types';
import { ConnectionSwitcher, type ConnectionSwitcherProps } from '../../features/connections/ConnectionSwitcher';
import type { ConnectionCache } from './navigatorTreeReducer';
import type { LocationModel } from './locationModel';
import { ownGet } from '../../utils/ownProperty';

export interface LocationBreadcrumbProps {
  model: LocationModel;
  /** The Focused Tab, whose namespace the database and collection lists start from. */
  active: WorkspaceTab | null;
  switcherProps: Omit<ConnectionSwitcherProps, 'variant'>;
  /** The navigator's cache: the lists read what it already holds and load what it lacks. */
  caches: Readonly<Record<string, ConnectionCache>>;
  loadDbs: (connectionId: string) => unknown;
  loadColls: (connectionId: string, dbName: string) => unknown;
  /** `newTab`: ⌘-click or ⌘↵, a second tab rather than the reuse rule. */
  onOpenCollection: (
    input: { connectionId: string; dbName: string; collection: string },
    opts: { newTab: boolean },
  ) => void;
  /** The no-tab segment: the palette on its Collections scope. */
  onChooseCollection: () => void;
}

const T = themeVars;

function Separator() {
  return (
    <span aria-hidden style={{ color: T.textGhost, fontSize: T.fsSm, flexShrink: 0 }}>
      ›
    </span>
  );
}

function segmentStyles(last: boolean) {
  return {
    root: { color: T.text, minWidth: 0, flexShrink: 1 },
    label: { fontWeight: last ? 600 : 500, overflow: 'hidden', textOverflow: 'ellipsis' },
  };
}

const isNewTab = (e: React.MouseEvent | React.KeyboardEvent) => e.metaKey || e.ctrlKey;

/** One collection row of a dropdown; ⌘↵ is caught here because Enter's click carries no modifier. */
function CollectionItem({
  name,
  current,
  onPick,
}: {
  name: string;
  current: boolean;
  onPick: (name: string, newTab: boolean) => void;
}) {
  return (
    <Menu.Item
      onClick={(e) => onPick(name, isNewTab(e))}
      onKeyDown={(e) => {
        if (e.key === 'Enter' && isNewTab(e)) {
          e.preventDefault();
          onPick(name, true);
        }
      }}
      aria-current={current || undefined}
      style={current ? { fontWeight: 600 } : undefined}
    >
      {name}
    </Menu.Item>
  );
}

/** What a list shows while its source is still loading or failed. */
function Placeholder({ loading }: { loading: boolean }) {
  return (
    <div style={{ padding: '6px 12px', fontSize: T.fsXs, color: T.textMuted }}>
      {loading ? 'Loading…' : 'Could not load the list'}
    </div>
  );
}

const DROPDOWN_LIST: React.CSSProperties = { maxHeight: 320, overflowY: 'auto' };

/**
 * The title bar's location: `● {connection} › {database} › {collection}`
 * (W01 §14.2). Each segment opens the list it names: the Switcher, the
 * Connection's databases, the sibling collections.
 */
export function LocationBreadcrumb({
  model,
  active,
  switcherProps,
  caches,
  loadDbs,
  loadColls,
  onOpenCollection,
  onChooseCollection,
}: LocationBreadcrumbProps) {
  const connectionId = model.connection?.id ?? null;
  const cache = connectionId ? ownGet(caches, connectionId) : undefined;
  const dbName = active?.kind === 'collection' ? active.dbName : null;
  const collection = active?.kind === 'collection' ? active.collection : null;

  // The database dropdown first lists databases; choosing one swaps the same
  // dropdown to that database's collections.
  const [pickedDb, setPickedDb] = React.useState<string | null>(null);
  const [filter, setFilter] = React.useState('');

  const collsOf = (db: string) => (cache ? ownGet(cache.colls, db) : undefined);
  const collNames = (db: string) => collsOf(db)?.map((c) => c.name) ?? null;
  // Never asked reads as loading; a finished load with no list is a failure.
  const collsLoading = (db: string) => (cache ? ownGet(cache.collsLoading, db) : undefined) ?? true;

  const ensureColls = (db: string) => {
    if (connectionId && !collsOf(db) && !(cache && ownGet(cache.collsLoading, db))) loadColls(connectionId, db);
  };

  const pick = (db: string) => (name: string, newTab: boolean) => {
    if (connectionId) onOpenCollection({ connectionId, dbName: db, collection: name }, { newTab });
  };

  const collectionItems = (db: string, names: readonly string[]) =>
    names.map((name) => (
      <CollectionItem
        key={name}
        name={name}
        current={db === dbName && name === collection}
        onPick={pick(db)}
      />
    ));


  const segments = model.segments.map((seg, i) => {
    const last = i === model.segments.length - 1;
    switch (seg.kind) {
      case 'choose':
        return (
          <Button
            key={seg.kind}
            variant="subtle"
            color="gray"
            size="compact-xs"
            onClick={onChooseCollection}
            styles={{ ...segmentStyles(last), root: { color: T.textMuted } }}
          >
            {seg.label}
          </Button>
        );
      case 'script':
        return (
          <span
            key={seg.kind}
            style={{
              fontSize: T.fsSm,
              fontWeight: 600,
              padding: '0 6px',
              whiteSpace: 'nowrap',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
            }}
          >
            {seg.label}
          </span>
        );
      case 'database': {
        const names = pickedDb ? collNames(pickedDb) : null;
        return (
          <Menu
            key={seg.kind}
            position="bottom-start"
            closeOnItemClick
            onOpen={() => {
              setPickedDb(null);
              if (connectionId && !cache?.dbs && !cache?.dbsLoading) loadDbs(connectionId);
            }}
          >
            <Menu.Target>
              <Button
                variant="subtle"
                color="gray"
                size="compact-xs"
                aria-label={`Database: ${seg.label}`}
                styles={segmentStyles(last)}
              >
                {seg.label}
              </Button>
            </Menu.Target>
            <Menu.Dropdown>
              {pickedDb ? (
                <>
                  <Menu.Item closeMenuOnClick={false} onClick={() => setPickedDb(null)}>
                    ‹ Databases
                  </Menu.Item>
                  <Menu.Label>{pickedDb}</Menu.Label>
                  <div style={DROPDOWN_LIST}>
                    {names ? (
                      collectionItems(pickedDb, names)
                    ) : (
                      <Placeholder loading={collsLoading(pickedDb)} />
                    )}
                  </div>
                </>
              ) : (
                <div style={DROPDOWN_LIST}>
                  {cache?.dbs ? (
                    cache.dbs.map((d) => (
                      <Menu.Item
                        key={d.name}
                        closeMenuOnClick={false}
                        aria-current={d.name === dbName || undefined}
                        style={d.name === dbName ? { fontWeight: 600 } : undefined}
                        onClick={() => {
                          setPickedDb(d.name);
                          ensureColls(d.name);
                        }}
                      >
                        {d.name}
                      </Menu.Item>
                    ))
                  ) : (
                    <Placeholder loading={!cache?.err} />
                  )}
                </div>
              )}
            </Menu.Dropdown>
          </Menu>
        );
      }
      case 'collection': {
        const db = dbName!;
        const all = collNames(db);
        const needle = filter.trim().toLowerCase();
        const shown = all?.filter((n) => n.toLowerCase().includes(needle)) ?? null;
        return (
          <Menu
            key={seg.kind}
            position="bottom-start"
            onOpen={() => {
              setFilter('');
              ensureColls(db);
            }}
          >
            <Menu.Target>
              <Button
                variant="subtle"
                color="gray"
                size="compact-xs"
                aria-label={`Collection: ${seg.label}`}
                styles={segmentStyles(last)}
              >
                {seg.label}
              </Button>
            </Menu.Target>
            <Menu.Dropdown>
              <TextInput
                size="xs"
                placeholder="Filter collections"
                aria-label="Filter collections"
                value={filter}
                onChange={(e) => setFilter(e.currentTarget.value)}
                data-autofocus
                style={{ padding: 4 }}
              />
              <div style={DROPDOWN_LIST}>
                {shown ? (
                  shown.length > 0 ? (
                    collectionItems(db, shown)
                  ) : (
                    <div style={{ padding: '6px 12px', fontSize: T.fsXs, color: T.textMuted }}>
                      No collection matches
                    </div>
                  )
                ) : (
                  <Placeholder loading={collsLoading(db)} />
                )}
              </div>
            </Menu.Dropdown>
          </Menu>
        );
      }
    }
  });

  return (
    <nav
      aria-label="Location"
      style={{ display: 'flex', alignItems: 'center', gap: T.gapXs, minWidth: 0, overflow: 'hidden' }}
    >
      <ConnectionSwitcher {...switcherProps} focusedConnectionId={connectionId} />
      {segments.map((s, i) => (
        <React.Fragment key={i}>
          <Separator />
          {s}
        </React.Fragment>
      ))}
    </nav>
  );
}
