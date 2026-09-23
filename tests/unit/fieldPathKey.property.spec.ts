import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { childKey, pathCoversSubtree, rootKey } from '../../src/pages/Workspace/views/fieldPathKey';

// #86 — proves the escaping scheme in `fieldPathKey.ts` is collision-free in
// general, not just for the one hand-picked repro in `fieldPathKey.spec.ts`.
//
// Alphabet limited to `.`, `:`, `\` (the two structural separators these
// keys use, plus the escape character itself) and one plain letter, so
// distinct segment lists collide on their RAW concatenation as often as
// possible — this is exactly the shape of #86's dotted-field-name bug, and
// the swapped-escape-order mutant (escaping `.`/`:` before `\`) is far more
// likely to be caught against this alphabet than against arbitrary strings.
const charArb = fc.constantFrom('a', '.', '\\', ':');
const segmentArb = fc.string({ unit: charArb, maxLength: 4 });
const nonEmptySegmentsArb = fc.array(segmentArb, { minLength: 1, maxLength: 4 });

// A "segment list" here is [docId, ...nestedFieldNames] — segments[0] is the
// top-level field under docId (`rootKey`), everything after it is one more
// level of nesting (`childKey`), matching how `docFieldFlatten.ts` and
// `DocFieldTree.tsx`'s recursion actually build a row's `path`.
function keyFor(docId: string, segments: readonly string[]): string {
  let key = rootKey(docId, segments[0]);
  for (const s of segments.slice(1)) key = childKey(key, s);
  return key;
}

function isSegmentPrefixOf(a: readonly string[], b: readonly string[]): boolean {
  return a.length <= b.length && a.every((s, i) => s === b[i]);
}

/**
 * Test-side decoder — the inverse of `keyFor`. Reviewer-requested (#86):
 * generating two INDEPENDENT random `(docId, segments)` pairs and checking
 * they collide only when equal is too weak in practice — with a 4-symbol
 * alphabet, two independently generated pairs almost never land on one of
 * the rare colliding shapes (e.g. `docId: "a:"`, `segments: ["b"]` vs
 * `docId: "a"`, `segments: [":b"]`, both of which land on the raw string
 * `"a:::b"` if the `:` escape is missing). A round-trip property instead
 * generates ONE input, encodes it, decodes it, and checks it comes back
 * unchanged — so it fails deterministically the moment ANY segment
 * containing `.`/`:`/`\` is escaped wrong, regardless of how unlikely that
 * exact shape would be to collide with an independently-drawn second input.
 *
 * Walks the key left to right: a `\` always escapes exactly the next
 * character (this holds for real output of `escapeKeySegment`, which never
 * emits a lone trailing `\`); an unescaped `::` is the docId/field boundary;
 * an unescaped `.` is a nesting boundary; anything else is literal segment
 * content.
 */
function decodeKey(key: string): { docId: string; segments: string[] } {
  const parts: string[] = [];
  const seps: string[] = [];
  let current = '';
  let i = 0;
  while (i < key.length) {
    const c = key[i];
    if (c === '\\') {
      current += key[i + 1];
      i += 2;
      continue;
    }
    if (c === ':' && key[i + 1] === ':') {
      parts.push(current);
      seps.push('::');
      current = '';
      i += 2;
      continue;
    }
    if (c === '.') {
      parts.push(current);
      seps.push('.');
      current = '';
      i += 1;
      continue;
    }
    current += c;
    i += 1;
  }
  parts.push(current);
  if (seps[0] !== '::') {
    throw new Error(`decodeKey: no unescaped root "::" boundary in ${JSON.stringify(key)}`);
  }
  return { docId: parts[0], segments: parts.slice(1) };
}

describe('fieldPathKey — property (#86)', () => {
  it('decodeKey(keyFor(docId, segments)) recovers the exact input — proves injectivity directly', () => {
    fc.assert(
      fc.property(segmentArb, nonEmptySegmentsArb, (docId, segments) => {
        expect(decodeKey(keyFor(docId, segments))).toEqual({ docId, segments });
      }),
    );
  });

  it('pathCoversSubtree(keyFor(docId, a), keyFor(docId, b)) holds iff a is a segment-prefix of b', () => {
    fc.assert(
      fc.property(segmentArb, nonEmptySegmentsArb, nonEmptySegmentsArb, (docId, a, b) => {
        expect(pathCoversSubtree(keyFor(docId, a), keyFor(docId, b))).toBe(isSegmentPrefixOf(a, b));
      }),
    );
  });
});
