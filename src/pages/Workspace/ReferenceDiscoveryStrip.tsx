import React from 'react';
import { Button } from '@mantine/core';
import { getErrorMessage } from '../../api/atelier';
import { notify } from '../../theme/notifications';
import { themeVars } from '../../theme/themeVars';
import { useReferenceSuggestion, type ReferenceSuggestion } from '../../state/referenceDiscovery';
import { pairLabel } from '../../utils/referenceDiscovery';
import {
  declineSuggestion,
  neverSuggest,
  saveSuggestion,
  type SuggestionScope,
} from './referenceDiscovery';

interface ReferenceDiscoveryStripProps {
  tabId: string;
}

/**
 * The inline offer to save a Reference Rule, under the query surfaces: a value
 * copied from one Collection turned up in another, so the two fields look like
 * a reference. Save, Not now and Never for this pair are the only ways the
 * strip goes; nothing is saved without a click on Save. Mounts nothing until
 * the tab holds a suggestion.
 */
export function ReferenceDiscoveryStrip({ tabId }: ReferenceDiscoveryStripProps) {
  const suggestion = useReferenceSuggestion(tabId);
  if (!suggestion) return null;
  return <StripBody tabId={tabId} suggestion={suggestion} />;
}

function StripBody({ tabId, suggestion }: { tabId: string; suggestion: ReferenceSuggestion }) {
  const T = themeVars;
  const [busy, setBusy] = React.useState(false);

  const run = (work: () => Promise<void>, failure: string) => {
    setBusy(true);
    work().catch((err: unknown) => notify.error(getErrorMessage(err, failure))).finally(() => setBusy(false));
  };
  const save = (scope: SuggestionScope) =>
    run(async () => {
      await saveSuggestion(tabId, suggestion, scope);
      notify.success(`Saved reference ${pairLabel(suggestion.pair)}.`);
    }, 'Could not save the reference rule.');
  const notNow = () => declineSuggestion(tabId, suggestion);

  return (
    // The Escape handler sits on the strip so it catches the key from its own buttons; the strip is a status line, not a control.
    <div
      role="status"
      data-testid="reference-discovery-strip"
      onKeyDown={(e) => {
        if (e.key !== 'Escape') return;
        e.stopPropagation();
        notNow();
      }}
      style={{
        display: 'flex',
        alignItems: 'center',
        flexWrap: 'wrap',
        columnGap: T.gapSm,
        padding: '4px 12px',
        fontSize: T.fsXs,
        color: T.textMuted,
        background: T.surfaceRaised,
        borderTop: `1px solid ${T.border}`,
      }}
    >
      <span style={{ flex: '1 1 auto', minWidth: 0 }}>
        Make <code>{pairLabel(suggestion.pair)}</code> a reference?
        {suggestion.family !== null && (
          <>
            {' '}It would be shared with <em>{suggestion.family.name}</em>.
          </>
        )}
      </span>
      <Button type="button" variant="subtle" size="compact-xs" disabled={busy} onClick={() => save('default')}>
        Save
      </Button>
      {suggestion.family !== null && (
        <Button type="button" variant="subtle" color="gray" size="compact-xs" disabled={busy} onClick={() => save('connection')}>
          Save for this connection only
        </Button>
      )}
      <Button type="button" variant="subtle" color="gray" size="compact-xs" disabled={busy} onClick={notNow}>
        Not now
      </Button>
      <Button
        type="button"
        variant="subtle"
        color="gray"
        size="compact-xs"
        disabled={busy}
        onClick={() => run(() => neverSuggest(tabId, suggestion), 'Could not remember that choice.')}
      >
        Never for this pair
      </Button>
    </div>
  );
}
