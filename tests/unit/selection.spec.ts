import { describe, it, expect } from 'vitest';
import { ejsonParse } from '../../src/utils/ejson';
import {
  sortedIndices,
  selectedDocs,
  buildDeleteSelectedFilterJson,
  serializeSelectedForClipboard,
} from '../../src/pages/Workspace/selection';

describe('sortedIndices', () => {
  it('returns ascending numeric order, not lexicographic', () => {
    expect(sortedIndices(new Set([10, 1, 2]))).toEqual([1, 2, 10]);
  });

  it('returns an empty array for an empty set', () => {
    expect(sortedIndices(new Set())).toEqual([]);
  });
});

describe('selectedDocs', () => {
  it('maps indices to documents in ascending index order regardless of insertion order', () => {
    const documents = ['a', 'b', 'c'];
    expect(selectedDocs(documents, new Set([2, 0]))).toEqual(['a', 'c']);
  });

  it('drops indices that no longer resolve to a document', () => {
    const documents = ['a', 'b'];
    expect(selectedDocs(documents, new Set([0, 5]))).toEqual(['a']);
  });
});

describe('buildDeleteSelectedFilterJson', () => {
  // Fixtures use `ejsonParse` (the same revival path `api.query.find`'s
  // result goes through at the renderer edge) so `_id` is a real revived
  // ObjectId instance here, not a `{$oid: ...}` sentinel object — matching
  // what `documents` actually contains at runtime.
  it('builds a canonical {_id:{$in:[...]}} filter from revived-BSON docs', () => {
    const docs = [
      ejsonParse<{ _id: unknown }>('{"_id":{"$oid":"507f1f77bcf86cd799439011"}}'),
      ejsonParse<{ _id: unknown }>('{"_id":{"$oid":"507f1f77bcf86cd799439012"}}'),
    ];

    const filterJson = buildDeleteSelectedFilterJson(docs);
    expect(filterJson).not.toBeNull();

    // Round-trips through ejsonParse back to real ObjectId instances.
    const revived = ejsonParse<{ _id: { $in: { toHexString(): string }[] } }>(filterJson!);
    expect(revived._id.$in.map((oid) => oid.toHexString())).toEqual([
      '507f1f77bcf86cd799439011',
      '507f1f77bcf86cd799439012',
    ]);

    // And the wire form itself is canonical EJSON — sentinels, not bare hex.
    expect(JSON.parse(filterJson!)).toEqual({
      _id: {
        $in: [
          { $oid: '507f1f77bcf86cd799439011' },
          { $oid: '507f1f77bcf86cd799439012' },
        ],
      },
    });
  });

  it('excludes docs lacking an _id', () => {
    const docs = [
      ejsonParse<{ _id: unknown }>('{"_id":{"$oid":"507f1f77bcf86cd799439011"}}'),
      { name: 'no id' },
    ];
    const filterJson = buildDeleteSelectedFilterJson(docs);
    expect(JSON.parse(filterJson!)).toEqual({
      _id: { $in: [{ $oid: '507f1f77bcf86cd799439011' }] },
    });
  });

  it('returns null when none of the selected docs have an _id', () => {
    expect(buildDeleteSelectedFilterJson([{ name: 'x' }, { name: 'y' }])).toBeNull();
  });

  it('returns null for an empty selection', () => {
    expect(buildDeleteSelectedFilterJson([])).toBeNull();
  });
});

describe('serializeSelectedForClipboard', () => {
  it('serializes a single doc as a bare EJSON object, preserving sentinels', () => {
    const doc = ejsonParse('{"_id":{"$oid":"507f1f77bcf86cd799439011"},"name":"alpha"}');
    const text = serializeSelectedForClipboard([doc]);
    expect(JSON.parse(text)).toEqual({
      _id: { $oid: '507f1f77bcf86cd799439011' },
      name: 'alpha',
    });
  });

  it('serializes multiple docs as an EJSON array, preserving sentinels', () => {
    const docs = [
      ejsonParse('{"_id":{"$oid":"507f1f77bcf86cd799439011"}}'),
      ejsonParse('{"_id":{"$oid":"507f1f77bcf86cd799439012"}}'),
    ];
    const text = serializeSelectedForClipboard(docs);
    const parsed = JSON.parse(text);
    expect(Array.isArray(parsed)).toBe(true);
    expect(parsed).toEqual([
      { _id: { $oid: '507f1f77bcf86cd799439011' } },
      { _id: { $oid: '507f1f77bcf86cd799439012' } },
    ]);
  });
});
