import { syntaxTree } from '@codemirror/language';
import type { EditorState } from '@codemirror/state';
import type { SyntaxNode } from '@lezer/common';

/**
 * Result of locating the cursor inside a `db.<coll>.<method>(...)` field-key
 * slot. `from`/`to` describe the range CodeMirror should replace when the user
 * picks a completion. `partial` is the text already typed at the slot.
 */
export interface FieldPositionMatch {
  collection: string;
  from: number;
  to: number;
  partial: string;
  /** True when the slot lives inside a string-literal property key. */
  insideString: boolean;
}

/** Collection methods whose first arg is a filter document (field keys). */
const FILTER_METHODS_ARG0: ReadonlySet<string> = new Set([
  'find',
  'findOne',
  'countDocuments',
  'count',
  'distinct',
  'updateOne',
  'updateMany',
  'replaceOne',
  'deleteOne',
  'deleteMany',
  'findOneAndUpdate',
  'findOneAndReplace',
  'findOneAndDelete',
]);

/** Collection methods whose second arg is an update document (operator-keyed). */
const UPDATE_METHODS_ARG1: ReadonlySet<string> = new Set([
  'updateOne',
  'updateMany',
  'findOneAndUpdate',
]);

/** Aggregation stages whose value is a field-keyed object. */
const FIELD_KEYED_AGG_STAGES: ReadonlySet<string> = new Set([
  '$match',
  '$project',
  '$addFields',
  '$set',
  '$unset',
  '$group',
  '$sort',
  '$replaceWith',
  '$replaceRoot',
]);

/**
 * Logical query operators whose value contains nested field-keyed filter
 * documents. `$or`/`$and`/`$nor` wrap an array of filter docs; `$elemMatch`
 * wraps a single sub-filter. Walking past these keeps the field-keyed
 * context so autocomplete still fires inside the nested objects.
 */
const NESTED_FIELD_KEYED_LOGICAL_OPS: ReadonlySet<string> = new Set([
  '$or',
  '$and',
  '$nor',
  '$elemMatch',
]);

/** Update operators whose value is a field-keyed object. */
const FIELD_KEYED_UPDATE_OPS: ReadonlySet<string> = new Set([
  '$set',
  '$unset',
  '$inc',
  '$mul',
  '$min',
  '$max',
  '$rename',
  '$currentDate',
  '$setOnInsert',
  '$push',
  '$pull',
  '$pullAll',
  '$addToSet',
  '$pop',
  '$bit',
]);

interface KeySlot {
  enclosingObject: SyntaxNode;
  from: number;
  to: number;
  partial: string;
  insideString: boolean;
}

/**
 * Find the call argument the given object literal sits inside, walking past
 * intermediate Property/ArrayExpression layers. Returns the call info plus how
 * many `$<op>` Property keys we passed through on the way up — needed to
 * distinguish a top-level `aggregate([...])` stage spec (operator-keyed) from
 * a `$match: { ... }` payload (field-keyed).
 */
function resolveCollectionFromContext(
  startObject: SyntaxNode,
  state: EditorState,
): string | null {
  let current: SyntaxNode = startObject;
  let passedThroughOpKey = false;

  while (current.parent) {
    const parent: SyntaxNode = current.parent;

    if (parent.name === 'Property') {
      const keyNode = firstNamedChild(parent);
      if (!keyNode) return null;
      const keyText = readKeyText(keyNode, state);
      if (keyText === null) return null;
      if (keyText.startsWith('$')) {
        if (
          !FIELD_KEYED_AGG_STAGES.has(keyText) &&
          !FIELD_KEYED_UPDATE_OPS.has(keyText) &&
          !NESTED_FIELD_KEYED_LOGICAL_OPS.has(keyText)
        ) {
          return null;
        }
        passedThroughOpKey = true;
      }
      current = parent;
      continue;
    }

    if (parent.name === 'ArrayExpression' || parent.name === 'ObjectExpression') {
      current = parent;
      continue;
    }

    if (parent.name === 'ArgList') {
      const callExpr = parent.parent;
      if (!callExpr || callExpr.name !== 'CallExpression') return null;
      const argIndex = indexOfArg(parent, current);
      if (argIndex < 0) return null;
      const callInfo = parseDbCallee(callExpr, state);
      if (!callInfo) return null;
      const { collection, method } = callInfo;
      if (argIndex === 0 && method === 'aggregate') {
        return passedThroughOpKey ? collection : null;
      }
      if (argIndex === 0 && FILTER_METHODS_ARG0.has(method)) return collection;
      if (argIndex === 1 && UPDATE_METHODS_ARG1.has(method)) {
        return passedThroughOpKey ? collection : null;
      }
      return null;
    }

    return null;
  }
  return null;
}

/**
 * Lezer's firstChild/nextSibling iteration includes anonymous punctuation
 * tokens (`(`, `,`, `:`, `{`, …) — they have names equal to the token text.
 * For our purposes — finding the property key or counting argument index —
 * we only want named expression nodes (CamelCase or snake_case identifiers).
 */
function isNamedNode(node: SyntaxNode): boolean {
  const c = node.name.charCodeAt(0);
  return (c >= 65 && c <= 90) || (c >= 97 && c <= 122) || c === 95;
}

