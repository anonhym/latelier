import { Button, Group, Text } from '@mantine/core';
import { themeVars } from '../../theme/themeVars';
import { oneLineValue, type ConflictRow } from './documentDiff';

export type ConflictChoice = 'mine' | 'theirs';

const BOX = { fontSize: themeVars.fsSm, padding: '6px 8px', borderRadius: themeVars.rs, flex: 'none' } as const;

function Cell({ side }: { side: ConflictRow['yours'] }) {
  if (side === null) return <span aria-label="absent">—</span>;
  const full = oneLineValue(side.value, Number.POSITIVE_INFINITY);
  return <span title={full}>{oneLineValue(side.value)}</span>;
}

/**
 * W18 §13.3 — the document changed under the editor: every path either side
 * touched, and for each one both did, a choice. Controlled: the editor owns
 * the choices, so Save can stay disabled until they are complete.
 */
export function DocumentConflictPanel({
  rows,
  choices,
  onChoose,
  onChooseAll,
}: {
  rows: readonly ConflictRow[];
  choices: ReadonlyMap<string, ConflictChoice>;
  onChoose: (path: string, choice: ConflictChoice) => void;
  onChooseAll: (choice: ConflictChoice) => void;
}) {
  const hasBoth = rows.some((r) => r.changedBy === 'both');
  return (
    <div role="region" aria-label="Conflicting changes" style={{ ...BOX, background: themeVars.warnSoft, color: themeVars.warnText }}>
      <div role="alert">
        This document changed since you opened it.
        {hasBoth ? ' Choose what to keep for each field you both changed.' : ' Nothing clashes; Save applies your changes to the current version.'}
      </div>
      {hasBoth && (
        <Group gap={themeVars.gapXs} mt={6}>
          <Button size="compact-xs" variant="default" onClick={() => onChooseAll('mine')}>
            Keep all mine
          </Button>
          <Button size="compact-xs" variant="default" onClick={() => onChooseAll('theirs')}>
            Take all theirs
          </Button>
        </Group>
      )}
      <div style={{ maxHeight: 150, overflow: 'auto', marginTop: 6 }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontFamily: 'monospace', fontSize: themeVars.fsXs }}>
          <thead>
            <tr style={{ textAlign: 'left' }}>
              <th scope="col">Field</th>
              <th scope="col">Yours</th>
              <th scope="col">Now on server</th>
              <th scope="col">Changed by</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => {
              const chosen = choices.get(row.path);
              return (
                <tr key={row.path} data-conflict-path={row.path}>
                  <th scope="row" style={{ textAlign: 'left', fontWeight: 'normal' }}>
                    {row.path}
                  </th>
                  <td>
                    <Cell side={row.yours} />
                  </td>
                  <td>
                    <Cell side={row.theirs} />
                  </td>
                  <td>
                    {row.changedBy}
                    {row.changedBy === 'both' && (
                      <Group gap={themeVars.gapXs} ml={6} display="inline-flex" role="group" aria-label={`Resolve ${row.path}`}>
                        <Button
                          size="compact-xs"
                          variant={chosen === 'mine' ? 'filled' : 'default'}
                          aria-pressed={chosen === 'mine'}
                          onClick={() => onChoose(row.path, 'mine')}
                        >
                          Keep mine
                        </Button>
                        <Button
                          size="compact-xs"
                          variant={chosen === 'theirs' ? 'filled' : 'default'}
                          aria-pressed={chosen === 'theirs'}
                          onClick={() => onChoose(row.path, 'theirs')}
                        >
                          Take theirs
                        </Button>
                      </Group>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/** W18 §13.4 — the document is gone; the draft still has somewhere to go. */
export function DeletedDocumentPanel({
  busy,
  onInsert,
  onCopy,
}: {
  busy: boolean;
  onInsert: () => void;
  onCopy: () => void;
}) {
  return (
    <div role="alert" style={{ ...BOX, background: themeVars.redSoft, color: themeVars.redText }}>
      <Text size="sm" c="inherit">
        This document was deleted since you opened it. Your edits are still here.
      </Text>
      <Group gap={themeVars.gapXs} mt={6}>
        <Button size="compact-xs" variant="default" disabled={busy} onClick={onInsert}>
          Insert as new document
        </Button>
        <Button size="compact-xs" variant="default" onClick={onCopy}>
          Copy my version
        </Button>
      </Group>
    </div>
  );
}
