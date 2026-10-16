import React from 'react';
import { ActionIcon, Button, Menu, Pill, SegmentedControl, TagsInput, TextInput, Tooltip } from '@mantine/core';
import { themeVars } from '../../theme/themeVars';
import { I } from '../../icons';
import { useSuggestions } from '../../features/fieldSuggestions/useSuggestions';
import { SuggestionPopover } from '../../features/fieldSuggestions/SuggestionPopover';
import { DEFAULT_VALUE_SOURCES } from '../../features/fieldSuggestions/sources';
import type { SuggestionContext } from '../../features/fieldSuggestions/types';
import type { CondNode, ValType } from '@shared/types';
import {
  ARRAY_VALUE_OPS,
  SIMPLE_OPS,
  DATE_PRESETS,
  chipText,
  chipsFromValue,
  datePresetValue,
  isObjectIdHex,
  isoToLocalInput,
  localInputToIso,
  parseChipText,
  valueFromChips,
} from './condValue';

/** The only ops the value popover offers suggestions for — mirrors `RECORDABLE_OPS` in `RecentFieldValueService`. */
const VALUE_SUGGESTION_OPS = new Set(['$eq', '$ne', '$gt', '$gte', '$lt', '$lte', '$in', '$nin']);

/**
 * Mongosh-flavored preview of the typed value the user just entered. Shown
 * as a faint hint to the right of the value input so the user sees what
 * the wrapped MQL will look like (e.g. `ISODate("2026-04-01")`) without
 * having to read the generated query bar.
 */
function formatCondPreview(cond: { valType: ValType; value: string }): string {
  const v = cond.value;
  switch (cond.valType) {
    case 'string':
      return v ? `"${v}"` : '""';
    case 'number':
      return v || '0';
    case 'long':
      return v ? `NumberLong("${v}")` : 'NumberLong("…")';
    case 'decimal':
      return v ? `NumberDecimal("${v}")` : 'NumberDecimal("…")';
    case 'boolean':
      return v === 'true' ? 'true' : 'false';
    case 'date':
      return v ? `ISODate("${v}")` : 'ISODate("…")';
    case 'null':
      return 'null';
    case 'regex':
      return v ? `/${v}/` : '/…/';
    case 'objectid':
      return v ? `ObjectId("${v}")` : 'ObjectId("…")';
    case 'array':
      return v || '[]';
    default:
      return v || '…';
  }
}

/**
 * The value half of a condition row, shaped by its type and operator (W15
 * §14.3): nothing for `$exists` and `null`, chips for a list, a true / false
 * choice for a boolean, a date picker beside the text for a date, and a
 * 24-hex check on an ObjectId. Every other case is the plain text input with
 * its value suggestions.
 *
 * `onPatch`'s key names the box being typed into; the row turns it into its
 * own undo-coalescing key.
 */
