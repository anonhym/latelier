import React from 'react';
import { Button, UnstyledButton } from '@mantine/core';
import { themeVars } from '../../theme/themeVars';
import { formatShortcut } from '../../commands/shortcutLabel';
import { isMacRenderer } from '../../utils/platform';
import { ownGet } from '../../utils/ownProperty';
import type { ConnectionSummary } from '@shared/types';
import type { ConnectionCache } from './navigatorTreeReducer';

const MAX_ROWS = 8;
const SYSTEM_DBS = new Set(['admin', 'config', 'local']);

interface ConnectedCanvasProps {
  connection: ConnectionSummary;
  /** The navigator's cache for `connection`; what is missing is loaded from here. */
  cache: ConnectionCache | undefined;
  loadDbs: (connectionId: string) => unknown;
  loadColls: (connectionId: string, dbName: string) => unknown;
  onOpen: (input: { connectionId: string; dbName: string; collection: string }) => void;
  onSearch: () => void;
}

/**
 * A Connection open and no tab in front (W01 §14.7): a few of its collections
 * to open in one click, and the palette for the rest.
 */
export function ConnectedCanvas({ connection, cache, loadDbs, loadColls, onOpen, onSearch }: ConnectedCanvasProps) {
  const T = themeVars;
  // User databases first: admin/config/local are rarely where the work is.
  const dbs = React.useMemo(
    () => [...(cache?.dbs ?? [])].sort((a, b) => Number(SYSTEM_DBS.has(a.name)) - Number(SYSTEM_DBS.has(b.name))),
    [cache?.dbs],
  );
  const rows: { dbName: string; name: string; count?: number }[] = [];
  for (const db of dbs) {
    for (const c of (cache && ownGet(cache.colls, db.name)) ?? []) {
      if (rows.length < MAX_ROWS) rows.push({ dbName: db.name, name: c.name, count: c.documentCount });
    }
  }

  // Load only as far as the list needs: one database's collections at a time
  // until eight are known. Each database is asked once, so a failed read
  // does not retry in a loop.
  const asked = React.useRef(new Set<string>());
  const id = connection.id;
  React.useEffect(() => {
    if (!cache?.dbs) {
      if (!cache?.dbsLoading && !cache?.err && !asked.current.has('')) {
        asked.current.add('');
        loadDbs(id);
      }
      return;
    }
    if (rows.length >= MAX_ROWS || Object.values(cache.collsLoading).some(Boolean)) return;
    const next = dbs.find((d) => !ownGet(cache.colls, d.name) && !asked.current.has(d.name));
    if (next) {
      asked.current.add(next.name);
      loadColls(id, next.name);
    }
  });

  return (
    <div style={{ width: '100%', maxWidth: 560, margin: '0 auto', padding: '48px 16px' }}>
      <div style={{ fontSize: T.fsMd, fontWeight: 600, color: T.text, marginBottom: 12 }}>
        {connection.name} is connected
      </div>
      {rows.length > 0 && (
        <ul aria-label="Collections" style={{ listStyle: 'none', margin: '0 0 16px', padding: 0 }}>
          {rows.map((r) => (
            <li key={`${r.dbName}\u0000${r.name}`}>
              <UnstyledButton
                onClick={() => onOpen({ connectionId: id, dbName: r.dbName, collection: r.name })}
                style={{
                  display: 'flex',
                  width: '100%',
                  gap: T.gapSm,
                  padding: '6px 8px',
                  borderRadius: 4,
                  fontSize: T.fsSm,
                  color: T.text,
                }}
              >
                <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis' }}>
                  <span style={{ color: T.textMuted }}>{r.dbName}.</span>
                  {r.name}
                </span>
                {r.count !== undefined && (
                  <span style={{ color: T.textMuted, fontSize: T.fsXs }}>{r.count.toLocaleString()}</span>
                )}
              </UnstyledButton>
            </li>
          ))}
        </ul>
      )}
      <Button variant="default" size="xs" onClick={onSearch}>
        Search collections {formatShortcut('⌘P', isMacRenderer())}
      </Button>
    </div>
  );
}
