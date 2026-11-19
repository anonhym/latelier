import { isWriteStage } from '../mongo/writeStages.ts';
import { AgentToolError } from './errorMap.ts';

/** X27 §7.2: the only stages an Agent may run, at any depth. A stage a later server adds stays refused until it is listed here. */
export const ALLOWED_STAGES: ReadonlySet<string> = new Set([
  '$match',
  '$project',
  '$addFields',
  '$set',
  '$unset',
  '$group',
  '$sort',
  '$limit',
  '$skip',
  '$unwind',
  '$count',
  '$sortByCount',
  '$bucket',
  '$bucketAuto',
  '$facet',
  '$replaceRoot',
  '$replaceWith',
  '$lookup',
  '$graphLookup',
  '$unionWith',
  '$sample',
  '$redact',
  '$densify',
  '$fill',
  '$setWindowFields',
  '$geoNear',
]);

/** X27 §7.3: operators that run JavaScript per document. */
export const SERVER_JS_KEYS: ReadonlySet<string> = new Set(['$where', '$function', '$accumulator']);

/** How many pipelines may sit inside one another (`$facet`, `$lookup.pipeline`, `$unionWith.pipeline`). */
export const MAX_PIPELINE_NESTING = 16;
/** How deep any JSON value an Agent sends may nest, so no walk below can exhaust the stack. */
export const MAX_JSON_DEPTH = 100;

const MAX_OPERATOR_NAME = 64;

function invalid(message: string): AgentToolError {
  return new AgentToolError('INVALID_INPUT', message);
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Refuses a value nested deeper than `MAX_JSON_DEPTH`. Iterative, and run before
 * anything that recurses, because a 1 MiB message of `[[[[…` is valid JSON.
 */
export function assertDepth(value: unknown, max = MAX_JSON_DEPTH): void {
  const stack: Array<{ node: unknown; depth: number }> = [{ node: value, depth: 1 }];
  while (stack.length > 0) {
    const { node, depth } = stack.pop()!;
    if (typeof node !== 'object' || node === null) continue;
    if (depth > max) throw invalid('The input is nested too deeply.');
    for (const child of Array.isArray(node) ? node : Object.values(node)) {
      stack.push({ node: child, depth: depth + 1 });
    }
  }
}

/**
 * Refuses `$where`, `$function` and `$accumulator` anywhere in `value`: a find
 * filter, projection or sort, or any stage of a pipeline at any depth. A walk
 * over own keys, not a regex, so nothing here can backtrack.
 */
export function assertNoServerJs(value: unknown): void {
  const stack: unknown[] = [value];
  while (stack.length > 0) {
    const node = stack.pop();
    if (typeof node !== 'object' || node === null) continue;
    // Own keys; an array's are its indices. A loop, not `push(...node)`, which a long array would break.
    for (const key of Object.keys(node)) {
      if (SERVER_JS_KEYS.has(key)) throw new AgentToolError('JS_NOT_ALLOWED');
      stack.push((node as Record<string, unknown>)[key]);
    }
  }
}

export type StageVisitor = (op: string, body: unknown) => void;

/** The pipelines nested in one stage's body. A malformed container is refused rather than skipped. */
function nestedPipelines(op: string, body: unknown): unknown[] {
  if (op === '$facet') {
    if (!isRecord(body)) throw invalid('$facet takes an object of pipelines.');
    return Object.keys(body).map((key) => body[key]);
  }
  if ((op === '$lookup' || op === '$unionWith') && isRecord(body) && Object.hasOwn(body, 'pipeline')) {
    return [body.pipeline];
  }
  return [];
}

/**
 * Calls `visit` for every stage of `pipeline` and of every pipeline nested in
 * it, outermost first. A stage that is not an object with exactly one operator
 * key is INVALID_INPUT: the server would refuse it anyway, and a stage this
 * walk cannot read is one it cannot vouch for.
 */
export function walkStages(pipeline: unknown, visit: StageVisitor, level = 0): void {
  if (level > MAX_PIPELINE_NESTING) throw invalid('The pipeline is nested too deeply.');
  if (!Array.isArray(pipeline)) throw invalid('A pipeline must be an array of stages.');
  for (const stage of pipeline) {
    if (!isRecord(stage)) throw invalid('Each pipeline stage must be an object.');
    const keys = Object.keys(stage);
    if (keys.length !== 1) throw invalid('Each pipeline stage must have exactly one operator.');
    const op = keys[0]!;
    const body = stage[op];
    visit(op, body);
    for (const inner of nestedPipelines(op, body)) walkStages(inner, visit, level + 1);
  }
}

/**
 * The stage allowlist (X27 §7.2) over the whole pipeline, nested pipelines
 * included. `isWriteStage` stays as a second line: a stage in `allowed` that
 * writes is still refused. `allowed` is a parameter so a test can prove that.
 */
export function assertPipeline(pipeline: unknown, allowed: ReadonlySet<string> = ALLOWED_STAGES): void {
  walkStages(pipeline, (op) => {
    if (allowed.has(op) && !isWriteStage(op)) return;
    const shown = op.length > MAX_OPERATOR_NAME ? `${op.slice(0, MAX_OPERATOR_NAME)}...` : op;
    throw new AgentToolError('STAGE_NOT_ALLOWED', `The pipeline stage ${shown} is not allowed.`);
  });
}