export function CondValueEditor({
  node,
  readOnly,
  onPatch,
  suggestionContext,
}: {
  node: CondNode;
  readOnly: boolean;
  onPatch: (p: Partial<CondNode>, key?: string) => void;
  suggestionContext: SuggestionContext | null;
}) {
  const T = themeVars;
  // Value suggestions: gated on a non-empty field and one of
  // `VALUE_SUGGESTION_OPS` — every other op (`$exists`, `$regex`, `$mod`, ...)
  // gets no popover, mirroring what `RecentFieldValueService` will ever
  // record for it.
  const valueInputRef = React.useRef<HTMLInputElement>(null);
  const [valuePopoverOpen, setValuePopoverOpen] = React.useState(false);
  const valueSuggestionsAllowed = node.field.trim() !== '' && VALUE_SUGGESTION_OPS.has(node.op);
  const valueSuggestionCtx = React.useMemo<SuggestionContext | null>(
    () =>
      suggestionContext && valueSuggestionsAllowed
        ? { ...suggestionContext, target: { field: node.field, operator: node.op } }
        : null,
    [suggestionContext, valueSuggestionsAllowed, node.field, node.op],
  );
  const { items: valueSuggestionItems } = useSuggestions(
    valuePopoverOpen ? valueSuggestionCtx : null,
    node.value,
    { valueSources: DEFAULT_VALUE_SOURCES },
  );
  // A list shows as chips until the person asks for the JSON, or starts
  // typing in the text box: a half-typed list that happens to parse must not
  // swap the box out from under the caret.
  const [listAsText, setListAsText] = React.useState(false);

  if (node.op === '$exists' || node.valType === 'null') return null;

  const isListOp = ARRAY_VALUE_OPS.has(node.op);
  const chips = isListOp ? chipsFromValue(node.value) : null;
  const listToggle = chips !== null && (
    <Button
      variant="subtle"
      color="gray"
      size="compact-xs"
      disabled={readOnly}
      onClick={() => setListAsText((v) => !v)}
      styles={{ root: { flexShrink: 0, fontSize: 10, padding: '0 4px' } }}
    >
      {listAsText ? 'Edit as chips' : 'Edit as JSON'}
    </Button>
  );

  if (chips !== null && !listAsText) {
    return (
      <div style={{ display: 'flex', gap: 4, alignItems: 'center', flex: 1, minWidth: 0 }}>
        <TagsInput
          aria-label="Values"
          placeholder="add a value, Enter"
          value={chips.map(chipText)}
          onChange={(tags) => onPatch({ value: valueFromChips(tags.map(parseChipText)) })}
          splitChars={[',', '\n']}
          // Mantine's own check ignores case, which would drop `"A"` from a
          // `$in` that already holds `"a"`; MongoDB treats them as different.
          isDuplicate={(v, current) => current.includes(v)}
          disabled={readOnly}
          size="xs"
          style={{ flex: 1, minWidth: 0 }}
          styles={{ input: { fontFamily: 'monospace' } }}
          // The stock remove button is hidden from assistive tech and out of
          // the tab order; named and focusable, each chip can be removed by
          // keyboard, not only the last one by Backspace.
          renderPill={({ value, onRemove, disabled }) => (
            <Pill
              withRemoveButton={!disabled}
              onRemove={onRemove}
              disabled={disabled}
              removeButtonProps={{ 'aria-label': `Remove ${value}`, 'aria-hidden': false, tabIndex: 0 }}
            >
              {value}
            </Pill>
          )}
        />
        {listToggle}
      </div>
    );
  }

  if (node.valType === 'boolean' && SIMPLE_OPS.has(node.op)) {
    return (
      <SegmentedControl
        aria-label="Value"
        size="xs"
        data={['true', 'false']}
        value={node.value === 'true' ? 'true' : 'false'}
        onChange={(v) => onPatch({ value: v })}
        disabled={readOnly}
      />
    );
  }

  const oidInvalid = node.valType === 'objectid' && node.value.trim() !== '' && !isObjectIdHex(node.value);
  const isDate = node.valType === 'date' && SIMPLE_OPS.has(node.op);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 2, flex: 1, minWidth: 0 }}>
      <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
        <TextInput
          ref={valueInputRef}
          placeholder="value"
          value={node.value}
          disabled={readOnly}
          onChange={(e) => {
            if (isListOp) setListAsText(true);
            onPatch({ value: e.target.value }, 'value');
            if (!valuePopoverOpen) setValuePopoverOpen(true);
          }}
          onFocus={() => setValuePopoverOpen(true)}
          onBlur={() => {
            window.setTimeout(() => setValuePopoverOpen(false), 100);
          }}
          aria-invalid={oidInvalid || undefined}
          error={oidInvalid}
          size="xs"
          style={{ flex: 1 }}
          styles={{ input: { fontFamily: 'monospace' } }}
        />
        {valueSuggestionsAllowed && (
          <SuggestionPopover
            open={valuePopoverOpen}
            items={valueSuggestionItems}
            anchorRef={valueInputRef}
            label="Value suggestions"
            onSelect={(s) => {
              if (s.kind === 'value') onPatch({ value: s.display });
              setValuePopoverOpen(false);
              valueInputRef.current?.blur();
            }}
            onClose={() => setValuePopoverOpen(false)}
          />
        )}
        {isDate && (
          <Menu position="bottom-end" shadow="md" width={220}>
            <Menu.Target>
              <ActionIcon variant="subtle" color="gray" size="sm" aria-label="Pick date" disabled={readOnly}>
                {I.clock}
              </ActionIcon>
            </Menu.Target>
            <Menu.Dropdown>
              <div style={{ padding: '4px 6px' }}>
                <input
                  type="datetime-local"
                  aria-label="Date and time"
                  value={isoToLocalInput(node.value)}
                  onChange={(e) => {
                    // Mid-edit the input reports '' until every segment is
                    // filled; writing that would blank the value under it.
                    const iso = localInputToIso(e.target.value);
                    if (iso) onPatch({ value: iso });
                  }}
                  onKeyDown={(e) => {
                    // The menu moves focus to its first item on ArrowUp /
                    // ArrowDown from anywhere inside it; in this input those
                    // keys step the focused date segment instead.
                    if (e.key === 'ArrowUp' || e.key === 'ArrowDown') e.stopPropagation();
                  }}
                  style={{
                    width: '100%',
                    font: 'inherit',
                    fontSize: 11,
                    padding: '3px 4px',
                    color: T.text,
                    background: T.surface,
                    border: `1px solid ${T.border}`,
                    borderRadius: T.rs,
                  }}
                />
              </div>
              <Menu.Divider />
              {DATE_PRESETS.map((p) => (
                <Menu.Item key={p.id} onClick={() => onPatch({ value: datePresetValue(p.id, new Date()) })}>
                  {p.label}
                </Menu.Item>
              ))}
            </Menu.Dropdown>
          </Menu>
        )}
        {listToggle}
        <Tooltip label={formatCondPreview(node)} withArrow>
          <span
            style={{
              fontSize: 9,
              color: T.textGhost,
              fontFamily: '"JetBrains Mono", monospace',
              flexShrink: 0,
              maxWidth: 90,
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}
          >
            {formatCondPreview(node)}
          </span>
        </Tooltip>
      </div>
      {oidInvalid && (
        <span role="alert" style={{ fontSize: 10, color: T.warn, lineHeight: 1.3 }}>
          ObjectId must be 24 hex characters
        </span>
      )}
    </div>
  );
}
