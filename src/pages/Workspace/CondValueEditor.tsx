import React from 'react';
import { ActionIcon, Button, Menu, Pill, Popover, SegmentedControl, TagsInput, TextInput } from '@mantine/core';
import { themeVars } from '../../theme/themeVars';
import { I } from '../../icons';
import { useSuggestions } from '../../features/fieldSuggestions/useSuggestions';
import { SuggestionPopover } from '../../features/fieldSuggestions/SuggestionPopover';
import { DEFAULT_VALUE_SOURCES } from '../../features/fieldSuggestions/sources';
import type { SuggestionContext } from '../../features/fieldSuggestions/types';
import { VALUE_SUGGESTION_OPS } from '../../features/fieldSuggestions/operators';
import type { CondNode, ValType } from '@shared/types';
import { ARRAY_VALUE_OPS, SIMPLE_OPS } from './filterTree';
import {
  DATE_PRESETS,
  VAL_TYPES,
  chipText,
  chipsFromValue,
  condValueKind,
  datePresetValue,
  isoToLocalInput,
  localInputToIso,
  parseChipText,
  valueFromChips,
} from './condValue';


/**
 * Escape inside a value box belongs to the box: the list closes if one is
 * showing, and either way the Inspector around the builder must not see a key
 * it closes on. The suggestion list claims its own Escape with
 * `preventDefault`, so a key still unclaimed here had no list to dismiss and
 * leaves the box instead.
 */
function keepEscapeInBox(e: React.KeyboardEvent<HTMLElement>, setSuggesting: (open: boolean) => void): void {
  if (e.key !== 'Escape') return;
  const listWasClosed = !e.defaultPrevented;
  e.preventDefault();
  e.stopPropagation();
  setSuggesting(false);
  if (listWasClosed) e.currentTarget.blur();
}

/**
 * The mongosh form of a parsed date, shown under the value box so the person
 * sees what the wrapped MQL will hold (`ISODate("2026-04-01")`). Every other
 * type reads the same as what was typed, so it gets no preview line.
 */
function formatDatePreview(value: string): string {
  return `ISODate("${value}")`;
}

/**
 * The type as a small chip at the right end of the value box. A real button,
 * so it takes focus and opens a menu of the types; picking one is the same
 * change the type select used to make.
 */
function TypeChip({
  valType,
  disabled,
  onChange,
}: {
  valType: ValType;
  disabled: boolean;
  onChange: (vt: ValType) => void;
}) {
  const T = themeVars;
  return (
    <Menu position="bottom-end" shadow="md" width={120} disabled={disabled}>
      <Menu.Target>
        <button
          type="button"
          aria-label={`Value type: ${valType}`}
          disabled={disabled}
          style={{
            flexShrink: 0,
            height: 20,
            padding: '0 6px',
            border: 'none',
            borderRadius: 4,
            background: T.surfaceRaised,
            color: T.textMuted,
            font: 'inherit',
            fontSize: T.fsXs,
            lineHeight: '20px',
            cursor: disabled ? 'default' : 'pointer',
          }}
        >
          {valType}
        </button>
      </Menu.Target>
      <Menu.Dropdown>
        {VAL_TYPES.map((vt) => (
          <Menu.Item
            key={vt}
            aria-current={vt === valType ? 'true' : undefined}
            fw={vt === valType ? 700 : undefined}
            onClick={() => onChange(vt)}
          >
            {vt}
          </Menu.Item>
        ))}
      </Menu.Dropdown>
    </Menu>
  );
}

/**
 * The bordered box a value is typed into. The editors inside it are
 * borderless; the box carries the border, the focus ring and the error
 * colour, so every kind of value looks the same.
 */
function ValueBox({
  invalid,
  placement,
  children,
}: {
  invalid: boolean;
  placement: React.CSSProperties;
  children: React.ReactNode;
}) {
  const T = themeVars;
  const [focused, setFocused] = React.useState(false);
  return (
    <div
      data-value-box=""
      onFocus={() => setFocused(true)}
      onBlur={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setFocused(false);
      }}
      style={{
        ...placement,
        display: 'flex',
        alignItems: 'flex-start',
        gap: T.gapXs,
        minHeight: 30,
        minWidth: 0,
        boxSizing: 'border-box',
        padding: '0 5px 0 8px',
        background: T.surface,
        border: `1px solid ${invalid ? T.red : focused ? T.accent : T.borderMed}`,
        borderRadius: 6,
        boxShadow: focused ? `0 0 0 1px ${invalid ? T.red : T.accent}` : undefined,
      }}
    >
      {children}
    </div>
  );
}

