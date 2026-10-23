import { isExactSentinel } from './ejson';
import { parseJsonKeepingBigInts } from './bigIntJson';

/**
 * Copy as code (#23): a find or an aggregate as a snippet for mongosh, the
 * Node.js driver or PyMongo.
 *
 * Inputs are Canonical EJSON text. That is not shell syntax: pasted into
 * mongosh, `{"$oid": "…"}` reads as an unknown query operator, and a bare
 * `9007199254740993` rounds. So every document travels as a string literal
 * through the language's own EJSON parser, which keeps every BSON type; only
 * mongosh takes a document verbatim, and only when it holds neither.
 */
export type CodeLang = 'mongosh' | 'node' | 'python';

export const CODE_LANGS: readonly { lang: CodeLang; label: string }[] = [
  { lang: 'mongosh', label: 'mongosh' },
  { lang: 'node', label: 'Node.js' },
  { lang: 'python', label: 'Python' },
];

export interface FindCodeInput {
  collection: string;
  filter: string;
  projection?: string;
  sort?: string;
  skip: number;
  limit: number;
}

export interface AggregateCodeInput {
  collection: string;
  pipelineJson: string;
}

/** Arrays walk like objects: an array's keys are never a sentinel's. */
function hasSentinel(node: unknown): boolean {
  if (node === null || typeof node !== 'object') return false;
  const obj = node as Record<string, unknown>;
  return isExactSentinel(obj) || Object.values(obj).some(hasSentinel);
}

/**
 * `text` with any bare integer beyond 2^53 rewritten as `$numberLong` (the
 * Long the app itself runs it as), and whether it now holds a sentinel.
 * Text without such an integer is kept as the user spelled it.
 */
function lossless(text: string): { text: string; sentinel: boolean } {
  const kept = parseJsonKeepingBigInts(text);
  const rewritten = JSON.stringify(kept);
  return {
    text: rewritten === JSON.stringify(JSON.parse(text)) ? text : rewritten,
    sentinel: hasSentinel(kept),
  };
}

/**
 * A JSON string literal: also a valid JavaScript and Python string literal,
 * since JSON.stringify escapes quotes, backslashes and control characters.
 */
const str = (s: string): string => JSON.stringify(s);

function mongoshArg(text: string): string {
  const doc = lossless(text);
  return doc.sentinel ? `EJSON.parse(${str(doc.text)}, { relaxed: false })` : doc.text;
}

const nodeParse = (text: string): string => `EJSON.parse(${str(lossless(text).text)}, { relaxed: false })`;
const pyParse = (text: string): string => `json_util.loads(${str(lossless(text).text)})`;

export function findCode(lang: CodeLang, input: FindCodeInput): string {
  const { collection, filter, projection, sort, skip, limit } = input;
  // The driver reads limit 0 as "no limit": emitting one would paste an
  // unbounded cursor for a page the app shows as empty.
  if (limit <= 0) throw new Error(`findCode: limit must be positive, got ${limit}`);

  if (lang === 'mongosh') {
    let code = `db.getCollection(${str(collection)}).find(${mongoshArg(filter)}`;
    if (projection) code += `, ${mongoshArg(projection)}`;
    code += ')';
    if (sort) code += `.sort(${mongoshArg(sort)})`;
    if (skip > 0) code += `.skip(${skip})`;
    return `${code}.limit(${limit})`;
  }

  if (lang === 'node') {
    const lines = ["const { EJSON } = require('bson');", '', `const filter = ${nodeParse(filter)};`];
    const opts: string[] = [];
    if (projection) {
      lines.push(`const projection = ${nodeParse(projection)};`);
      opts.push('projection');
    }
    if (sort) {
      lines.push(`const sort = ${nodeParse(sort)};`);
      opts.push('sort');
    }
    if (skip > 0) opts.push(`skip: ${skip}`);
    opts.push(`limit: ${limit}`);
    lines.push(`const cursor = db.collection(${str(collection)}).find(filter, { ${opts.join(', ')} });`);
    return lines.join('\n');
  }

  const lines = ['from bson import json_util', '', `query = ${pyParse(filter)}`];
  const args = ['query'];
  if (projection) {
    lines.push(`projection = ${pyParse(projection)}`);
    args.push('projection');
  }
  if (sort) {
    lines.push(`sort = list(${pyParse(sort)}.items())`);
    args.push('sort=sort');
  }
  if (skip > 0) args.push(`skip=${skip}`);
  args.push(`limit=${limit}`);
  lines.push(`cursor = db[${str(collection)}].find(${args.join(', ')})`);
  return lines.join('\n');
}

export function aggregateCode(lang: CodeLang, input: AggregateCodeInput): string {
  const { collection, pipelineJson } = input;
  if (lang === 'mongosh') {
    return `db.getCollection(${str(collection)}).aggregate(${mongoshArg(pipelineJson)})`;
  }
  if (lang === 'node') {
    return [
      "const { EJSON } = require('bson');",
      '',
      `const pipeline = ${nodeParse(pipelineJson)};`,
      `const cursor = db.collection(${str(collection)}).aggregate(pipeline);`,
    ].join('\n');
  }
  return [
    'from bson import json_util',
    '',
    `pipeline = ${pyParse(pipelineJson)}`,
    `cursor = db[${str(collection)}].aggregate(pipeline)`,
  ].join('\n');
}
