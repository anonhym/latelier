// What a condition's value does when its kind changes: the field now names a
// differently typed sample, the type chip was picked, or the operator moved
// between one value and a list. Pure; the builder row applies the result.
//
// Nothing typed is lost: a value converts only when its text reads as the new
// kind under the printer's own rules, and otherwise it stays as it is.
import type { CondNode, SchemaSampleEntry, ValType } from '@shared/types';
import { opForValType } from './builder';
import { chipText, chipsFromValue, parseChipText, valTypePatch, valueFromChips, type Chip } from './condValue';
import { SIMPLE_OPS, printFilter } from './filterTree';

/**
 * How kind changes behave. One object, so a settings toggle can drive it later.
 * `autoConvert`: a value that reads as the new kind is converted on the spot
 * (with an Undo for a field change); off, it is only offered.
 */
export interface KindChangeOptions {
  autoConvert: boolean;
}

export const KIND_CHANGE_OPTIONS: Readonly<KindChangeOptions> = { autoConvert: true };

export type ConvertResult = { kind: 'converted'; text: string } | { kind: 'keep' };

/** Kinds whose text this module converts between; the rest are always kept. */
const CONVERTIBLE: ReadonlySet<ValType> = new Set<ValType>([
  'string',
  'number',
  'long',
  'decimal',
  'boolean',
  'date',
  'objectid',
]);

const ISO_DATE_START = /^\d{4}-\d{2}-\d{2}/;

/** Whether `text` is a value of kind `to` under the same rules that decide whether the row prints. */
function readsAs(to: ValType, text: string): boolean {
  if (to === 'boolean') return text === 'true' || text === 'false';
  // `Date.parse` takes "12" as a year, which is never what a person meant.
  if (to === 'date' && !ISO_DATE_START.test(text)) return false;
  const row: CondNode = { kind: 'cond', field: 'f', op: '$eq', valType: to, value: text };
  return printFilter({ kind: 'group', logic: '$and', children: [row] }).ok;
}

/**
 * The text a value of kind `from` becomes in kind `to`: the same text when it
 * reads as `to`, otherwise `keep`. An empty box has nothing to convert, so it
 * keeps (the box just adopts the type). Text is never rewritten, so a value
 * converted to a kind and back is unchanged.
 */
export function convertValue(text: string, from: ValType, to: ValType): ConvertResult {
  if (text === '') return { kind: 'keep' };
  if (from === to) return { kind: 'converted', text };
  if (!CONVERTIBLE.has(from) || !CONVERTIBLE.has(to)) return { kind: 'keep' };
  if (to === 'string') return { kind: 'converted', text };
  return readsAs(to, text) ? { kind: 'converted', text } : { kind: 'keep' };
}

/**
 * What a row patches when it is switched to `to`: the type (and the operator
 * if the new type does not offer it), and the value when it converts. A value
 * that does not read as `to` stays, and the row shows its usual error.
 */
export function kindSwitchPatch(
  node: CondNode,
  to: ValType,
  options: Readonly<KindChangeOptions> = KIND_CHANGE_OPTIONS,
): Partial<CondNode> {
  const patch = valTypePatch(node, to);
  if (!options.autoConvert || !SIMPLE_OPS.has(node.op)) return patch;
  const result = convertValue(node.value, node.valType, to);
  return result.kind === 'converted' ? { ...patch, value: result.text } : patch;
}

/** How much of the sample holds the type a notice names. */
export type SampleShare = 'every' | 'most';

/** `every` only when every counted document holds the same type. */
export function sampleShare(entry: SchemaSampleEntry | undefined): SampleShare | null {
  if (!entry) return null;
  const counts = Object.values(entry.types);
  const total = counts.reduce((a, b) => a + b, 0);
  if (total === 0) return null;
  return Math.max(...counts) === total ? 'every' : 'most';
}

export type FieldKindPlan =
  | { kind: 'none' }
  /** The box was empty: it takes the sampled type. */
  | { kind: 'adopt'; patch: Partial<CondNode> }
  /** The value read as the sampled type and was converted. */
  | { kind: 'convert'; patch: Partial<CondNode>; to: ValType }
  /** The value stays, or is only offered; the sample says it is another type. */
  | { kind: 'hint'; to: ValType; share: SampleShare };

