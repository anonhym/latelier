import React from 'react';
import { Button, Text } from '@mantine/core';
import { themeVars } from '../../theme/themeVars';
import { changeText, operatorSummary, type ChangeEntry } from './documentDiff';

/**
 * W18 §13.2 — what Save will send, one line per path of the same diff that
 * builds the request. Collapsed to `{n} changes` until opened.
 */
export function DocumentChangeStrip({ entries }: { entries: readonly ChangeEntry[] }) {
  const [open, setOpen] = React.useState(false);
  if (entries.length === 0) return null;
  const label = `${entries.length} ${entries.length === 1 ? 'change' : 'changes'}`;
  return (
    <div
      data-testid="document-editor-changes"
      style={{ flex: 'none', borderRadius: themeVars.rs, background: themeVars.surfaceRaised, padding: '2px 6px' }}
    >
      <Button
        type="button"
        size="compact-xs"
        variant="subtle"
        color="gray"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        px={4}
      >
        {`${open ? '▾' : '▸'} ${label}`}
        <Text span size="xs" c="dimmed" ml={8}>
          {operatorSummary(entries)}
        </Text>
      </Button>
      {open && (
        <ul aria-label="Changes" style={{ margin: 0, padding: '2px 4px 4px 20px', maxHeight: 120, overflow: 'auto' }}>
          {entries.map((entry) => {
            const { text, title } = changeText(entry);
            return (
              <li key={entry.path} title={title} style={{ fontFamily: 'monospace', fontSize: themeVars.fsXs, whiteSpace: 'nowrap' }}>
                {text}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
