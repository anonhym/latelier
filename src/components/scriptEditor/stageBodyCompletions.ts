import type {
  Completion,
  CompletionContext,
  CompletionResult,
  CompletionSource,
} from '@codemirror/autocomplete';
import { detectAggGrammar, detectScopePath, detectValueSlot, type ValueSlot } from '../../features/fieldSuggestions/aggGrammar';
import { fieldSlot, isPlainKey, lookupFrom, subPipelinePath, subPipelineText, type FieldSlot } from '../../features/fieldSuggestions/stageFieldPositions';
import { shapeBefore, shapeFields, stagesInPipelineText, type ShapeField, type ShapeStage } from '../../features/fieldSuggestions/stageShape';
import { VALUE_SUGGESTION_OPS } from '../../features/fieldSuggestions/operators';
import {
  DEFAULT_FIELD_SOURCES,
  DEFAULT_VALUE_SOURCES,
  lastRunSource,
  operatorSource,
  sampleSchemaSource,
} from '../../features/fieldSuggestions/sources';
import type {
  FieldSuggestion,
  OperatorSuggestion,
  SuggestionContext,
  ValueSuggestion,
} from '../../features/fieldSuggestions/types';

/**
 * Mirrors `useTextareaAutocomplete`'s `KEY_POSITION_SOURCES`: a stage body's
 * bare-key position is the one spot where both a schema field name and a
 * `$operator` key are valid completions — reusing the same composition
 * preserves the exact ranking the textarea had.
 */
const KEY_POSITION_SOURCES = [...DEFAULT_FIELD_SOURCES, operatorSource];

export interface StageBodyCompletionOpts {
  /**
   * Reads the latest connection/db/collection context. Returning null (no
   * active connection yet) disables suggestions entirely.
   */
  getContext: () => SuggestionContext | null;
  /**
   * Reads the latest stage op so operator ranking follows an in-place op
   * change without rebuilding the editor (mirrors the `getCollections` ref
   * pattern in `ScriptEditor`).
   */
  getStageOp: () => string | undefined;
  /**
   * The pipeline around the stage being edited, so the fields offered are the
   * ones that reach it: its enabled stages, its position, and the documents of
   * the previous enabled stage's preview when that is fresh. Absent (or null),
   * every field of the source collection is offered.
   */
  getStageShape?: () => StageShapeInput | null;
}

export interface StageShapeInput {
  stages: readonly ShapeStage[];
  index: number;
  previewDocs?: unknown[];
}