/**
 * What a row does when its field now names a field the sample types as `to`.
 * `share` is how much of the sample holds that type, or `null` when there is
 * no evidence (only an empty box adopts the type then). A row sending null,
 * or one whose operator does not compare one value, is left alone.
 */
export function planFieldKind(
  node: CondNode,
  to: ValType,
  share: SampleShare | null,
  options: Readonly<KindChangeOptions> = KIND_CHANGE_OPTIONS,
): FieldKindPlan {
  if (node.valType === 'null') return { kind: 'none' };
  if (node.value.trim() === '') {
    if (to === node.valType && opForValType(to, node.op) === node.op) return { kind: 'none' };
    return { kind: 'adopt', patch: { valType: to, op: opForValType(to, node.op) } };
  }
  if (share === null || to === node.valType || !SIMPLE_OPS.has(node.op)) return { kind: 'none' };
  const result = convertValue(node.value, node.valType, to);
  if (result.kind === 'keep' || !options.autoConvert) return { kind: 'hint', to, share };
  return { kind: 'convert', patch: { ...valTypePatch(node, to), value: result.text }, to };
}

/** "a number", "an objectid". */
function withArticle(type: string): string {
  return /^[aeiou]/.test(type) ? `an ${type}` : `a ${type}`;
}

export function convertedNoticeText(to: ValType, field: string): string {
  return `Changed to ${to} to match ${field}`;
}

export function sampleHintText(field: string, to: ValType, share: SampleShare): string {
  return `${field} is ${withArticle(to)} in ${share === 'every' ? 'every sampled document' : 'most sampled documents'}`;
}

/** The names a notice lists before it says "and N more". */
const NAMED_REMOVED = 3;

export interface OperatorSwitch {
  /** The value the row holds under the new operator. */
  value: string;
  /** The type the row takes when the value's own type decides it (a loaded list is typed `array`). */
  valType?: ValType;
  /** The chips that did not carry over, as the box shows them. */
  removed: string[];
}

/** The row type a single chip's value belongs to. */
function typeOfChip(chip: Chip): ValType {
  if (chip === null) return 'null';
  return typeof chip === 'number' ? 'number' : typeof chip === 'boolean' ? 'boolean' : 'string';
}

/**
 * `=` to `$in` makes the value the first chip; `$in` to `=` keeps the first
 * chip and drops the rest (the caller says which were removed). Null for any
 * other change, and for a value no chip can hold faithfully, which stays as typed.
 */
export function operatorSwitch(node: CondNode, nextOp: string): OperatorSwitch | null {
  if (node.op === '$eq' && nextOp === '$in') {
    if (!CONVERTIBLE.has(node.valType)) return null;
    if (node.value === '') return { value: '', removed: [] };
    // A string row sends its text verbatim, so the chip holds it verbatim: reading it as typed chip text
    // would trim it and unquote `"hello"`, and the list would match another value.
    const chip = node.valType === 'string' ? node.value : parseChipText(node.value, node.valType);
    return { value: valueFromChips([chip]), removed: [] };
  }
  if (node.op === '$in' && nextOp === '$eq') {
    if (!CONVERTIBLE.has(node.valType) && node.valType !== 'array') return null;
    const chips = chipsFromValue(node.value, node.valType);
    if (chips === null) return null;
    const [first, ...rest] = chips;
    const removed = rest.map((c) => chipText(c, node.valType));
    if (node.valType !== 'array') {
      return { value: first === undefined ? '' : first === null ? 'null' : String(first), removed };
    }
    // A loaded `$in` is typed `array`, which has no single value: the chip says what the row becomes.
    if (first === undefined) return { value: '', valType: 'string', removed };
    const valType = typeOfChip(first);
    return { value: first === null ? '' : String(first), valType, removed };
  }
  return null;
}

export function removedNoticeText(removed: readonly string[]): string {
  const shown = removed.slice(0, NAMED_REMOVED).join(', ');
  const more = removed.length - NAMED_REMOVED;
  const names = more > 0 ? `${shown} and ${more} more` : shown;
  return `${names} ${removed.length === 1 ? 'was' : 'were'} removed`;
}
