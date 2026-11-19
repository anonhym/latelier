/**
 * Where in an aggregation stage body a field of the documents can be named,
 * and in which form. Pure tables over the key path the grammar reports.
 *
 * - `dollar`: an expression. The field is written `"$field"`.
 * - `bare`: a key or a name. The field is written `"field"`.
 *
 * `fields` says whose fields fit: the stage's input documents, or those of
 * the collection the stage joins (`from`).
 */

export type FieldForm = 'dollar' | 'bare';

export interface FieldSlot {
  form: FieldForm;
  fields: 'input' | 'from';
}

const DOLLAR: FieldSlot = { form: 'dollar', fields: 'input' };
const BARE: FieldSlot = { form: 'bare', fields: 'input' };
const BARE_FROM: FieldSlot = { form: 'bare', fields: 'from' };

/** The stages whose whole body is one expression. */
const EXPRESSION_STAGES: ReadonlySet<string> = new Set(['$sortByCount', '$replaceWith', '$redact']);

/**
 * What a value at `path` takes, or null when it takes no field. `path` runs
 * from the body's root: an object key, or `[]` for an array. A string body
 * (`$unwind: "$tags"`) has the empty path.
 */
export function fieldSlot(stageOp: string | undefined, path: readonly string[]): FieldSlot | null {
  if (stageOp === undefined) return null;
  const first = path[0];
  const depth = path.length;
  if (EXPRESSION_STAGES.has(stageOp)) return DOLLAR;
  switch (stageOp) {
    case '$group':
      // `_id` and every accumulator argument are expressions; a bare `name: "x"` is not.
      return first === '_id' || depth >= 2 ? DOLLAR : null;
    case '$project':
    case '$addFields':
    case '$set':
      return depth >= 1 ? DOLLAR : null;
    case '$unwind':
      return depth === 0 || (depth === 1 && first === 'path') ? DOLLAR : null;
    case '$replaceRoot':
      return first === 'newRoot' ? DOLLAR : null;
    case '$bucket':
    case '$bucketAuto':
    case '$setWindowFields':
      if (first === 'groupBy' || first === 'partitionBy') return DOLLAR;
      // `output: { <field>: { <accumulator>: <expression> } }`.
      return first === 'output' && depth >= 3 ? DOLLAR : null;
    case '$lookup':
      if (depth === 1 && first === 'localField') return BARE;
      if (depth === 1 && first === 'foreignField') return BARE_FROM;
      return first === 'let' && depth >= 2 ? DOLLAR : null;
    case '$graphLookup':
      if (first === 'startWith') return DOLLAR;
      return depth === 1 && (first === 'connectFromField' || first === 'connectToField') ? BARE_FROM : null;
    case '$unset':
      return depth === 0 || (depth === 1 && first === '[]') ? BARE : null;
    case '$match':
      // A plain string is a value to compare with; only `$expr` holds expressions.
      return path.includes('$expr') ? DOLLAR : null;
    default:
      return null;
  }
}

/**
 * The collection a `$lookup` or `$graphLookup` body joins, read from its
 * `from` key. Null when the body names none as a string (the `{ db, coll }`
 * form is not followed). One non-nested pattern over the text, so it cannot
 * backtrack badly on what the user typed.
 */
export function lookupFrom(body: string): string | null {
  const m = /(?:^|[{,\s])["']?from["']?\s*:\s*(?:"([^"\n]*)"|'([^'\n]*)')/.exec(body);
  const name = m?.[1] ?? m?.[2];
  return name === undefined || name === '' ? null : name;
}

/** An unquoted key must be an identifier; anything else (`a.b`) needs quotes to parse. */
export function isPlainKey(path: string): boolean {
  return /^[A-Za-z_$][\w$]*$/.test(path);
}

/** Where a path runs through a `$lookup`'s `pipeline`: the sub-stage it is in, and the path within it. */
export interface SubPipelinePath {
  /** The sub-stage's operator, or null between stages (where a stage name goes). */
  op: string | null;
  rest: string[];
}

/**
 * Whether `path` (from the body's root) lies inside a `$lookup`'s
 * `pipeline: [ ... ]`, and where. Its stages run over the joined collection.
 */
export function subPipelinePath(stageOp: string | undefined, path: readonly string[]): SubPipelinePath | null {
  if (stageOp !== '$lookup' || path[0] !== 'pipeline' || path[1] !== '[]') return null;
  const op = path[2];
  return op !== undefined && op.startsWith('$') ? { op, rest: path.slice(3) } : { op: null, rest: [] };
}

/** The text of the sub-pipeline the caret is in, from just after its `[`, or null. */
export function subPipelineText(body: string, caret: number): string | null {
  const before = body.slice(0, caret);
  const opens = [...before.matchAll(/["']?pipeline["']?\s*:\s*\[/g)];
  const last = opens[opens.length - 1];
  return last === undefined ? null : before.slice(last.index + last[0].length);
}
