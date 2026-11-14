import React from 'react';
import { ActionIcon } from '@mantine/core';
import { I } from '../../../icons';
import { copyToClipboard } from '../../../utils/clipboard';
import { isRecord } from '../../../utils/displayValue';
import { getDocId, getDocIdText } from './docId';

/**
 * A row's visible id (W06 §8.4): plain monospace in the neutral text colour,
 * the full id as its tooltip, and a copy control that appears on hover or
 * focus. The control sits inside the row's own click target, so it stops the
 * click from reaching the row's expand handler.
 */
export function DocIdLabel({ doc }: { doc: unknown }) {
  const [shown, setShown] = React.useState(false);
  const short = getDocId(doc);
  const full = getDocIdText(doc);
  const hasId = isRecord(doc) && doc._id !== undefined && doc._id !== null;
  return (
    <span
      onMouseEnter={() => setShown(true)}
      onMouseLeave={() => setShown(false)}
      onFocus={() => setShown(true)}
      onBlur={() => setShown(false)}
      style={{ display: 'inline-flex', alignItems: 'center', flexShrink: 0, minWidth: 68 }}
    >
      <span
        title={full}
        style={{
          fontFamily: 'monospace',
          fontSize: 'var(--atelier-fs-xs)',
          color: 'var(--atelier-text)',
          fontWeight: 600,
        }}
      >
        {short}
      </span>
      {hasId && (
        <ActionIcon
          variant="subtle"
          color="gray"
          size={18}
          // Out of the Tab order: a page of rows must stay one tab stop, and the row's
          // `⋯` menu and ⌘⇧C already copy the id and the document by keyboard.
          tabIndex={-1}
          c="var(--atelier-text-muted)"
          aria-label={`Copy _id of document ${short}`}
          title="Copy _id"
          onClick={(e) => {
            e.stopPropagation();
            void copyToClipboard(full, 'Document id copied to the clipboard.');
          }}
          style={{ opacity: shown ? 1 : 0 }}
        >
          {I.copy}
        </ActionIcon>
      )}
    </span>
  );
}
