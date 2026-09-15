/**
 * Best-effort grammar detector for aggregation stage bodies. Given the text
 * of a stage body and a caret offset, returns what kind of suggestion is
 * appropriate at that position, or null to hide the popover.
 */

import type { OperatorContext } from './operators';

export type GrammarHit =
  | {
      kind: 'fieldName';
      token: string;
      replaceStart: number;
      replaceEnd: number;
      /** Where the caret sits so operator suggestions can be context-ranked. */
      operatorContext?: OperatorContext;
    }
  | { kind: 'fieldRef'; token: string; replaceStart: number; replaceEnd: number }
  | { kind: 'valueFor'; field: string; token: string; replaceStart: number; replaceEnd: number };

interface Scope {
  type: 'obj' | 'arr';
  mode: 'key' | 'afterKey' | 'value';
  lastKey: string | null;
}

const IDENT = /[A-Za-z0-9_$.]/;

/**
 * Map a stageOp + object-nesting depth to the operator context at the caret.
 * Depth 1 means "direct child of the stage body object". $facet and unknown
 * stages return null so the full catalog shows.
 */
function resolveOperatorContext(
  stageOp: string | undefined,
  depth: number,
): OperatorContext | undefined {
  if (!stageOp || stageOp === '$facet') return undefined;
  if (stageOp === '$match') return 'matchKey';
  if (depth <= 1) {
    // Depth 1 inside $group/$project/etc. is a user-defined field name; no
    // operator context narrows to something useful yet.
    return undefined;
  }
  if (stageOp === '$group') return 'groupValue';
  if (stageOp === '$project') return 'projectValue';
  if (stageOp === '$set' || stageOp === '$addFields') return 'addFieldsValue';
  return undefined;
}

export function detectAggGrammar(
  value: string,
  caret: number,
  stageOp?: string,
): GrammarHit | null {
  const scopes: Scope[] = [];
  let inString = false;
  let stringStart = -1;
  let stringQuote = '"';
  let prevModeAtStringStart: 'key' | 'value' | 'arr' | 'top' = 'top';
  let prevKeyAtStringStart: string | null = null;
  let escape = false;

  const n = Math.min(caret, value.length);
  for (let i = 0; i < n; i++) {
    const c = value[i];
    if (inString) {
      if (escape) { escape = false; continue; }
      if (c === '\\') { escape = true; continue; }
      if (c === stringQuote) {
        const s = scopes[scopes.length - 1];
        if (s?.type === 'obj' && s.mode === 'key') {
          s.lastKey = value.substring(stringStart + 1, i);
          s.mode = 'afterKey';
        }
        inString = false;
      }
      continue;
    }
    if (c === '"' || c === "'") {
      inString = true;
      stringStart = i;
      stringQuote = c;
      const s = scopes[scopes.length - 1];
      if (!s) prevModeAtStringStart = 'top';
      else if (s.type === 'arr') prevModeAtStringStart = 'arr';
      else if (s.mode === 'key') prevModeAtStringStart = 'key';
      else prevModeAtStringStart = 'value';
      prevKeyAtStringStart = s?.lastKey ?? null;
    } else if (c === '{') {
      scopes.push({ type: 'obj', mode: 'key', lastKey: null });
    } else if (c === '[') {
      scopes.push({ type: 'arr', mode: 'key', lastKey: null });
    } else if (c === '}' || c === ']') {
      scopes.pop();
    } else if (c === ':') {
      const s = scopes[scopes.length - 1];
      if (s?.type === 'obj') {
        s.mode = 'value';
        if (s.lastKey === null) {
          let end = i;
          while (end > 0 && /\s/.test(value[end - 1] ?? '')) end--;
          let start = end;
          while (start > 0 && IDENT.test(value[start - 1] ?? '')) start--;
          if (end > start) s.lastKey = value.substring(start, end);
        }
      }
    } else if (c === ',') {
      const s = scopes[scopes.length - 1];
      if (s?.type === 'obj') { s.mode = 'key'; s.lastKey = null; }
    }
  }

  if (inString) {
    const inner = value.substring(stringStart + 1, caret);
    const replaceStart = stringStart + 1;
    const replaceEnd = caret;
    if (prevModeAtStringStart === 'key') {
      return {
        kind: 'fieldName',
        token: inner,
        replaceStart,
        replaceEnd,
        operatorContext: resolveOperatorContext(stageOp, scopes.length),
      };
    }
    if (prevModeAtStringStart === 'value' || prevModeAtStringStart === 'arr') {
      if (inner.startsWith('$')) {
        return { kind: 'fieldRef', token: inner.slice(1), replaceStart: replaceStart + 1, replaceEnd };
      }
      if (prevModeAtStringStart === 'value' && prevKeyAtStringStart) {
        return {
          kind: 'valueFor',
          field: prevKeyAtStringStart,
          token: inner,
          replaceStart,
          replaceEnd,
        };
      }
    }
    return null;
  }

  const s = scopes[scopes.length - 1];
  if (s?.type === 'obj' && s.mode === 'key') {
    let start = caret;
    while (start > 0 && IDENT.test(value[start - 1] ?? '')) start--;
    const token = value.substring(start, caret);
    // `$`-prefixed bare keys still return a fieldName hit; the operator source
    // consumes the same hit to offer `$eq`, `$sum`, etc.
    return {
      kind: 'fieldName',
      token,
      replaceStart: start,
      replaceEnd: caret,
      operatorContext: resolveOperatorContext(stageOp, scopes.length),
    };
  }

  return null;
}
