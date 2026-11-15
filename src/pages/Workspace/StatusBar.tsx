import { Badge } from '@mantine/core';
import { themeVars } from '../../theme/themeVars';
import type { ConnectionSummary } from '@shared/types';
import { STATUS_PRESENTATION } from '../../features/connections/connectionStatus';

/**
 * The 24px band along the bottom of the window (W01 §14.6): the Focused Tab's
 * Connection and nothing else. The result count and pager are the result bar's.
 */
export function StatusBar({ connection }: { connection: ConnectionSummary | null }) {
  const T = themeVars;
  return (
    <div
      data-testid="status-bar"
      style={{
        height: '100%',
        display: 'flex',
        alignItems: 'center',
        gap: T.gapMd,
        padding: '0 10px',
        boxSizing: 'border-box',
        borderTop: `1px solid ${T.border}`,
        background: T.surface,
        fontSize: T.fsXs,
        color: T.textMuted,
        whiteSpace: 'nowrap',
      }}
    >
      {connection && <ConnectionStatus connection={connection} />}
    </div>
  );
}

function ConnectionStatus({ connection }: { connection: ConnectionSummary }) {
  const T = themeVars;
  const presentation = STATUS_PRESENTATION[connection.status];
  const parts = [connection.name, connection.host];
  if (connection.status === 'connected' && connection.serverVersion) parts.push(`v${connection.serverVersion}`);
  return (
    <span
      data-testid="status-connection"
      style={{ display: 'inline-flex', alignItems: 'center', gap: T.gapXs, minWidth: 0, flex: '0 1 auto', overflow: 'hidden' }}
    >
      <span
        role="img"
        aria-label={presentation.spoken}
        style={{ width: 7, height: 7, borderRadius: '50%', background: presentation.band, flexShrink: 0 }}
      />
      <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>{parts.join(' · ')}</span>
      {connection.readOnly && (
        <Badge size="xs" variant="outline" color="gray" style={{ flexShrink: 0 }}>
          Read-only
        </Badge>
      )}
    </span>
  );
}
