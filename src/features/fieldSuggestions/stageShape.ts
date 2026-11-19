import { repairToCanonicalEjson } from '../../utils/shellSyntax';

/**
 * Which fields the documents have when they reach a stage of an aggregation
 * pipeline, worked out from the text of the stages before it. Pure and
 * synchronous: the source collection's fields (and a stage preview's) come
 * from outside and are merged by `shapeFields`.
 */

export interface ShapeStage {
  op: string;
  body: string;
  enabled: boolean;
}

/**
 * `source`: every stage so far passes the source fields through or adds to
 * them. `rebuilt`: a stage built a new shape the text fully describes.
 * `unknown`: the text cannot say (`$replaceRoot`, a body that does not parse).
 */
export type ShapeKind = 'source' | 'rebuilt' | 'unknown';

export interface StageShape {
  kind: ShapeKind;
  /** The source collection's fields are still there. */
  keepSource: boolean;
  /** Paths (and what lies below them) removed from the source fields. */
  removed: string[];
  /** Fields the stages made, in the order they appeared. */
  added: string[];
}

export interface SourceField {
  path: string;
  type?: string;
  frequency?: number;
}

export type FieldOrigin = 'source' | 'derived' | 'preview';

export interface ShapeField {
  path: string;
  origin: FieldOrigin;
  type?: string;
  frequency?: number;
}

/** Stages that neither add nor drop a field. */
const PASS_THROUGH: ReadonlySet<string> = new Set([
  '$match', '$sort', '$limit', '$skip', '$sample', '$redact', '$fill', '$densify', '$out', '$merge',
]);
/** Stages after which the text cannot say what the documents look like. */
const SHAPE_FROM_ELSEWHERE: ReadonlySet<string> = new Set([
  '$replaceRoot', '$replaceWith', '$unionWith', '$documents',
]);

type Plain = Record<string, unknown>;

