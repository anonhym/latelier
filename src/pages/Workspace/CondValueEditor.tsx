import React from 'react';
import { ActionIcon, Button, Menu, Pill, Popover, SegmentedControl, TagsInput, Textarea } from '@mantine/core';
import { themeVars } from '../../theme/themeVars';
import { I } from '../../icons';
import { useSuggestions } from '../../features/fieldSuggestions/useSuggestions';
import { SuggestionPopover } from '../../features/fieldSuggestions/SuggestionPopover';
import { DEFAULT_VALUE_SOURCES } from '../../features/fieldSuggestions/sources';
import type { SuggestionContext } from '../../features/fieldSuggestions/types';
import { VALUE_SUGGESTION_OPS } from '../../features/fieldSuggestions/operators';
import type { CondNode, SchemaSampleEntry, ValType } from '@shared/types';
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
import { objectIdTimestamp, formatLocalDateTime } from './objectIdDate';
import { pickHelperLine, type HelperCandidate } from './helperLine';
import { splitPastedList } from './listPaste';
import { useGrowToLines } from './useGrowToLines';
import { RegexOptionToggles } from './RegexOptionToggles';
import { useCrossPaste } from './crossPaste';
import { regexOptionsText } from './regexOptions';
import { fieldTypeSplit, type TypeShare } from './fieldTypeSplit';
import {
  MATCH_EITHER_OPTIONS,
  eitherPlan,
  isEitherRow,
  isMixedSplit,
  mixedHint,
  noEditorText,
  noEditorType,
  valTypeOfSampled,
} from './mixedField';


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

/** One line: line breaks at the very end are dropped, any others become one space. */
function singleLine(text: string): string {
  let end = text.length;
  while (end > 0 && (text[end - 1] === '\n' || text[end - 1] === '\r')) end -= 1;
  return text.slice(0, end).replace(/[\r\n]+/g, ' ');
}

/**
 * The mongosh form of a parsed date, shown under the value box so the person
 * sees what the wrapped MQL will hold (`ISODate("2026-04-01")`). Every other
 * type reads the same as what was typed, so it gets no preview line.
 */
function formatDatePreview(value: string): string {
  return `ISODate("${value}")`;
}

/** A note under the box that carries one action: an Undo after a change, or a way to apply an offer. */
export interface ValueNotice {
  kind: 'undo' | 'hint';
  text: string;
  actionLabel: string;
  onAction: () => void;
}

/** A helper line that may carry one action, shown as a button after the text. */
type NoticeCandidate = HelperCandidate & { notice?: ValueNotice };

/**
 * The dot's colours: each sampled type has its own, so the two halves of a
 * mixed field's dot never match; a type with no colour of its own is grey.
 */
const TYPE_DOT_COLORS: Readonly<Record<string, string>> = {
  string: '#1b6e20',
  number: '#1565c0',
  date: '#1a5068',
  objectid: '#7b3fa0',
  boolean: '#b26a00',
};
const TYPE_DOT_NEUTRAL = '#8a8a8a';
/** The grey of the dot's second half, when both types have no colour of their own. */
const TYPE_DOT_NEUTRAL_LIGHT = '#c4c4c4';

function typeDotColor(type: string): string {
  return TYPE_DOT_COLORS[type] ?? TYPE_DOT_NEUTRAL;
}

/** The two halves of a mixed field's dot; they never match. */
function typeDotColors(first: string, second: string): [string, string] {
  const a = typeDotColor(first);
  const b = typeDotColor(second);
  return [a, b === a ? TYPE_DOT_NEUTRAL_LIGHT : b];
}

/** What the chip menu shows for a field that holds two kinds. */
interface MixedChipMenu {
  /** The sampled types that have an editor, most common first. */
  sampled: { valType: ValType; share: number }[];
  /** The "either" entry, when both commonest types can hold the value. */
  either: { label: string; onPick: () => void } | null;
  /** The row is the `$in` that "either" makes. */
  eitherActive: boolean;
}

/**
 * The type as a small chip at the right end of the value box. A real button,
 * so it takes focus and opens a menu of the types; picking one is the same
 * change the type select used to make. A mixed field adds a two-colour dot
 * and lists the types it holds first, each with its share of the sample.
 */