/** What a borderless editor inside the box needs so the box's border is the only one. */
const BARE_INPUT = { border: 'none', background: 'transparent', boxShadow: 'none' } as const;

/**
 * The value half of a condition row, shaped by its type and operator (W15
 * §14.3) and placed on the row's grid: a two-way switch for `$exists` and a
 * boolean, nothing for `null`, and otherwise a value box holding chips for a
 * list, or the plain text input (with a date picker beside a date's text).
 * The text input and the chips both offer value suggestions.
 *
 * The shape follows `condValueKind`, never the typed text, so a keystroke
 * cannot change the row's layout. The box carries the type chip.
 *
 * `problem` is the row's print problem when it is about the value; it shows
 * under the box (or under the row's first line when there is no box), and the
 * box's input names it as its description.
 *
 * `onPatch`'s key names the box being typed into; the row turns it into its
 * own undo-coalescing key.
 */
export function CondValueEditor({
  node,
  readOnly,
  problem,
  onPatch,
  onTypeChange,
  suggestionContext,
  wide,
  dim,
}: {
  node: CondNode;
  readOnly: boolean;
  problem: string | undefined;
  onPatch: (p: Partial<CondNode>, key?: string) => void;
  onTypeChange: (valType: ValType) => void;
  suggestionContext: SuggestionContext | null;
  /** The builder is wide enough for the box to sit on the row's first line. */
  wide: boolean;
  dim: number | undefined;
}) {
  const T = themeVars;
  const kind = condValueKind(node);
  const isListOp = ARRAY_VALUE_OPS.has(node.op);
  const chips = isListOp ? chipsFromValue(node.value, node.valType) : null;
  // A list shows as chips until the person asks for the JSON, or starts
  // typing in the text box: a half-typed list that happens to parse must not
  // swap the box out from under the caret.
  const [listAsText, setListAsText] = React.useState(false);
  const chipMode = chips !== null && !listAsText;
  // What is typed in the chip box but not yet a chip.
  const [chipSearch, setChipSearch] = React.useState('');
  const errorId = React.useId();

  // Value suggestions: gated on a non-empty field and one of
  // `VALUE_SUGGESTION_OPS` — every other op (`$exists`, `$regex`, `$mod`, ...)
  // gets none, mirroring what `RecentFieldValueService` will ever record for
  // it. They are asked for only while the value box has focus.
  const valueInputRef = React.useRef<HTMLInputElement>(null);
  const [suggesting, setSuggesting] = React.useState(false);
  const valueSuggestionsAllowed = node.field.trim() !== '' && VALUE_SUGGESTION_OPS.has(node.op);
  const valueSuggestionCtx = React.useMemo<SuggestionContext | null>(
    () =>
      suggestionContext && valueSuggestionsAllowed
        ? { ...suggestionContext, target: { field: node.field, operator: node.op } }
        : null,
    [suggestionContext, valueSuggestionsAllowed, node.field, node.op],
  );
  const { items: valueSuggestionItems } = useSuggestions(
    suggesting ? valueSuggestionCtx : null,
    chipMode ? chipSearch : node.value,
    { valueSources: DEFAULT_VALUE_SOURCES },
  );
  const [datePickerOpen, setDatePickerOpen] = React.useState(false);

  // Mantine writes its own `aria-invalid` and `aria-describedby` on an input
  // (from its own error prop, which this box does not use), over any passed in.
  // The message sits under the box, outside the input's wrapper, so the input
  // is pointed at it directly.
  const chipInputRef = React.useRef<HTMLInputElement>(null);
  React.useEffect(() => {
    for (const el of [valueInputRef.current, chipInputRef.current]) {
      if (!el) continue;
      if (problem) {
        el.setAttribute('aria-invalid', 'true');
        el.setAttribute('aria-describedby', errorId);
      } else {
        el.removeAttribute('aria-invalid');
        el.removeAttribute('aria-describedby');
      }
    }
  });

  // Placement on the row's grid. Narrow: the box is the second line, spanning
  // the field and operator columns (so it leaves the menu's column free), and
  // its notes are the third. Wide: the box takes the fourth column of the
  // first line, notes under it. A switch takes that same fourth column.
  const boxRow = wide ? 1 : 2;
  const boxPlacement: React.CSSProperties = {
    gridRow: boxRow,
    gridColumn: wide ? 4 : '2 / -2',
    marginTop: wide ? 0 : T.gapXs,
    opacity: dim,
  };
  const notesPlacement: React.CSSProperties = {
    gridRow: boxRow + 1,
    gridColumn: wide ? 4 : '2 / -2',
    marginTop: 2,
    opacity: dim,
  };
  const noteStyle: React.CSSProperties = { fontSize: T.fsXs, lineHeight: 1.3, minWidth: 0 };
  // The box's input names this as its description, so it is not also an alert;
  // with no input to name it (a switch, null) it is one.
  const hasBoxInput = kind === 'box';
  const errorNote = problem && (
    <div id={errorId} role={hasBoxInput ? undefined : 'alert'} style={{ ...noteStyle, color: T.redText }}>
      {problem}
    </div>
  );
  // No box to hang the message on: it sits under the row's first line.
  const bareNotePlacement: React.CSSProperties = { gridRow: 2, gridColumn: '2 / -2', marginTop: 2, opacity: dim };

  if (kind === 'none') {
    return errorNote ? <div style={bareNotePlacement}>{errorNote}</div> : null;
  }

  if (kind === 'exists' || kind === 'boolean') {
    const labels = kind === 'exists' ? (['present', 'absent'] as const) : (['true', 'false'] as const);
    const first = kind === 'exists' ? node.value.trim() !== 'false' : node.value === 'true';
    return (
      <>
        <div style={{ gridRow: 'var(--sw-row)', gridColumn: 'var(--sw-col)', marginTop: 'var(--sw-mt)', opacity: dim }}>
          <SegmentedControl
            aria-label="Value"
            size="xs"
            data={[...labels]}
            value={first ? labels[0] : labels[1]}
            onChange={(v) => onPatch({ value: v === labels[0] ? 'true' : 'false' })}
            disabled={readOnly}
            styles={{
              root: { background: T.surfaceRaised },
              indicator: { background: T.surface, boxShadow: '0 1px 2px rgba(0, 0, 0, 0.14)' },
            }}
          />
        </div>
        {errorNote && <div style={{ ...bareNotePlacement, gridRow: 'var(--sw-note-row)' }}>{errorNote}</div>}
      </>
    );
  }

  const chip = <TypeChip valType={node.valType} disabled={readOnly} onChange={onTypeChange} />;
  // The chip stays at the box's first line when chips wrap it taller.
  const chipSlot = <div style={{ flexShrink: 0, paddingTop: 4, display: 'flex' }}>{chip}</div>;

  if (chipMode) {
    // A suggestion is offered as the chip it would become, labelled the way
    // the chip will show; TagsInput leaves out the ones already picked.
    const suggestedChips = [
      ...new Set(
        valueSuggestionItems.flatMap((s) =>
          s.kind === 'value' ? [chipText(parseChipText(s.display, node.valType), node.valType)] : [],
        ),
      ),
    ];
    return (
      <>
        <ValueBox invalid={!!problem} placement={boxPlacement}>
          <TagsInput
            aria-label="Values"
            ref={chipInputRef}
            placeholder="add a value, Enter"
            value={chips.map((c) => chipText(c, node.valType))}
            onChange={(tags) => onPatch({ value: valueFromChips(tags.map((t) => parseChipText(t, node.valType))) })}
            data={suggestedChips}
            searchValue={chipSearch}
            onSearchChange={setChipSearch}
            onFocus={() => setSuggesting(true)}
            onKeyDown={(e) => keepEscapeInBox(e, setSuggesting)}
            onBlur={() => setSuggesting(false)}
            // A comma ends a chip, so a value holding one is entered through
            // "Edit as JSON" instead.
            splitChars={[',', '\n']}
            // Mantine's own check ignores case, which would drop `"A"` from a
            // `$in` that already holds `"a"`; MongoDB treats them as different.
            isDuplicate={(v, current) => current.includes(v)}
            disabled={readOnly}
            size="xs"
            style={{ flex: 1, minWidth: 0 }}
            styles={{ input: { ...BARE_INPUT, fontFamily: 'monospace', minHeight: 28, paddingInline: 0 } }}
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
          <ListToggle asText={false} disabled={readOnly} onToggle={() => setListAsText(true)} />
          {chipSlot}
        </ValueBox>
        {errorNote && <div style={notesPlacement}>{errorNote}</div>}
      </>
    );
  }

  const isDate = node.valType === 'date' && SIMPLE_OPS.has(node.op);
  const datePreview = isDate && !problem && node.value !== '' ? formatDatePreview(node.value) : null;

  return (
    <>
      <ValueBox invalid={!!problem} placement={boxPlacement}>
        <TextInput
          ref={valueInputRef}
          variant="unstyled"
          placeholder="value"
          value={node.value}
          disabled={readOnly}
          onChange={(e) => {
            if (isListOp) setListAsText(true);
            onPatch({ value: e.target.value }, 'value');
            if (!suggesting) setSuggesting(true);
          }}
          onFocus={() => setSuggesting(true)}
          onKeyDown={(e) => keepEscapeInBox(e, setSuggesting)}
          onBlur={() => {
            window.setTimeout(() => setSuggesting(false), 100);
          }}
          size="xs"
          style={{ flex: 1, minWidth: 0 }}
          styles={{ input: { fontFamily: 'monospace', height: 28, minHeight: 28, paddingInline: 0 } }}
        />
        {valueSuggestionsAllowed && (
          <SuggestionPopover
            open={suggesting}
            items={valueSuggestionItems}
            anchorRef={valueInputRef}
            label="Value suggestions"
            onSelect={(s) => {
              if (s.kind === 'value') onPatch({ value: s.display });
              setSuggesting(false);
              valueInputRef.current?.blur();
            }}
            onClose={() => setSuggesting(false)}
          />
        )}
        {isDate && (
          <Popover opened={datePickerOpen} onChange={setDatePickerOpen} position="bottom-end" shadow="md" width={220}>
            <Popover.Target>
              <ActionIcon
                variant="subtle"
                color="gray"
                size="sm"
                aria-label="Pick date"
                aria-expanded={datePickerOpen}
                disabled={readOnly}
                onClick={() => setDatePickerOpen((o) => !o)}
                style={{ marginTop: 2 }}
              >
                {I.clock}
              </ActionIcon>
            </Popover.Target>
            <Popover.Dropdown aria-label="Pick date" style={{ padding: 6 }}>
              <input
                type="datetime-local"
                aria-label="Date and time"
                value={isoToLocalInput(node.value)}
                onChange={(e) => {
                  // Mid-edit the input reports '' until every segment is
                  // filled; writing that would blank the value under it.
                  const iso = localInputToIso(e.target.value);
                  if (iso) onPatch({ value: iso }, 'date');
                }}
                style={{
                  width: '100%',
                  font: 'inherit',
                  fontSize: T.fsXs,
                  padding: '3px 4px',
                  color: T.text,
                  background: T.surface,
                  border: `1px solid ${T.border}`,
                  borderRadius: T.rs,
                }}
              />
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'stretch', marginTop: 6 }}>
                {DATE_PRESETS.map((p) => (
                  <Button
                    key={p.id}
                    variant="subtle"
                    color="gray"
                    size="compact-xs"
                    styles={{ inner: { justifyContent: 'flex-start' } }}
                    onClick={() => {
                      onPatch({ value: datePresetValue(p.id, new Date()) });
                      setDatePickerOpen(false);
                    }}
                  >
                    {p.label}
                  </Button>
                ))}
              </div>
            </Popover.Dropdown>
          </Popover>
        )}
        {chips !== null && <ListToggle asText disabled={readOnly} onToggle={() => setListAsText(false)} />}
        {chipSlot}
      </ValueBox>
      {errorNote ? (
        <div style={notesPlacement}>{errorNote}</div>
      ) : (
        datePreview && (
          <div
            aria-hidden="true"
            style={{
              ...notesPlacement,
              ...noteStyle,
              color: T.textGhost,
              fontFamily: '"JetBrains Mono", monospace',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}
          >
            {datePreview}
          </div>
        )
      )}
    </>
  );
}

/** Switches a list between chips and its JSON text. */
function ListToggle({ asText, disabled, onToggle }: { asText: boolean; disabled: boolean; onToggle: () => void }) {
  return (
    <Button
      variant="subtle"
      color="gray"
      size="compact-xs"
      disabled={disabled}
      onClick={onToggle}
      styles={{ root: { flexShrink: 0, fontSize: themeVars.fsXs, padding: '0 4px', marginTop: 2 } }}
    >
      {asText ? 'Edit as chips' : 'Edit as JSON'}
    </Button>
  );
}