function firstNamedChild(node: SyntaxNode): SyntaxNode | null {
  let c = node.firstChild;
  while (c && !isNamedNode(c)) c = c.nextSibling;
  return c;
}

function readKeyText(keyNode: SyntaxNode, state: EditorState): string | null {
  if (keyNode.name === 'PropertyDefinition') {
    return state.doc.sliceString(keyNode.from, keyNode.to);
  }
  if (keyNode.name === 'String') {
    const raw = state.doc.sliceString(keyNode.from, keyNode.to);
    return stripQuotes(raw);
  }
  return null;
}

function stripQuotes(raw: string): string {
  if (raw.length >= 2) {
    const first = raw.charCodeAt(0);
    const last = raw.charCodeAt(raw.length - 1);
    if ((first === 34 || first === 39) && first === last) {
      return raw.slice(1, -1);
    }
  }
  return raw;
}

function indexOfArg(argList: SyntaxNode, target: SyntaxNode): number {
  let i = 0;
  for (let c = argList.firstChild; c; c = c.nextSibling) {
    if (!isNamedNode(c)) continue;
    if (c.from === target.from && c.to === target.to && c.name === target.name) {
      return i;
    }
    i++;
  }
  return -1;
}

interface CallInfo {
  collection: string;
  method: string;
}

/**
 * Parse a `db.<coll>.<method>` callee. Returns null for any other shape
 * (e.g., `someAlias.find()`, computed access, deeper chains). The MemberExpression
 * tree for `db.users.find` nests as MemberExpression(MemberExpression(VariableName,
 * PropertyName), PropertyName) — so the rightmost PropertyName is the method
 * and the inner MemberExpression carries the collection name + the `db` root.
 */
function parseDbCallee(callExpr: SyntaxNode, state: EditorState): CallInfo | null {
  const callee = callExpr.firstChild;
  if (!callee || callee.name !== 'MemberExpression') return null;
  const methodNode = callee.lastChild;
  if (!methodNode || methodNode.name !== 'PropertyName') return null;
  const inner = callee.firstChild;
  if (!inner || inner.name !== 'MemberExpression') return null;
  const collNode = inner.lastChild;
  if (!collNode || collNode.name !== 'PropertyName') return null;
  const dbNode = inner.firstChild;
  if (!dbNode || dbNode.name !== 'VariableName') return null;
  if (state.doc.sliceString(dbNode.from, dbNode.to) !== 'db') return null;
  return {
    collection: state.doc.sliceString(collNode.from, collNode.to),
    method: state.doc.sliceString(methodNode.from, methodNode.to),
  };
}

/**
 * Identify whether the cursor is sitting in a property-key slot of an
 * ObjectExpression, and if so, what range the completion should replace.
 * Returns null when the cursor is in a value slot, outside any object, or
 * inside a computed key (`[expr]`).
 */
function findKeySlot(state: EditorState, pos: number): KeySlot | null {
  const inner = syntaxTree(state).resolveInner(pos, -1);

  if (inner.name === 'ObjectExpression') {
    return {
      enclosingObject: inner,
      from: pos,
      to: pos,
      partial: '',
      insideString: false,
    };
  }

  const property =
    inner.name === 'Property' ? inner : inner.parent?.name === 'Property' ? inner.parent : null;
  if (property) {
    const keyNode = firstNamedChild(property);
    if (!keyNode) return null;
    if (pos < keyNode.from || pos > keyNode.to) return null;
    const enclosingObject = property.parent;
    if (!enclosingObject || enclosingObject.name !== 'ObjectExpression') return null;
    if (keyNode.name === 'String') {
      const innerEnd = Math.min(keyNode.to - 1, pos);
      const innerStart = keyNode.from + 1;
      if (pos < innerStart) return null;
      return {
        enclosingObject,
        from: innerStart,
        to: innerEnd,
        partial: state.doc.sliceString(innerStart, innerEnd),
        insideString: true,
      };
    }
    if (keyNode.name === 'PropertyDefinition') {
      return {
        enclosingObject,
        from: keyNode.from,
        to: pos,
        partial: state.doc.sliceString(keyNode.from, pos),
        insideString: false,
      };
    }
    return null;
  }

  let n: SyntaxNode | null = inner;
  while (n) {
    if (n.name === 'ObjectExpression') {
      return {
        enclosingObject: n,
        from: pos,
        to: pos,
        partial: '',
        insideString: false,
      };
    }
    if (
      n.name === 'Property' ||
      n.name === 'CallExpression' ||
      n.name === 'ArrayExpression' ||
      n.name === 'ArgList'
    ) {
      return null;
    }
    n = n.parent;
  }
  return null;
}

export function detectFieldPosition(
  state: EditorState,
  pos: number,
): FieldPositionMatch | null {
  const slot = findKeySlot(state, pos);
  if (!slot) return null;
  const collection = resolveCollectionFromContext(slot.enclosingObject, state);
  if (!collection) return null;
  return {
    collection,
    from: slot.from,
    to: slot.to,
    partial: slot.partial,
    insideString: slot.insideString,
  };
}
