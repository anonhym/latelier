import { describe, it, expect } from 'vitest';
import { childKey, escapeKeySegment, pathCoversSubtree, rootKey } from '../../src/pages/Workspace/views/fieldPathKey';

// #86 — a field row's identity key used to be built by plain concatenation
// (`${docId}::${field}`, then `.`-joined per nested level), so a top-level
// field literally named "a.b" and a nested field `b` under top-level "a"
// produced the identical string. These keys escape `.`/`:`/`\` in every
// segment before joining, so that can no longer happen — see
// `fieldPathKey.property.spec.ts` for the general proof.
describe('fieldPathKey', () => {
  it('escapes backslash first, then the two structural separators', () => {
    expect(escapeKeySegment('a')).toBe('a');
    expect(escapeKeySegment('a.b')).toBe('a\\.b');
    expect(escapeKeySegment('a:b')).toBe('a\\:b');
    expect(escapeKeySegment('a\\b')).toBe('a\\\\b');
    // Backslash-first ordering matters: escaping `.`/`:` before `\` would
    // re-escape the backslashes those steps just introduced.
    expect(escapeKeySegment('a\\.b')).toBe('a\\\\\\.b');
  });

  it('rootKey escapes both the docId and the field name', () => {
    expect(rootKey('doc1', 'a')).toBe('doc1::a');
    expect(rootKey('doc1', 'a.b')).toBe('doc1::a\\.b');
    expect(rootKey('a:b', 'c')).toBe('a\\:b::c');
  });

  it('childKey only escapes the new segment — the parent key is already complete', () => {
    expect(childKey('doc1::a', 'b')).toBe('doc1::a.b');
    expect(childKey('doc1::a', 'b.c')).toBe('doc1::a.b\\.c');
  });

  // The #86 repro: `{ "a.b": 1, "a": { "b": 2 } }`.
  it('a dotted top-level field name no longer collides with a nested field of the same shape', () => {
    const dottedTopLevel = rootKey('doc1', 'a.b');
    const nested = childKey(rootKey('doc1', 'a'), 'b');
    expect(dottedTopLevel).not.toBe(nested);
  });

  it('a field name containing the escape character itself stays unambiguous', () => {
    const backslashField = rootKey('doc1', '\\');
    const literalDoubleBackslashField = rootKey('doc1', '\\\\');
    expect(backslashField).not.toBe(literalDoubleBackslashField);
  });

  describe('pathCoversSubtree', () => {
    it('is true for the row itself and any descendant', () => {
      expect(pathCoversSubtree('doc1::a', 'doc1::a')).toBe(true);
      expect(pathCoversSubtree('doc1::a', 'doc1::a.b')).toBe(true);
      expect(pathCoversSubtree('doc1::a', 'doc1::a.b.c')).toBe(true);
    });

    it('is false for a sibling whose name merely shares a string prefix', () => {
      expect(pathCoversSubtree('doc1::a', 'doc1::ab')).toBe(false);
    });

    it('is false for null (no active/copied row)', () => {
      expect(pathCoversSubtree('doc1::a', null)).toBe(false);
    });
  });
});
