import { Button } from '@mantine/core';
import { IconCopy, IconExternalLink } from '@tabler/icons-react';
import { themeVars } from '../../theme/themeVars';
import { copyToClipboard } from '../../utils/clipboard';
import { humanBytes } from '../../utils/humanBytes';
import type { AgentCallRow } from '@shared/types';
import { isRefusedRow, outcomeWords, querySeed, requestText, type QuerySeed } from './activityRow';

const T = themeVars;
const MONO = 'var(--atelier-font-mono, "JetBrains Mono", monospace)';

function outcomeLine(row: AgentCallRow): string {
  if (row.outcome === 'ok') return 'ok';
  if (row.outcome === 'INPUT_REQUIRED') return `asked you to open ${row.connectionName ?? 'the Connection'}`;
  return `refused · ${outcomeWords(row.outcome)} (${row.outcome})`;
}

/**
 * One call opened (X30 §5.2): the request as sent, as JSON text, the limits
 * applied and the outcome. Open as query only for an `ok`, uncut find, count
 * or aggregate, and it never runs; Copy on every row.
 */
export function ActivityDetail({ row, pending, onOpenQuery }: { row: AgentCallRow; pending: boolean; onOpenQuery: (seed: QuerySeed) => void }) {
  const text = requestText(row);
  const seed = querySeed(row);
  const limits = [
    `${row.docCount} ${row.docCount === 1 ? 'document' : 'documents'}`,
    humanBytes(row.bytes),
    `${row.durationMs} ms`,
    row.truncated ? 'result cut at its size budget' : null,
    row.requestTruncated ? 'request cut at 16 KiB: only its start is kept' : null,
  ].filter((x): x is string => x !== null);
  return (
    <div
      data-testid="activity-detail"
      role="region"
      aria-label="Call detail"
      style={{
        padding: '10px 14px 12px',
        borderTop: `1px solid ${T.border}`,
        background: isRefusedRow(row) ? T.warnSoft : T.surfaceRaised,
        display: 'flex',
        flexDirection: 'column',
        gap: themeVars.gapSm,
        minWidth: 0,
      }}
    >
      <dl style={{ display: 'grid', gridTemplateColumns: '90px minmax(0,1fr)', rowGap: themeVars.gapXs, columnGap: themeVars.gapMd, margin: 0, fontSize: T.fsSm }}>
        <dt style={{ color: T.textGhost }}>Outcome</dt>
        <dd data-testid="activity-detail-outcome" style={{ margin: 0 }}>
          {outcomeLine(row)}
        </dd>
        <dt style={{ color: T.textGhost }}>Limits</dt>
        <dd style={{ margin: 0 }}>{limits.join(' · ')}</dd>
      </dl>
      <div style={{ fontSize: T.fsXs, color: T.textGhost }}>Request, as the Agent sent it</div>
      <pre
        data-testid="activity-request"
        style={{
          margin: 0,
          maxHeight: 240,
          overflow: 'auto',
          padding: '6px 8px',
          borderRadius: T.rs,
          border: `1px solid ${T.border}`,
          background: T.surface,
          fontFamily: MONO,
          fontSize: T.fsXs,
          whiteSpace: 'pre-wrap',
          overflowWrap: 'anywhere',
        }}
      >
        {pending ? 'Reading the request…' : (text ?? 'No request was stored for this call.')}
      </pre>
      <div style={{ display: 'flex', gap: themeVars.gapXs, flexWrap: 'wrap' }}>
        {seed && (
          <Button size="compact-sm" leftSection={<IconExternalLink size={12} aria-hidden="true" />} onClick={() => onOpenQuery(seed)}>
            Open as query
          </Button>
        )}
        <Button
          size="compact-sm"
          variant="default"
          leftSection={<IconCopy size={12} aria-hidden="true" />}
          disabled={row.request === null}
          onClick={() => {
            if (row.request !== null) void copyToClipboard(text ?? row.request, 'Request copied to the clipboard');
          }}
        >
          Copy
        </Button>
      </div>
      {seed && (
        <div style={{ fontSize: T.fsXs, color: T.textGhost }}>
          Open as query fills a tab with it and does not run it: it would run with your permissions, so read it and press Run.
        </div>
      )}
    </div>
  );
}