function TypeChip({
  valType,
  label,
  disabled,
  onChange,
  flash,
  split,
  menu,
}: {
  valType: ValType;
  /** What the chip reads when it is not the row's own type (a sampled type with no editor, "either"). */
  label?: string;
  disabled: boolean;
  onChange: (vt: ValType) => void;
  /** Counts the times the field named a type for this row; each one flashes the chip once. */
  flash: number;
  /** The two commonest sampled types, when the field is mixed: the chip shows a dot of their colours. */
  split?: readonly TypeShare[];
  menu?: MixedChipMenu;
}) {
  const T = themeVars;
  const shown = label ?? valType;
  const sampledTypes = new Set(menu?.sampled.map((s) => s.valType));
  const first = split?.[0];
  const second = split?.[1];
  const dot = first && second ? typeDotColors(first.type, second.type) : null;
  return (
    <Menu position="bottom-end" shadow="md" width={menu ? 220 : 120} disabled={disabled}>
      <Menu.Target>
        <button
          // A new key restarts the animation for every flash, not only the first.
          key={flash}
          type="button"
          className={flash > 0 ? 'type-chip-flash' : undefined}
          aria-label={`Value type: ${shown}`}
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
            display: 'inline-flex',
            alignItems: 'center',
            gap: T.gapXs,
          }}
        >
          {first && dot && (
            <span
              data-type-split-dot=""
              data-colors={`${dot[0]} ${dot[1]}`}
              aria-hidden="true"
              style={{
                width: 8,
                height: 8,
                borderRadius: '50%',
                flexShrink: 0,
                background: `conic-gradient(${dot[0]} 0 ${first.share}%, ${dot[1]} 0)`,
              }}
            />
          )}
          {shown}
        </button>
      </Menu.Target>
      <Menu.Dropdown>
        {menu && (
          <>
            {menu.sampled.map((s) => (
              <Menu.Item
                key={`sampled-${s.valType}`}
                aria-current={!menu.eitherActive && s.valType === valType ? 'true' : undefined}
                fw={!menu.eitherActive && s.valType === valType ? 700 : undefined}
                rightSection={
                  <span style={{ fontSize: T.fsXs, color: T.textMuted }}>{s.share}% of sample</span>
                }
                onClick={() => onChange(s.valType)}
              >
                {s.valType}
              </Menu.Item>
            ))}
            <Menu.Divider />
            {menu.either && (
              <Menu.Item
                aria-current={menu.eitherActive ? 'true' : undefined}
                fw={menu.eitherActive ? 700 : undefined}
                onClick={menu.either.onPick}
              >
                either ({menu.either.label})
              </Menu.Item>
            )}
          </>
        )}
        {VAL_TYPES.filter((vt) => !sampledTypes.has(vt)).map((vt) => (
          <Menu.Item
            key={vt}
            data-dimmed={menu ? '' : undefined}
            style={menu ? { opacity: 0.55 } : undefined}
            aria-current={!menu?.eitherActive && vt === valType ? 'true' : undefined}
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
  onPasteCapture,
  onPasteSeen,
  children,
}: {
  invalid: boolean;
  placement: React.CSSProperties;
  onPasteCapture?: React.ClipboardEventHandler<HTMLDivElement>;
  /** Observes every paste into the box, before `onPasteCapture` can stop it. Never prevents it. */
  onPasteSeen?: React.ClipboardEventHandler<HTMLDivElement>;
  children: React.ReactNode;
}) {
  const T = themeVars;
  const [focused, setFocused] = React.useState(false);
  return (
    <div
      data-value-box=""
      onPasteCapture={(e) => {
        onPasteSeen?.(e);
        onPasteCapture?.(e);
      }}
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

/** Height of one line of chips, in px (the pill row the chips area is measured in). */
const CHIP_LINE_PX = 28;
/** Lines of chips shown while the box is at rest; past it the area scrolls. */
const CHIP_LINES_AT_REST = 3;
/** Lines of chips shown while the box is focused or expanded; past it the area scrolls. */
const CHIP_LINES_EDITING = 8;
/**
 * Chips that fit the resting cap. jsdom has no layout and chip widths vary, so
 * the footer does not measure: it counts, assuming this many chips to a line.
 * A list longer than the cap is offered "Show all" even when narrow chips would
 * still have fit, which only costs one click.
 */
const CHIPS_PER_LINE = 3;
const CHIPS_AT_REST = CHIP_LINES_AT_REST * CHIPS_PER_LINE;

/** The most lines the text box grows to; past it the text scrolls inside the box. */
const MAX_TEXT_LINES = 4;

const NUMERIC_TYPES: ReadonlySet<ValType> = new Set<ValType>(['number', 'long', 'decimal']);

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
  notice,
  typeFlash = 0,
  sampleEntry,
  sampleWarning,
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
  /** What the row wants said about a kind change; competes for the helper line by its kind. */
  notice?: ValueNotice | null;
  /** Bumps when the field gave the row a type, to flash the chip once. */
  typeFlash?: number;
  /** What the sample holds for this row's field; absent when the field was not sampled. */
  sampleEntry?: SchemaSampleEntry;
  /** The row's note that its value disagrees with the sampled type; a hint, so it yields to a problem or a notice. */
  sampleWarning?: string;
}) {
  const T = themeVars;
  const onValuePaste = useCrossPaste('builder');
  const kind = condValueKind(node);
  const split = React.useMemo(() => (sampleEntry ? fieldTypeSplit(sampleEntry) : []), [sampleEntry]);
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
  const valueInputRef = React.useRef<HTMLTextAreaElement>(null);
  const [suggesting, setSuggesting] = React.useState(false);
  // The textarea is in the tree only on the text path: not the switch rows
  // (none, $exists, boolean) and not chip mode.
  const textareaRendered = kind !== 'none' && kind !== 'exists' && kind !== 'boolean' && !chipMode;
  useGrowToLines(valueInputRef, node.value, MAX_TEXT_LINES, 0, textareaRendered);
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
  const [showAllChips, setShowAllChips] = React.useState(false);

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

  // The chips area wrapping past its resting cap, as the browser lays it out
  // (jsdom has no layout and reports 0, so the count rule alone decides there).
  // At the resting cap the area's own overflow says so; at the larger cap it is
  // the content against the resting height, so "Show fewer" stays on offer.
  const [chipsWrapPastRest, setChipsWrapPastRest] = React.useState(false);
  const chipLinesNow = suggesting || showAllChips ? CHIP_LINES_EDITING : CHIP_LINES_AT_REST;
  React.useLayoutEffect(() => {
    const area = chipMode ? chipInputRef.current?.closest<HTMLElement>('.mantine-TagsInput-input') : null;
    if (!area) {
      setChipsWrapPastRest(false);
      return;
    }
    const restingPx = CHIP_LINES_AT_REST * CHIP_LINE_PX;
    const measure = () =>
      setChipsWrapPastRest(
        chipLinesNow === CHIP_LINES_AT_REST ? area.scrollHeight > area.clientHeight : area.scrollHeight > restingPx,
      );
    measure();
    // The Inspector can be resized, which re-wraps the chips.
    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(measure);
    observer.observe(area);
    return () => observer.disconnect();
  }, [chipMode, chipLinesNow, node.value]);

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
  // The one line under the box: the problem when there is one, otherwise the
  // next most urgent thing to say.
  // `footer` is information with a control in it (the chip count and its
  // button), so it takes the line only where an info line could.
  const sampleCandidate: HelperCandidate | null = sampleWarning ? { kind: 'hint', text: sampleWarning } : null;
  const noticeCandidate: NoticeCandidate | null = notice ? { kind: notice.kind, text: notice.text, notice } : null;
  const helperNote = (
    candidates: (NoticeCandidate | null)[],
    footer?: React.ReactNode,
    at: React.CSSProperties = notesPlacement,
  ) => {
    const picked = pickHelperLine([
      problem ? { kind: 'error', text: problem } : null,
      noticeCandidate,
      ...candidates,
      sampleCandidate,
      footer ? { kind: 'info', text: '' } : null,
    ]);
    if (!picked) return null;
    if (picked.kind === 'error') return <div style={at}>{errorNote}</div>;
    const pickedNotice = (picked as NoticeCandidate).notice;
    if (pickedNotice) {
      // Not hidden from assistive tech: it holds a button, and is a change worth announcing.
      return (
        <div role="status" style={{ ...at, ...noteStyle, color: T.textGhost }}>
          {pickedNotice.text} ·{' '}
          <Button
            variant="subtle"
            color="gray"
            size="compact-xs"
            disabled={readOnly}
            onClick={pickedNotice.onAction}
            styles={{ root: { fontSize: T.fsXs, padding: '0 4px', height: 'auto' } }}
          >
            {pickedNotice.actionLabel}
          </Button>
        </div>
      );
    }
    if (picked.kind === 'info' && picked.text === '' && footer) {
      return <div style={{ ...at, ...noteStyle, color: T.textGhost }}>{footer}</div>;
    }
    return (
      <div
        aria-hidden="true"
        style={{
          ...at,
          ...noteStyle,
          color: T.textGhost,
          fontFamily: '"JetBrains Mono", monospace',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
        }}
      >
        {picked.text}
      </div>
    );
  };
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
        {helperNote([], undefined, { ...bareNotePlacement, gridRow: 'var(--sw-note-row)' })}
      </>
    );
  }

  // A field that holds two kinds (no type at 90%): the chip shows a dot, and
  // the menu lists the kinds sampled first. A list row gets both too (its
  // "either" label needs them); only the typed-value hint and the "either" offer
  // are limited to equality, the one comparison that reads "this or that".
  const simpleOp = SIMPLE_OPS.has(node.op);
  const mixed = isMixedSplit(split);
  // Only equality reads "matches this or that": `!=`, `>` and the rest would
  // turn into a list that includes the value they exclude or order against.
  const equality = node.op === '$eq';
  const either = mixed && equality && MATCH_EITHER_OPTIONS.offered ? eitherPlan(split, node.value, node.valType) : null;
  const matchEither = either ? () => onPatch(either.patch) : null;
  const eitherActive = mixed && chips !== null && node.valType === 'array' && isEitherRow(chips, split);
  // A sampled type with no editor is typed as text; the chip says what it really is.
  const noEditor = simpleOp && node.valType === 'string' ? noEditorType(split) : null;
  const chip = (
    <TypeChip
      valType={node.valType}
      label={eitherActive ? 'either' : (noEditor ?? undefined)}
      disabled={readOnly}
      onChange={onTypeChange}
      flash={typeFlash}
      split={mixed ? split : undefined}
      menu={
        mixed
          ? {
              sampled: split.flatMap((s) => {
                const vt = valTypeOfSampled(s.type);
                return vt === null ? [] : [{ valType: vt, share: s.share }];
              }),
              either: either && matchEither ? { label: either.label, onPick: matchEither } : null,
              eitherActive,
            }
          : undefined
      }
    />
  );
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
    const overflowing = chips.length > CHIPS_AT_REST || chipsWrapPastRest;
    const chipLines = chipLinesNow;
    const chipFooter = overflowing ? (
      <span style={{ display: 'inline-flex', alignItems: 'center', gap: T.gapXs, fontFamily: '"JetBrains Mono", monospace' }}>
        {chips.length} values
        {!suggesting && (
          <>
            <span aria-hidden="true">·</span>
            <Button
            variant="subtle"
            color="gray"
            size="compact-xs"
            onClick={() => setShowAllChips((v) => !v)}
            styles={{ root: { fontSize: T.fsXs, padding: '0 4px', height: 'auto' } }}
          >
            {showAllChips ? 'Show fewer' : 'Show all'}
            </Button>
          </>
        )}
      </span>
    ) : null;
    // Pasted text becomes chips here, ahead of Mantine's own paste handling,
    // which would apply the same paste a second time.
    const onPasteChips = (e: React.ClipboardEvent<HTMLDivElement>) => {
      if (readOnly || e.target !== chipInputRef.current) return;
      e.stopPropagation();
      e.preventDefault();
      const pasted = splitPastedList(`${chipSearch}${e.clipboardData.getData('text/plain')}`);
      const have = chips.map((c) => chipText(c, node.valType));
      const added = pasted.filter((t, i) => !have.includes(t) && pasted.indexOf(t) === i);
      setChipSearch('');
      if (added.length === 0) return;
      onPatch({ value: valueFromChips([...chips, ...added.map((t) => parseChipText(t, node.valType))]) });
    };
    return (
      <>
        <ValueBox invalid={!!problem} placement={boxPlacement} onPasteCapture={onPasteChips} onPasteSeen={onValuePaste}>
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
            // "Edit as JSON" instead. Line breaks and tabs need no entry: Mantine
            // matches this list against the pressed key (never a break or a tab
            // character), and the paste handler above splits pasted text itself.
            splitChars={[',']}
            // Mantine's own check ignores case, which would drop `"A"` from a
            // `$in` that already holds `"a"`; MongoDB treats them as different.
            isDuplicate={(v, current) => current.includes(v)}
            disabled={readOnly}
            size="xs"
            style={{ flex: 1, minWidth: 0 }}
            styles={{
              input: {
                ...BARE_INPUT,
                fontFamily: 'monospace',
                minHeight: 28,
                paddingInline: 0,
                // Past the cap the chips scroll inside the box.
                maxHeight: chipLines * CHIP_LINE_PX,
                overflowY: 'auto',
              },
            }}
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
        {helperNote([], chipFooter)}
      </>
    );
  }

  const isDate = node.valType === 'date' && SIMPLE_OPS.has(node.op);
  const datePreview: HelperCandidate | null =
    isDate && node.value !== '' ? { kind: 'info', text: formatDatePreview(node.value) } : null;

  const idDate = node.valType === 'objectid' && SIMPLE_OPS.has(node.op) ? objectIdTimestamp(node.value.trim()) : null;
  const idInfo: HelperCandidate | null = idDate ? { kind: 'info', text: `created ${formatLocalDateTime(idDate)}` } : null;

  const isRegexRow = node.op === '$regex';
  const optionsText = isRegexRow ? regexOptionsText(node.options ?? '') : null;
  const optionsInfo: HelperCandidate | null = optionsText ? { kind: 'info', text: optionsText } : null;
  const noEditorLine: HelperCandidate | null = noEditor ? { kind: 'hint', text: noEditorText(noEditor) } : null;
  const mixedNote =
    mixed && equality && node.valType !== 'null' && node.valType !== 'regex' && node.valType !== 'array'
      ? mixedHint(node.field.trim(), split, node.valType, node.value, node.valType)
      : null;
  const mixedCandidate: NoticeCandidate | null = mixedNote
    ? {
        kind: 'hint',
        text: mixedNote.text,
        notice:
          mixedNote.kind === 'skips' && matchEither
            ? { kind: 'hint', text: mixedNote.text, actionLabel: 'Match either', onAction: matchEither }
            : undefined,
      }
    : null;

  return (
    <>
      <ValueBox invalid={!!problem} placement={boxPlacement} onPasteSeen={onValuePaste}>
        <Textarea
          ref={valueInputRef}
          variant="unstyled"
          rows={1}
          placeholder="value"
          // A number is typed on a numeric keypad where there is one; the box
          // still takes any text so a mistake can be seen and fixed.
          inputMode={NUMERIC_TYPES.has(node.valType) ? 'decimal' : undefined}
          value={node.value}
          disabled={readOnly}
          onChange={(e) => {
            if (isListOp) setListAsText(true);
            // The box is a textarea so long text wraps, but a value is one
            // line: pasted line breaks become a single space. Line breaks at
            // the very end are dropped instead, as a copy from a terminal
            // ends with one and a trailing space would match nothing.
            onPatch({ value: singleLine(e.target.value) }, 'value');
            if (!suggesting) setSuggesting(true);
          }}
          onFocus={() => setSuggesting(true)}
          onKeyDown={(e) => {
            // A value is one line of text; Enter must not start a second.
            if (e.key === 'Enter') e.preventDefault();
            keepEscapeInBox(e, setSuggesting);
          }}
          onBlur={() => {
            window.setTimeout(() => setSuggesting(false), 100);
          }}
          size="xs"
          style={{ flex: 1, minWidth: 0 }}
          styles={{ input: { fontFamily: 'monospace', minHeight: 28, paddingBlock: 6, paddingInline: 0, resize: 'none' } }}
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
      {helperNote([noEditorLine, mixedCandidate, datePreview, idInfo, optionsInfo])}
      {isRegexRow && (
        <RegexOptionToggles
          options={node.options ?? ''}
          readOnly={readOnly}
          onChange={(next) => onPatch({ options: next === '' ? undefined : next })}
          placement={{ gridRow: boxRow + 2, gridColumn: wide ? 4 : '2 / -2', marginTop: 4, opacity: dim }}
        />
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
