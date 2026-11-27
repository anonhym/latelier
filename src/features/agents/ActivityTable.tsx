import React from 'react';
import { Button, UnstyledButton } from '@mantine/core';
import { themeVars } from '../../theme/themeVars';
import { ActivityDetail } from './ActivityDetail';
import { isRefusedRow, resultText, targetText, type ActivityFilter, type QuerySeed } from './activityRow';
import { clock, dayWord } from './agentsTime';
import { useActivityRows } from './useActivity';
import { useNow } from './useNow';

const T = themeVars;
const MONO = 'var(--atelier-font-mono, "JetBrains Mono", monospace)';
const COLUMNS = '58px 128px minmax(0,1fr) 150px';

/** How near the bottom a scroll reads older rows, in pixels. */
const NEAR_BOTTOM = 40;

/**
 * The Agent Read Log for one filter (X30 §5.2, §5.1): time, tool, target,
 * result, newest first, appended live. A refused row carries the warning
 * tint. A row opens its detail. Older rows load near the bottom of the
 * scroll, or with Load older.
 */
export function ActivityTable({
  filter,
  onOpenQuery,
  empty = 'No Agent calls yet.',
}: {
  filter: ActivityFilter;
  onOpenQuery: (seed: QuerySeed) => void;
  empty?: string;
}) {
  const { rows, pending, loading, exhausted, failed, loadOlder } = useActivityRows(filter);
  const [openId, setOpenId] = React.useState<string | null>(null);
  const now = useNow();
  const today = dayWord(new Date(now).toISOString(), now);

  return (
    <div data-testid="activity-table" style={{ minWidth: 0 }}>
      <div
        aria-hidden="true"
        style={{
          display: 'grid',
          gridTemplateColumns: COLUMNS,
          gap: themeVars.gapSm,
          padding: '0 14px',
          minHeight: 28,
          alignItems: 'center',
          fontSize: T.fsXs,
          color: T.textGhost,
          fontWeight: 500,
          borderTop: `1px solid ${T.border}`,
        }}
      >
        <span>Time</span>
        <span>Tool</span>
        <span>Target</span>
        <span style={{ textAlign: 'right' }}>Result</span>
      </div>
      <div
        data-testid="activity-scroll"
        style={{ maxHeight: 520, overflowY: 'auto' }}
        onScroll={(e) => {
          const el = e.currentTarget;
          if (el.scrollHeight - el.scrollTop - el.clientHeight < NEAR_BOTTOM) loadOlder();
        }}
      >
        {rows.length === 0 && (
          <p style={{ margin: 0, padding: '10px 14px', fontSize: T.fsSm, color: T.textMuted }}>
            {loading ? 'Loading…' : failed ? 'Could not read the Agent Read Log.' : empty}
          </p>
        )}
        <ul style={{ listStyle: 'none', margin: 0, padding: 0 }}>
          {rows.map((row) => {
            const refused = isRefusedRow(row);
            const open = openId === row.id;
            const day = dayWord(row.ts, now);
            return (
              <li key={row.id} data-testid="activity-row" data-refused={refused || undefined} data-call-id={row.id}>
                <UnstyledButton
                  aria-expanded={open}
                  onClick={() => setOpenId(open ? null : row.id)}
                  style={{
                    boxSizing: 'border-box',
                    width: '100%',
                    display: 'grid',
                    gridTemplateColumns: COLUMNS,
                    gap: themeVars.gapSm,
                    alignItems: 'center',
                    padding: '0 14px',
                    minHeight: 34,
                    fontSize: T.fsSm,
                    borderTop: `1px solid ${T.border}`,
                    background: refused ? T.warnSoft : open ? T.surfaceActive : undefined,
                  }}
                >
                  <span style={{ color: T.textGhost }} title={row.ts}>
                    {day === today ? clock(row.ts) : `${day} ${clock(row.ts)}`}
                  </span>
                  <span style={{ fontFamily: MONO, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={row.tool}>
                    {row.tool}
                  </span>
                  <span style={{ fontFamily: MONO, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={targetText(row)}>
                    {targetText(row)}
                  </span>
                  <span
                    data-testid="activity-result"
                    style={{ textAlign: 'right', color: refused ? T.warnText : T.textMuted, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
                    title={resultText(row)}
                  >
                    {resultText(row)}
                  </span>
                </UnstyledButton>
                {open && <ActivityDetail row={row} pending={pending.has(row.id)} onOpenQuery={onOpenQuery} />}
              </li>
            );
          })}
        </ul>
        {rows.length > 0 && !exhausted && (
          <div style={{ padding: '8px 14px', borderTop: `1px solid ${T.border}` }}>
            <Button size="compact-xs" variant="subtle" color="gray" onClick={loadOlder}>
              Load older
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}