function isPlain(v: unknown): v is Plain {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/**
 * The parsed body of a stage, or undefined when it does not parse. A stage
 * that is mid-edit is expected not to, and its shape is then unknown rather
 * than an error.
 */
function parseBody(body: string): unknown {
  const outcome = repairToCanonicalEjson(body);
  if (outcome.kind === 'failed') return undefined;
  try {
    return JSON.parse(outcome.kind === 'repaired' ? outcome.text : body);
  // Stryker disable next-line BlockStatement: the repair only accepts text that
  // is JSON once repaired (probed: empty, bare words, trailing commas, an
  // unsupported syntax are all refused or repaired), so this guard, which keeps
  // a completion from ever throwing, has no input that reaches it.
  } catch {
    return undefined;
  }
}

function covers(prefix: string, path: string): boolean {
  return path === prefix || path.startsWith(`${prefix}.`);
}

function addField(state: StageShape, path: string): void {
  if (!state.added.includes(path)) state.added.push(path);
}

function removePath(state: StageShape, path: string): void {
  state.added = state.added.filter((a) => !covers(path, a));
  if (state.keepSource) state.removed.push(path);
}

function rebuild(state: StageShape, fields: string[]): void {
  state.kind = 'rebuilt';
  state.keepSource = false;
  state.removed = [];
  state.added = [];
  for (const f of fields) addField(state, f);
}

function stringList(v: unknown): string[] | null {
  if (typeof v === 'string') return [v];
  if (Array.isArray(v) && v.every((x) => typeof x === 'string')) return v as string[];
  return null;
}

/** `$project`: an inclusion list rebuilds the shape, an exclusion list only removes. */
function applyProject(state: StageShape, body: Plain): void {
  const excluded = (v: unknown) => v === 0 || v === false;
  const keys = Object.keys(body).filter((k) => k !== '_id');
  const included = keys.filter((k) => !excluded(body[k]));
  const idOnly = keys.length === 0 && Object.hasOwn(body, '_id') && !excluded(body._id);
  if (included.length > 0 || idOnly) {
    rebuild(state, excluded(body._id) ? included : ['_id', ...included]);
    return;
  }
  for (const k of keys) removePath(state, k);
  if (excluded(body._id)) removePath(state, '_id');
}

function applyGroup(state: StageShape, body: Plain): void {
  const id = body._id;
  const idKeys = isPlain(id) ? Object.keys(id).filter((k) => !k.startsWith('$')) : [];
  rebuild(state, [
    '_id',
    ...idKeys.map((k) => `_id.${k}`),
    ...Object.keys(body).filter((k) => k !== '_id'),
  ]);
}

function applyStage(state: StageShape, stage: ShapeStage): void {
  const { op } = stage;
  if (PASS_THROUGH.has(op)) return;
  if (SHAPE_FROM_ELSEWHERE.has(op)) {
    rebuild(state, []);
    state.kind = 'unknown';
    return;
  }
  const body = parseBody(stage.body);
  const named = (v: unknown) => (typeof v === 'string' && v !== '' ? [v] : []);
  switch (op) {
    case '$unset': {
      const names = stringList(body);
      if (names === null) break;
      for (const n of names) removePath(state, n);
      return;
    }
    case '$project':
      if (!isPlain(body)) break;
      applyProject(state, body);
      return;
    case '$addFields':
    case '$set':
      if (!isPlain(body)) break;
      for (const k of Object.keys(body)) addField(state, k);
      return;
    case '$lookup':
    case '$graphLookup':
      if (!isPlain(body)) break;
      for (const f of named(body.as)) addField(state, f);
      return;
    case '$unwind':
      if (typeof body === 'string') return;
      if (!isPlain(body)) break;
      for (const f of named(body.includeArrayIndex)) addField(state, f);
      return;
    case '$group':
      if (!isPlain(body)) break;
      applyGroup(state, body);
      return;
    case '$count':
      if (typeof body !== 'string') break;
      rebuild(state, named(body));
      return;
    case '$sortByCount':
      rebuild(state, ['_id', 'count']);
      return;
    case '$bucket':
    case '$bucketAuto':
      if (!isPlain(body)) break;
      rebuild(state, ['_id', 'count', ...(isPlain(body.output) ? Object.keys(body.output) : [])]);
      return;
    case '$facet':
      if (!isPlain(body)) break;
      rebuild(state, Object.keys(body));
      return;
    case '$setWindowFields':
      if (!isPlain(body)) break;
      for (const k of isPlain(body.output) ? Object.keys(body.output) : []) addField(state, k);
      return;
    case '$geoNear':
      if (!isPlain(body)) break;
      for (const f of [...named(body.distanceField), ...named(body.includeLocs)]) addField(state, f);
      return;
    default:
      break;
  }
  // An operator the table does not know, or a body that does not parse.
  state.kind = 'unknown';
}

/** The shape of the documents reaching stage `index`: what the enabled stages before it leave. */
export function shapeBefore(stages: readonly ShapeStage[], index: number): StageShape {
  const state: StageShape = { kind: 'source', keepSource: true, removed: [], added: [] };
  for (const stage of stages.slice(0, index)) {
    if (stage.enabled) applyStage(state, stage);
  }
  return state;
}

/**
 * The fields to offer at a stage: what its `shape` keeps of the source
 * collection's fields, the fields stages added, and those seen in the
 * previous stage's preview. With nothing to go on after a shape the text
 * cannot describe, the source fields stand in and `unknownShape` says so.
 */
export function shapeFields(
  shape: StageShape,
  source: readonly SourceField[],
  preview: readonly string[],
): { fields: ShapeField[]; unknownShape: boolean } {
  const out = new Map<string, ShapeField>();
  if (shape.keepSource) {
    for (const f of source) {
      if (!shape.removed.some((r) => covers(r, f.path))) out.set(f.path, { ...f, origin: 'source' });
    }
  }
  for (const path of shape.added) {
    if (!out.has(path)) out.set(path, { path, origin: 'derived' });
  }
  for (const path of preview) {
    if (!out.has(path)) out.set(path, { path, origin: 'preview' });
  }
  const unknownShape = shape.kind === 'unknown' && preview.length === 0;
  if (out.size === 0 && unknownShape) {
    for (const f of source) out.set(f.path, { ...f, origin: 'source' });
  }
  return { fields: [...out.values()], unknownShape };
}

/**
 * The stages written so far in the pipeline array that ends at `text`'s end:
 * its complete `{ $op: body }` elements, in order. The element the caret is in
 * is not complete and is left out. An element that is not a one-operator
 * document stands in as an unreadable stage, so the shape after it is unknown.
 */
export function stagesInPipelineText(text: string): ShapeStage[] {
  const stages: ShapeStage[] = [];
  let depth = 0;
  let start = -1;
  let quote: string | null = null;
  for (let i = 0; i < text.length; i++) {
    const c = text[i]!;
    if (quote !== null) {
      if (c === '\\') i++;
      else if (c === quote) quote = null;
    } else if (c === '"' || c === "'") {
      quote = c;
    } else if (c === '{' || c === '[') {
      if (depth === 0 && c === '{') start = i;
      depth++;
    } else if (c === '}' || c === ']') {
      depth--;
      if (depth === 0 && c === '}') stages.push(stageOfElement(text.slice(start, i + 1)));
    }
  }
  return stages;
}

function stageOfElement(element: string): ShapeStage {
  const parsed = parseBody(element);
  const keys = isPlain(parsed) ? Object.keys(parsed) : [];
  if (isPlain(parsed) && keys.length === 1 && keys[0]!.startsWith('$')) {
    return { op: keys[0]!, body: JSON.stringify(parsed[keys[0]!]), enabled: true };
  }
  return { op: '$unreadable', body: '', enabled: true };
}
