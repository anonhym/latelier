import { Button } from '@mantine/core';
import { themeVars } from '../../theme/themeVars';
import { useConnections } from '../../state/connections';
import { dismissPasteWarning, usePasteWarning, type PasteWarning } from '../../state/pasteWarning';
import { useSettings } from '../SettingsContext';

interface PasteWarningStripProps {
  tabId: string;
  /** The Connection of the tab, which the pasted value was not copied on. */
  connectionId: string;
  /** The surfaces this host sits under: it shows the warning only when one of them took the paste. */
  surfaces: readonly string[];
}

/**
 * The inline strip under a query surface that took a Cross-Connection Paste
 * (X25 §4): where the value was copied from, which Connection this tab is on,
 * and how to dismiss or switch the warning off. After a Run that found nothing
 * it turns into the stronger "No results" wording and stays until dismissed.
 *
 * Mounts nothing, and reads nothing, until the tab holds a warning for one of
 * its surfaces.
 */
export function PasteWarningStrip({ tabId, connectionId, surfaces }: PasteWarningStripProps) {
  const warning = usePasteWarning(tabId);
  if (!warning || !surfaces.includes(warning.surface)) return null;
  return <StripBody tabId={tabId} connectionId={connectionId} warning={warning} />;
}

function StripBody({ tabId, connectionId, warning }: { tabId: string; connectionId: string; warning: PasteWarning }) {
  const T = themeVars;
  const { connections } = useConnections();
  const settings = useSettings();
  const from = connections.find((c) => c.id === warning.from.connectionId);
  const here = connections.find((c) => c.id === connectionId);
  const fromName = from?.name ?? 'another connection';
  const hereName = here?.name ?? 'this connection';
  const sharedFamily =
    from?.familyId != null && from.familyId === here?.familyId ? (from.familyName ?? null) : null;
  const dismiss = () => dismissPasteWarning(tabId);

  return (
    // The Escape handler sits on the strip itself so it catches the key from its own buttons; the strip is a status line, not a control.
    <div
      role="status"
      data-testid="paste-warning-strip"
      data-emphasised={warning.emphasised || undefined}
      onKeyDown={(e) => {
        if (e.key !== 'Escape') return;
        e.stopPropagation();
        dismiss();
      }}
      style={{
        display: 'flex',
        alignItems: 'center',
        flexWrap: 'wrap',
        columnGap: T.gapSm,
        padding: '4px 12px',
        fontSize: T.fsXs,
        color: warning.emphasised ? T.warnText : T.textMuted,
        background: warning.emphasised ? T.warnSoft : T.surfaceRaised,
        borderTop: `1px solid ${warning.emphasised ? T.warnBorder : T.border}`,
      }}
    >
      <span style={{ flex: '1 1 auto', minWidth: 0 }}>
        {warning.emphasised ? (
          <>
            No results, and this value was copied from <strong>{fromName}</strong>.
          </>
        ) : (
          <>
            Copied from <strong>{fromName}</strong> · <code>{`${warning.from.dbName}.${warning.from.collection}`}</code>.
            This tab is on <strong>{hereName}</strong>.
          </>
        )}
        {sharedFamily !== null && (
          <>
            {' '}(both in <em>{sharedFamily}</em>)
          </>
        )}
      </span>
      <Button type="button" variant="subtle" color="gray" size="compact-xs" onClick={() => settings.open('editor')}>
        Settings
      </Button>
      <Button type="button" variant="subtle" color="gray" size="compact-xs" onClick={dismiss}>
        Dismiss
      </Button>
    </div>
  );
}