/** What can extend a token typed inside a quoted string. */
const QUOTED_VALID_FOR = /^[^"'\n]*$/;

function fieldToCompletion(s: FieldSuggestion, quotedKey: boolean): Completion {
  return {
    label: s.path,
    type: 'property',
    detail: s.type,
    boost: Math.min(s.frequency ?? 0, 50) / 50,
    // An unquoted key such as `address.city` does not parse; it needs its quotes.
    ...(!quotedKey && !isPlainKey(s.path) ? { apply: `"${s.path}"` } : {}),
  };
}

/** What the popover shows beside a field the pipeline's shape offers. */
function shapeDetail(f: ShapeField, unknownShape: boolean): string | undefined {
  if (unknownShape) return 'unknown shape';
  if (f.origin === 'derived') return 'from an earlier stage';
  if (f.origin === 'preview') return 'from the preview';
  return f.type;
}

function operatorToCompletion(s: OperatorSuggestion): Completion {
  return {
    label: s.name,
    type: 'keyword',
    detail: s.class,
    info: s.summary ?? s.description ?? undefined,
    // Operators outside the caret's operatorContext still surface (so an
    // unrecognized/custom stage, or a bare object with no context, doesn't
    // hide the catalog) but rank behind in-context ones.
    boost: s.offContext ? -1 : 1,
  };
}

/**
 * Runs every key-position source and merges the results into CodeMirror
 * `Completion[]`, deduping by path (fields) / name (operators) — a field or
 * operator name can be emitted by more than one source, and some operator
 * names (e.g. `$eq`, both a query operator and an aggregation expression)
 * appear more than once in the catalog with different `validIn` sets.
 */
async function collectOptions(
  ctx: SuggestionContext,
  choice: { shape: FieldChoice | null; withFields: boolean; quotedKey: boolean },
): Promise<Completion[]> {
  // With the pipeline's shape known it supplies the fields, and only the
  // operators come from the sources.
  const sources = choice.shape ? [operatorSource] : KEY_POSITION_SOURCES;
  const batches = await Promise.all(sources.map((src) => src(ctx)));

  const fields = new Map<string, FieldSuggestion>();
  const operators = new Map<string, OperatorSuggestion>();
  for (const batch of batches) {
    for (const s of batch) {
      if (s.kind === 'field') {
        const existing = fields.get(s.path);
        fields.set(
          s.path,
          existing
            ? {
                ...existing,
                frequency: (existing.frequency ?? 0) + (s.frequency ?? 0),
                type: existing.type ?? s.type,
              }
            : s,
        );
      } else {
        const existing = operators.get(s.name);
        // A catalog name with duplicate entries (different `class`/`validIn`)
        // is in-context if ANY entry is valid at the caret's context — e.g.
        // `$eq` is both a `matchKey` query op and a `groupValue`/`projectValue`
        // expression, and both uses are legitimate. Prefer the entry that
        // carries a description for the richer popover info.
        operators.set(
          s.name,
          existing
            ? {
                ...existing,
                offContext: existing.offContext && s.offContext,
                description: existing.description ?? s.description,
                summary: existing.summary ?? s.summary,
              }
            : s,
        );
      }
    }
  }

  const options: Completion[] = [];
  // A key that starts with `$` is an operator; fields cannot start with one.
  if (choice.withFields) {
    for (const f of fields.values()) options.push(fieldToCompletion(f, choice.quotedKey));
    for (const f of choice.shape?.fields ?? []) {
      options.push({
        ...fieldToCompletion({ kind: 'field', path: f.path, source: f.origin, frequency: f.frequency }, choice.quotedKey),
        detail: shapeDetail(f, choice.shape!.unknownShape),
      });
    }
  }
  for (const o of operators.values()) options.push(operatorToCompletion(o));
  return options;
}

/** The fields that reach a stage, and whether their shape is a guess. */
interface FieldChoice {
  fields: ShapeField[];
  unknownShape: boolean;
}

const sourceFieldsOf = async (ctx: SuggestionContext): Promise<ShapeField[]> =>
  (await sampleSchemaSource({ ...ctx, recentDocs: undefined }))
    .filter((s): s is FieldSuggestion => s.kind === 'field')
    .map((s) => ({ path: s.path, type: s.type, frequency: s.frequency, origin: 'source' as const }));

/**
 * The fields at the edited stage: what the pipeline before it leaves, from its
 * text and the previous stage's preview. Null without a pipeline to read.
 */
async function pipelineFields(
  ctx: SuggestionContext,
  input: StageShapeInput | null,
): Promise<FieldChoice | null> {
  if (!input) return null;
  const shape = shapeBefore(input.stages, input.index);
  const preview = lastRunSource({ ...ctx, recentDocs: input.previewDocs }) as FieldSuggestion[];
  const { fields, unknownShape } = shapeFields(
    shape,
    await sourceFieldsOf(ctx),
    preview.map((s) => s.path),
  );
  return { fields, unknownShape };
}

/**
 * Value completions for a string in a `$match` body, merged by display text
 * across sources the way `useSuggestions` merges them. The caret sits inside
 * a quoted string, so only string values fit: a number or boolean inserted
 * there would become the string `"42"`. A value holding a quote, a backslash
 * or a line break would end or corrupt the string literal, so it is left out
 * rather than escaped.
 */
async function collectValueOptions(
  ctx: SuggestionContext & { target: { field: string; operator?: string } },
): Promise<Completion[]> {
  const batches = await Promise.all(DEFAULT_VALUE_SOURCES.map((src) => src(ctx)));
  const values = new Map<string, ValueSuggestion>();
  for (const s of batches.flat()) {
    if (s.type !== undefined && s.type !== 'string') continue;
    if (/["'\\\n\r]/.test(s.display)) continue;
    const existing = values.get(s.display);
    values.set(
      s.display,
      existing ? { ...existing, frequency: (existing.frequency ?? 0) + (s.frequency ?? 0) } : s,
    );
  }
  return [...values.values()].map((v) => ({
    label: v.display,
    type: 'text',
    boost: Math.min(v.frequency ?? 0, 50) / 50,
  }));
}

/**
 * Where the contents of the string literal holding `from` end: the offset of
 * its closing `quote`, skipping escaped characters, or of the line end when
 * the string is not closed on its line, or of the text's end.
 */
function stringContentEnd(doc: string, from: number, quote: string | undefined): number {
  let i = from;
  // Stryker disable next-line EqualityOperator: one more pass at
  // `i === doc.length` reads `undefined`, matches nothing and steps past the
  // end, which the `Math.min` below clamps back to `doc.length`.
  while (i < doc.length) {
    const c = doc[i];
    if (c === quote || c === '\n' || c === '\r') return i;
    i += c === '\\' ? 2 : 1;
  }
  return Math.min(i, doc.length);
}

/**
 * The fields a `$lookup` sub-pipeline stage sees: the joined collection's, as
 * the sub-pipeline's own earlier stages leave them. Null when the body names
 * no `from` collection.
 */
async function subPipelineFields(
  suggestionCtx: SuggestionContext,
  doc: string,
  pos: number,
): Promise<FieldChoice | null> {
  const from = lookupFrom(doc);
  const text = subPipelineText(doc, pos);
  if (from === null || text === null) return null;
  const source = await sourceFieldsOf({ ...suggestionCtx, collection: from });
  const shape = shapeBefore(stagesInPipelineText(text), Number.MAX_SAFE_INTEGER);
  return shapeFields(shape, source, []);
}

/**
 * What one field offered in a value slot inserts: `$field` or a bare `field`,
 * inside the quotes already typed; an unquoted slot takes the quotes with it.
 */
function slotOption(path: string, slot: ValueSlot, form: FieldSlot['form'], detail?: string): Completion {
  const text = form === 'dollar' ? `$${path}` : path;
  return {
    label: text,
    type: 'property',
    detail,
    ...(slot.quoted ? {} : { apply: `"${text}"` }),
  };
}

/**
 * Where an accepted slot completion stops replacing: past the rest of the
 * reference under the caret, so `"$na|me"` becomes `"$name"` and not
 * `"$nameme"`. A quoted slot runs to its closing quote; an unquoted one to the
 * end of the word, which the completion then quotes.
 */
function slotReplaceEnd(doc: string, slot: ValueSlot): number {
  if (slot.quoted) return stringContentEnd(doc, slot.replaceEnd, doc[slot.replaceStart - 1]);
  let end = slot.replaceEnd;
  while (end < doc.length && /[\w$.]/.test(doc[end] ?? '')) end++;
  return end;
}

/**
 * Field suggestions where a value names a field (a `$group` `_id`, an
 * accumulator's argument, `$unwind`'s path, `$lookup`'s local and foreign
 * fields, ...): `fieldSlot` says whether the position takes one and in which
 * form. `foreignField` and `$graphLookup`'s fields take the joined
 * collection's fields, the others those that reach the stage.
 */
async function slotCompletions(
  opts: StageBodyCompletionOpts,
  suggestionCtx: SuggestionContext,
  doc: string,
  ctx: CompletionContext,
  stageOp: string | undefined,
): Promise<CompletionResult | null> {
  const slot = detectValueSlot(doc, ctx.pos);
  if (!slot) return null;
  const sub = subPipelinePath(stageOp, slot.path);
  // A sub-pipeline stage's fields are the joined collection's, never the outer pipeline's.
  const spec = sub ? (sub.op ? fieldSlot(sub.op, sub.rest) : null) : fieldSlot(stageOp, slot.path);
  if (!spec || (sub && spec.fields === 'from')) return null;
  // An expression is `"$..."`: it begins at the `$`, or is not typed yet.
  if (spec.form === 'dollar' ? slot.token !== '' && !slot.token.startsWith('$') : slot.token.startsWith('$')) {
    return null;
  }
  // An unquoted, empty slot is only offered when asked for, so typing `: ` does not open a list.
  if (!slot.quoted && slot.token === '' && !ctx.explicit) return null;

  let choice: FieldChoice | null;
  if (sub) {
    choice = await subPipelineFields(suggestionCtx, doc, ctx.pos);
    if (choice === null) return null;
  } else if (spec.fields === 'from') {
    const from = lookupFrom(doc);
    if (from === null) return null;
    choice = { fields: await sourceFieldsOf({ ...suggestionCtx, collection: from }), unknownShape: false };
  } else {
    choice = await pipelineFields(suggestionCtx, opts.getStageShape?.() ?? null);
    choice ??= { fields: await sourceFieldsOf(suggestionCtx), unknownShape: false };
  }
  if (choice.fields.length === 0) return null;
  const { fields, unknownShape } = choice;
  return {
    from: slot.replaceStart,
    to: slotReplaceEnd(doc, slot),
    options: fields.map((f) => slotOption(f.path, slot, spec.form, shapeDetail(f, unknownShape))),
    validFor: slot.quoted ? QUOTED_VALID_FOR : /^[\w$.]*$/,
  };
}

/**
 * CodeMirror completion source for aggregation stage bodies (T2.4). Stage
 * bodies are top-level `{ … }` objects, not `db.<coll>.<method>(…)` calls, so
 * `mongoCompletions`'s tree-based `detectFieldPosition` never fires there —
 * this source runs the bracket-counting `detectAggGrammar` detector instead
 * (it parses off plain text + caret offset, so it's unaffected by the object
 * literal parsing as a bare JS block).
 *
 * A `fieldName` hit offers schema field names and `$operator` keys, the
 * exact behavior `useTextareaAutocomplete`'s key-position branch had. A
 * `valueFor` hit in a `$match` stage offers values of the field it compares
 * (the grammar resolves `{age: {$gt: "…"}}` to `age`); in any other stage a
 * key names an output field, not a source one, so nothing is offered there.
 * A value that names a field gets the fields of the pipeline (`slotCompletions`).
 */
export function stageBodyCompletionSource(opts: StageBodyCompletionOpts): CompletionSource {
  return (ctx: CompletionContext): Promise<CompletionResult | null> | null => {
    const suggestionCtx = opts.getContext();
    if (!suggestionCtx) return null;

    const doc = ctx.state.doc.toString();
    const stageOp = opts.getStageOp();
    const hit = detectAggGrammar(doc, ctx.pos, stageOp);
    if (hit?.kind === 'valueFor' && stageOp === '$match') {
      // Same gate as the builder's value box: `{a: {$regex: "…"}}` takes a
      // pattern, not one of a's values.
      if (hit.operator !== undefined && !VALUE_SUGGESTION_OPS.has(hit.operator)) return null;
      const target = { field: hit.field, operator: hit.operator };
      // A pick replaces the whole value, not just what precedes the caret:
      // `"p|ending"` + `paid` must give `"paid"`, never `"paidending"`.
      const to = stringContentEnd(doc, hit.replaceEnd, doc[hit.replaceStart - 1]);
      return collectValueOptions({ ...suggestionCtx, target }).then((options) =>
        options.length === 0
          ? null
          : { from: hit.replaceStart, to, options, validFor: QUOTED_VALID_FOR },
      );
    }
    if (hit?.kind !== 'fieldName') return slotCompletions(opts, suggestionCtx, doc, ctx, stageOp);

    const scopedCtx: SuggestionContext = hit.operatorContext
      ? { ...suggestionCtx, operatorContext: hit.operatorContext }
      : suggestionCtx;

    // Inside a quoted key (`"na|"`) only non-quote characters can extend the
    // token; a bare/unquoted key allows the same identifier charset the
    // grammar detector itself scans with ($, ., word chars).
    //
    // `hit.replaceStart` is always a valid non-negative index into `doc`
    // (0..doc.length) by construction in aggGrammar.ts — it's derived from
    // scanning `doc` itself and never exceeds its bounds. So `> 0` vs `>= 0`
    // vs an unconditional `true` guard here are all observationally
    // identical (verified by exhaustively sweeping every doc/replaceStart
    // combination for short docs with a Node probe: 0 mismatches across all
    // three), and the `?? ''` fallback on `doc[hit.replaceStart - 1]` is
    // dead — that index is only read once the guard has confirmed
    // `replaceStart > 0`, at which point `replaceStart - 1` is always a
    // valid in-bounds index and never `undefined`.
    // Stryker disable next-line ConditionalExpression,EqualityOperator,StringLiteral: see comment above — replaceStart is never negative, and doc[replaceStart-1] is never out of bounds when the guard passes.
    const quoteBefore = hit.replaceStart > 0 && /["']/.test(doc[hit.replaceStart - 1] ?? '');
    const validFor = quoteBefore ? QUOTED_VALID_FOR : /^[\w$.]*$/;

    // A key inside a `$lookup`'s `pipeline` belongs to a stage over the joined collection.
    const sub = subPipelinePath(stageOp, detectScopePath(doc, hit.replaceStart).slice(0, -1));
    const fieldChoice: Promise<FieldChoice | null> = sub
      ? sub.op
        ? subPipelineFields(suggestionCtx, doc, ctx.pos).then((c) => c ?? { fields: [], unknownShape: false })
        : Promise.resolve({ fields: [], unknownShape: false })
      : pipelineFields(suggestionCtx, opts.getStageShape?.() ?? null);
    return fieldChoice
      .then((shape) =>
        collectOptions(scopedCtx, { shape, withFields: !hit.token.startsWith('$'), quotedKey: quoteBefore }),
      )
      .then((options): CompletionResult | null => {
        if (options.length === 0) return null;
        return { from: hit.replaceStart, to: hit.replaceEnd, options, validFor };
      });
  };
}
