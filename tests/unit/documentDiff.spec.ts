import { describe, it, expect } from 'vitest';
import { BSONRegExp, Decimal128, Double, Int32, Long, ObjectId } from 'bson';
import {
  applyDiff,
  buildUpdateRequest,
  changeList,
  changeText,
  classifyConflict,
  deleteAtSegments,
  diff,
  getAtSegments,
  isEdited,
  isEmptyDiff,
  isUnsafeFieldName,
  oneLineValue,
  operatorSummary,
  parseJsonDraft,
  resolveConflict,
  setAtSegments,
  typeChangeOf,
  typeChangeText,
} from '../../src/pages/Workspace/documentDiff';
import { ejsonParse, ejsonStringify, ejsonStringifyReadable } from '../../src/utils/ejson';

const ID = new ObjectId('507f1f77bcf86cd799439011');

/** Plain JSON view, for `toEqual` against literals; an Int32 reads as a bare number. */
const plain = (v: unknown) => JSON.parse(ejsonStringifyReadable(v)) as unknown;

describe('diff', () => {
  it('is empty for an unchanged document', () => {
    const doc = { _id: ID, a: new Int32(1), o: { x: 'y' }, arr: [1, 2] };
    expect(diff(doc, ejsonParse(ejsonStringify(doc)))).toEqual({ set: {}, unset: [] });
  });

  it('sets a changed scalar and an added field, unsets a removed one', () => {
    const d = diff({ _id: ID, a: 'x', gone: true }, { _id: ID, a: 'y', added: new Int32(3) });
    expect(plain(d)).toEqual({ set: { a: 'y', added: 3 }, unset: ['gone'] });
  });

  it('detects an Int32(1) → Double(1) type change', () => {
    const d = diff({ _id: ID, n: new Int32(1) }, { _id: ID, n: new Double(1) });
    expect(Object.keys(d.set)).toEqual(['n']);
    expect(d.set.n).toBeInstanceOf(Double);
  });

  it('never includes _id, even when it changes', () => {
    expect(isEmptyDiff(diff({ _id: 1 }, { _id: 2 }))).toBe(true);
    expect(isEmptyDiff(diff({ _id: 1 }, {}))).toBe(true);
  });

  it('emits a nested change as its dotted path, and a nested removal as a dotted unset', () => {
    const d = diff(
      { _id: ID, addr: { city: 'A', zip: '1', geo: { lat: 1 } } },
      { _id: ID, addr: { city: 'B', geo: { lat: 2 } } },
    );
    expect(plain(d)).toEqual({ set: { 'addr.city': 'B', 'addr.geo.lat': 2 }, unset: ['addr.zip'] });
  });

  it('sends an array whole, never by index', () => {
    const d = diff({ _id: ID, tags: ['a', 'b', 'c'] }, { _id: ID, tags: ['a', 'x', 'c'] });
    expect(plain(d)).toEqual({ set: { tags: ['a', 'x', 'c'] }, unset: [] });
  });

  it('sends a value whole when it changes between a sub-document and anything else', () => {
    expect(plain(diff({ o: { a: 1 } }, { o: 5 }))).toEqual({ set: { o: 5 }, unset: [] });
    expect(plain(diff({ o: 5 }, { o: { a: 1 } }))).toEqual({ set: { o: { a: 1 } }, unset: [] });
  });

  it('treats a BSON value as a leaf, never recursing into it', () => {
    const d = diff({ at: new Date(0), l: Long.fromNumber(1) }, { at: new Date(1), l: Long.fromNumber(2) });
    expect(Object.keys(d.set).sort((a, b) => a.localeCompare(b))).toEqual(['at', 'l']);
  });

  it('saves nothing for a key reorder inside a sub-document', () => {
    expect(isEmptyDiff(diff({ o: { a: 1, b: 2 } }, { o: { b: 2, a: 1 } }))).toBe(true);
  });

  it.each([
    ['a dotted name', 'x.y'],
    ['a $-prefixed name', '$k'],
    ['an empty name', ''],
  ])('falls back to the nearest safe ancestor for a change under %s', (_label, bad) => {
    const d = diff(
      { top: { mid: { [bad]: 1, keep: 1 } } },
      { top: { mid: { [bad]: 2, keep: 1 } } },
    );
    expect(plain(d)).toEqual({ set: { 'top.mid': { [bad]: 2, keep: 1 } }, unset: [] });
  });

  it('falls back for an added or removed unsafe name too', () => {
    expect(Object.keys(diff({ o: {} }, { o: { 'a.b': 1 } }).set)).toEqual(['o']);
    expect(plain(diff({ o: { $x: 1, k: 1 } }, { o: { k: 1 } }))).toEqual({ set: { o: { k: 1 } }, unset: [] });
  });

  it('keeps dotted paths for safe siblings of an unchanged unsafe name', () => {
    const d = diff({ o: { 'a.b': 1, k: 1 } }, { o: { 'a.b': 1, k: 2 } });
    expect(plain(d)).toEqual({ set: { 'o.k': 2 }, unset: [] });
  });

  it('emits an unsafe top-level name as-is, having no ancestor to fall back to', () => {
    expect(plain(diff({ 'a.b': 1 }, { 'a.b': 2 }))).toEqual({ set: { 'a.b': 2 }, unset: [] });
  });
});

describe('isEdited', () => {
  const d = { set: { 'addr.city': 'B', name: 'x' }, unset: ['gone.deep'] };
  it('marks a field whose own path or a path beneath it is in the diff', () => {
    expect(isEdited(d, 'addr')).toBe(true);
    expect(isEdited(d, 'name')).toBe(true);
    expect(isEdited(d, 'gone')).toBe(true);
  });
  it('marks from any one of several unsets, and marks nothing for an empty diff', () => {
    expect(isEdited({ set: {}, unset: ['x', 'gone'] }, 'gone')).toBe(true);
    expect(isEdited({ set: {}, unset: [] }, 'gone')).toBe(false);
  });

  it('does not mark a field that merely shares a prefix', () => {
    expect(isEdited(d, 'add')).toBe(false);
    expect(isEdited(d, 'names')).toBe(false);
    expect(isEdited(d, 'other')).toBe(false);
  });
});

describe('getAtSegments / setAtSegments / deleteAtSegments', () => {
  it('reads a value by its literal key segments, dots and all', () => {
    expect(getAtSegments({ o: { 'a.b': 1 } }, ['o', 'a.b'])).toEqual({ value: 1 });
    expect(getAtSegments({ o: { a: 1 } }, ['o', 'missing'])).toBeNull();
    expect(getAtSegments({ o: 5 }, ['o', 'a'])).toBeNull();
  });

  it('sets a value at nested segments, creating missing objects, without mutating the input', () => {
    const doc = { o: { k: 1 } };
    const out = setAtSegments(doc, ['o', 'new'], 2);
    expect(plain(out)).toEqual({ o: { k: 1, new: 2 } });
    expect(doc).toEqual({ o: { k: 1 } });
  });

  it('treats one segment as one literal key, never as a nested path', () => {
    const out = setAtSegments({}, ['top', 'a.b'], 1);
    expect(plain(out)).toEqual({ top: { 'a.b': 1 } });
  });

  it('replaces a non-document on the way down when setting', () => {
    expect(plain(setAtSegments({ o: 5 }, ['o', 'k'], 'v'))).toEqual({ o: { k: 'v' } });
  });

  it('deletes a value at nested segments, keeping siblings, without mutating the input', () => {
    const doc = { o: { k: 1, keep: 2 } };
    const out = deleteAtSegments(doc, ['o', 'k']);
    expect(plain(out)).toEqual({ o: { keep: 2 } });
    expect(doc).toEqual({ o: { k: 1, keep: 2 } });
  });

  it('is a no-op deleting under a missing or non-document intermediate value', () => {
    expect(plain(deleteAtSegments({}, ['o', 'k']))).toEqual({});
    expect(plain(deleteAtSegments({ o: 5 }, ['o', 'k']))).toEqual({ o: 5 });
  });

  it('refuses an empty path', () => {
    expect(() => setAtSegments({}, [], 1)).toThrow(/at least one/);
    expect(() => deleteAtSegments({}, [])).toThrow(/at least one/);
  });

  it('reads an array element by its decimal index', () => {
    expect(getAtSegments({ tags: ['a', 'b'] }, ['tags', '0'])).toEqual({ value: 'a' });
    expect(getAtSegments({ tags: ['a', 'b'] }, ['tags', '1'])).toEqual({ value: 'b' });
    expect(getAtSegments({ tags: ['a'] }, ['tags', '1'])).toBeNull(); // out of range
    expect(getAtSegments({ tags: ['a'] }, ['tags', '01'])).toBeNull(); // not a plain decimal index
  });

  it('reads through nested arrays and arrays of objects', () => {
    expect(getAtSegments({ m: [[1, 2], [3]] }, ['m', '0', '1'])).toEqual({ value: 2 });
    expect(getAtSegments({ cast: [{ name: 'x' }] }, ['cast', '0', 'name'])).toEqual({ value: 'x' });
  });

  it('sets an array element by index, without turning the array into an object', () => {
    const doc = { tags: ['a', 'b'] };
    const out = setAtSegments(doc, ['tags', '1'], 'x');
    expect(plain(out)).toEqual({ tags: ['a', 'x'] });
    expect(Array.isArray((out as { tags: unknown }).tags)).toBe(true);
    expect(doc).toEqual({ tags: ['a', 'b'] }); // unmutated
  });

  it('appends when the index is exactly the array length, Add item\'s case', () => {
    const out = setAtSegments({ tags: ['a'] }, ['tags', '1'], 'b');
    expect(plain(out)).toEqual({ tags: ['a', 'b'] });
  });

  it('refuses setting an array index beyond length + 1', () => {
    expect(() => setAtSegments({ tags: ['a'] }, ['tags', '5'], 'x')).toThrow(/out of range/);
  });

  it('sets a field nested inside an array element, creating a missing intermediate object', () => {
    const out = setAtSegments({ cast: [{ name: 'x' }] }, ['cast', '0', 'addr', 'city'], 'A');
    expect(plain(out)).toEqual({ cast: [{ name: 'x', addr: { city: 'A' } }] });
  });

  it('replaces a non-container array element on the way down when setting', () => {
    expect(plain(setAtSegments({ arr: [1] }, ['arr', '0', 'k'], 'v'))).toEqual({ arr: [{ k: 'v' }] });
  });

  it('deletes (splices) an array element, shifting later indices down', () => {
    const doc = { tags: ['a', 'b', 'c'] };
    const out = deleteAtSegments(doc, ['tags', '0']);
    expect(plain(out)).toEqual({ tags: ['b', 'c'] });
    expect(doc).toEqual({ tags: ['a', 'b', 'c'] }); // unmutated
  });

  it('deleting an out-of-range array index is a no-op', () => {
    expect(plain(deleteAtSegments({ tags: ['a'] }, ['tags', '9']))).toEqual({ tags: ['a'] });
  });

  it('deletes a field nested inside an array element, keeping the array', () => {
    const out = deleteAtSegments({ cast: [{ name: 'x', extra: 1 }] }, ['cast', '0', 'extra']);
    expect(plain(out)).toEqual({ cast: [{ name: 'x' }] });
  });

  describe('array index segments', () => {
    const eleven = { arr: Array.from({ length: 11 }, (_, i) => i) };

    it('reads a multi-digit index', () => {
      expect(getAtSegments(eleven, ['arr', '10'])).toEqual({ value: 10 });
    });

    it('never reads a segment with anything around the digits as an index', () => {
      for (const seg of ['a1', '1a', '-1', ' 1', '1.0', '']) {
        expect(getAtSegments({ arr: [0, 1] }, ['arr', seg])).toBeNull();
      }
    });

    it('refuses to write through an intermediate index at or past the length, naming it', () => {
      expect(() => setAtSegments({ arr: [{}] }, ['arr', '1', 'k'], 'v')).toThrow(
        'setAtSegments: array index "1" out of range',
      );
      expect(() => setAtSegments({ arr: [{}] }, ['arr', '5', 'k'], 'v')).toThrow(/"5" out of range/);
    });

    it('refuses to write through, or at, a segment of an array that is not an index', () => {
      expect(() => setAtSegments({ arr: [{}] }, ['arr', 'x', 'k'], 'v')).toThrow(/"x" out of range/);
      expect(() => setAtSegments({ arr: [1] }, ['arr', 'x'], 'v')).toThrow(/"x" out of range/);
    });

    it('writes through a multi-digit intermediate index', () => {
      const out = setAtSegments({ arr: [...eleven.arr.map(() => ({}))] }, ['arr', '10', 'k'], 'v');
      expect(getAtSegments(out, ['arr', '10', 'k'])).toEqual({ value: 'v' });
    });

    it('deletes through an element past the first, and not through a non-index segment', () => {
      const cast = { cast: [{ name: 'a' }, { name: 'b' }] };
      expect(plain(deleteAtSegments(cast, ['cast', '1', 'name']))).toEqual({ cast: [{ name: 'a' }, {}] });
      expect(plain(deleteAtSegments(cast, ['cast', 'x', 'name']))).toEqual(cast);
    });

    it('never splices on a leaf segment that is not an index', () => {
      expect(plain(deleteAtSegments({ tags: ['a', 'b'] }, ['tags', 'x']))).toEqual({ tags: ['a', 'b'] });
    });
  });
});

describe('isUnsafeFieldName', () => {
  it('flags names an update path cannot address', () => {
    expect(isUnsafeFieldName('a.b')).toBe(true);
    expect(isUnsafeFieldName('$a')).toBe(true);
    expect(isUnsafeFieldName('')).toBe(true);
    expect(isUnsafeFieldName('a$')).toBe(false);
    expect(isUnsafeFieldName('plain')).toBe(false);
  });
});

describe('applyDiff', () => {
  it('sets dotted paths, creating missing documents, and unsets', () => {
    const out = applyDiff(
      { a: 1, o: { k: 1, gone: 1 }, s: 'x' },
      { set: { 'o.k': 2, 'n.m.p': 3, s: 'y' }, unset: ['o.gone', 'a', 'missing.deep'] },
    );
    expect(plain(out)).toEqual({ o: { k: 2 }, s: 'y', n: { m: { p: 3 } } });
  });

  it('keeps the siblings of a dotted path it sets', () => {
    expect(plain(applyDiff({ o: { k: 1, j: 'keep' } }, { set: { 'o.k': 'v' }, unset: [] }))).toEqual({
      o: { k: 'v', j: 'keep' },
    });
  });

  it('copies arrays, so the result shares nothing with its input', () => {
    const doc = { tags: [{ x: 1 }] };
    const out = applyDiff(doc, { set: {}, unset: [] });
    (out.tags as Array<{ x: number }>)[0]!.x = 2;
    expect(doc.tags[0]!.x).toBe(1);
  });

  it('replaces a non-document on the way down to a dotted path', () => {
    expect(plain(applyDiff({ o: 5 }, { set: { 'o.k': 'v' }, unset: [] }))).toEqual({ o: { k: 'v' } });
  });

  it('does not mutate its input', () => {
    const doc = { o: { k: 1 }, arr: [{ x: 1 }] };
    applyDiff(doc, { set: { 'o.k': 2 }, unset: ['arr'] });
    expect(doc).toEqual({ o: { k: 1 }, arr: [{ x: 1 }] });
  });

  it('does not share a set value with the diff it came from', () => {
    const value = { inner: 1 };
    const out = applyDiff({}, { set: { o: value }, unset: [] });
    (out.o as { inner: number }).inner = 2;
    expect(value.inner).toBe(1);
  });

  it('writes a __proto__ field as an own property', () => {
    const d = ejsonParse<{ set: Record<string, unknown>; unset: string[] }>('{"set":{"__proto__":{"polluted":true}},"unset":[]}');
    const out = applyDiff({}, d);
    expect(Object.keys(out)).toEqual(['__proto__']);
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
  });
});

describe('buildUpdateRequest', () => {
  const orig = { _id: ID, name: 'a', n: new Int32(1), addr: { city: 'A' } };

  it('returns null — no request — for an unchanged draft', () => {
    expect(buildUpdateRequest(orig, ejsonParse(ejsonStringify(orig)))).toBeNull();
  });

  it('guards each changed path with its loaded value and each added path with $exists: false', () => {
    const req = buildUpdateRequest(orig, { _id: ID, n: new Int32(2), addr: { city: 'B' }, extra: true })!;
    expect(JSON.parse(req.filterJson)).toEqual({
      _id: { $oid: ID.toHexString() },
      n: { $eq: { $numberInt: '1' } },
      'addr.city': { $eq: 'A' },
      extra: { $exists: false },
      name: { $eq: 'a' },
    });
    expect(JSON.parse(req.updateJson)).toEqual({
      $set: { n: { $numberInt: '2' }, 'addr.city': 'B', extra: true },
      $unset: { name: '' },
    });
    expect(JSON.parse(req.idFilterJson)).toEqual({ _id: { $oid: ID.toHexString() } });
  });

  it('omits an empty operator', () => {
    const setOnly = buildUpdateRequest(orig, { ...orig, name: 'b' })!;
    expect(Object.keys(JSON.parse(setOnly.updateJson) as object)).toEqual(['$set']);
    const unsetOnly = buildUpdateRequest(orig, { _id: ID, n: new Int32(1), addr: { city: 'A' } })!;
    expect(Object.keys(JSON.parse(unsetOnly.updateJson) as object)).toEqual(['$unset']);
  });

  it('compares a loaded regex as a value, not as a pattern', () => {
    const req = buildUpdateRequest({ _id: 1, r: new BSONRegExp('a+', 'i') }, { _id: 1, r: 'x' })!;
    expect(JSON.parse(req.filterJson)).toEqual({
      _id: { $numberInt: '1' },
      r: { $eq: { $regularExpression: { pattern: 'a+', options: 'i' } } },
    });
  });

  it('builds guards from the original, never the draft', () => {
    const req = buildUpdateRequest({ _id: 1, a: 'loaded' }, { _id: 1, a: 'typed' })!;
    expect(JSON.parse(req.filterJson)).toEqual({ _id: { $numberInt: '1' }, a: { $eq: 'loaded' } });
  });

  it('refuses a document without an _id rather than filtering on nothing', () => {
    expect(() => buildUpdateRequest({ a: 1 }, { a: 2 })).toThrow(/without an _id/);
  });

  it('refuses a change to an unsafe top-level name, whichever way it changed', () => {
    expect(() => buildUpdateRequest({ _id: 1, 'a.b': 1 }, { _id: 1, 'a.b': 2 })).toThrow(/"a\.b"/);
    expect(() => buildUpdateRequest({ _id: 1 }, { _id: 1, $x: 2 })).toThrow(/"\$x"/);
    expect(() => buildUpdateRequest({ _id: 1, $x: 2 }, { _id: 1 })).toThrow(/"\$x"/);
  });

  it('tells an unsafe name added or removed as null apart from one that is absent', () => {
    expect(() => buildUpdateRequest({ _id: 1 }, { _id: 1, $x: null })).toThrow(/"\$x"/);
    expect(() => buildUpdateRequest({ _id: 1, $x: null }, { _id: 1 })).toThrow(/"\$x"/);
  });

  it('lets an untouched unsafe top-level name ride along', () => {
    const req = buildUpdateRequest({ _id: 1, 'a.b': 1, k: 1 }, { _id: 1, 'a.b': 1, k: 2 })!;
    expect(JSON.parse(req.updateJson)).toEqual({ $set: { k: { $numberInt: '2' } } });
  });
});

describe('parseJsonDraft', () => {
  it('parses Canonical EJSON text into a draft document', () => {
    const res = parseJsonDraft('{"_id":{"$numberInt":"1"},"a":"b"}', new Int32(1));
    expect(res.ok).toBe(true);
    expect(res.ok && plain(res.doc)).toEqual({ _id: 1, a: 'b' });
  });

  it('refuses text that does not parse', () => {
    const res = parseJsonDraft('{ not json', 1);
    expect(res).toEqual({ ok: false, error: 'Invalid EJSON' });
  });

  it('refuses a non-document value', () => {
    expect(parseJsonDraft('[1,2]', 1)).toEqual({ ok: false, error: 'Enter a JSON document' });
    expect(parseJsonDraft('"x"', 1)).toEqual({ ok: false, error: 'Enter a JSON document' });
    expect(parseJsonDraft('null', 1)).toEqual({ ok: false, error: 'Enter a JSON document' });
  });

  it('accepts an unchanged _id', () => {
    const res = parseJsonDraft('{"_id":{"$numberInt":"1"},"a":1}', new Int32(1));
    expect(res.ok).toBe(true);
  });

  it('refuses a changed _id value', () => {
    const res = parseJsonDraft('{"_id":{"$numberInt":"2"}}', new Int32(1));
    expect(res).toEqual({ ok: false, error: 'The _id field cannot be changed here' });
  });

  it('refuses _id removed from the text', () => {
    const res = parseJsonDraft('{"a":1}', new Int32(1));
    expect(res).toEqual({ ok: false, error: 'The _id field cannot be changed here' });
  });

  it('refuses _id added to text that had none', () => {
    const res = parseJsonDraft('{"_id":{"$numberInt":"1"}}', undefined);
    expect(res).toEqual({ ok: false, error: 'The _id field cannot be changed here' });
  });

  it('accepts staying without an _id', () => {
    const res = parseJsonDraft('{"a":1}', undefined);
    expect(res.ok).toBe(true);
  });

  it('tells a null _id apart from a missing one, in both directions', () => {
    const refused = { ok: false, error: 'The _id field cannot be changed here' };
    expect(parseJsonDraft('{"_id":null}', undefined)).toEqual(refused);
    expect(parseJsonDraft('{"a":1}', null)).toEqual(refused);
    expect(parseJsonDraft('{"_id":null}', null).ok).toBe(true);
  });
});

describe('changeList', () => {
  const base = { _id: ID, status: 'pending', gone: true, qty: new Int32(5), o: { a: 1, b: 2 }, arr: [1, 2] };

  it('is empty for an unchanged document', () => {
    expect(changeList(base, ejsonParse(ejsonStringify(base)))).toEqual([]);
  });

  it('lists a changed, an added and a removed field', () => {
    const draft: Record<string, unknown> = { ...base, status: 'shipped', note: 'call back' };
    delete draft.gone;
    expect(changeList(base, draft)).toEqual([
      { path: 'status', kind: 'changed', before: 'pending', after: 'shipped', typeChange: undefined },
      { path: 'note', kind: 'added', after: 'call back' },
      { path: 'gone', kind: 'removed', before: true },
    ]);
  });

  it('names a nested change by its dotted path and an array change as one whole-array entry', () => {
    const list = changeList(base, { ...base, o: { a: 9, b: 2 }, arr: [1, 2, 3] });
    expect(list.map((e) => [e.path, e.kind])).toEqual([
      ['o.a', 'changed'],
      ['arr', 'changed'],
    ]);
    expect(list[1]!.after).toEqual([1, 2, 3]);
  });

  it('has exactly one entry per path of the diff', () => {
    const draft = { ...base, status: 'x', o: { a: 2 }, extra: 1 };
    const d = diff(base, draft);
    expect(changeList(base, draft)).toHaveLength(Object.keys(d.set).length + d.unset.length);
  });

  it('shows both types when the value keeps its text across a type change', () => {
    const [e] = changeList(base, { ...base, qty: new Double(5) });
    expect(e!.typeChange).toEqual({ from: 'Int32', to: 'Double', cleared: false });
  });

  it('marks a type change that fell back to the type zero as cleared', () => {
    const [e] = changeList({ _id: ID, s: 'abc' }, { _id: ID, s: new Int32(0) });
    expect(e!.typeChange).toEqual({ from: 'String', to: 'Int32', cleared: true });
  });

  it('does not call a null becoming a zero value cleared, nor a same-text conversion', () => {
    expect(changeList({ _id: ID, n: null }, { _id: ID, n: new Int32(0) })[0]!.typeChange!.cleared).toBe(false);
    expect(changeList({ _id: ID, s: '0' }, { _id: ID, s: new Int32(0) })[0]!.typeChange!.cleared).toBe(false);
  });

  it('reports no type change when the type stays', () => {
    expect(changeList(base, { ...base, qty: new Int32(6) })[0]!.typeChange).toBeUndefined();
  });
});

describe('classifyConflict', () => {
  const original = { _id: ID, status: 'pending', qty: 5, note: 'a', o: { x: 1, y: 1 } };
  const rowsOf = (draft: Record<string, unknown>, server: Record<string, unknown>) =>
    classifyConflict(original, draft, server).map((r) => [r.path, r.changedBy]);

  it('calls a path both sides changed to different values "both"', () => {
    const rows = classifyConflict(original, { ...original, status: 'shipped' }, { ...original, status: 'cancelled' });
    expect(rows).toEqual([
      { path: 'status', yours: { value: 'shipped' }, theirs: { value: 'cancelled' }, changedBy: 'both' },
    ]);
  });

  it('calls a path only the user changed "yours" and one only the server changed "theirs"', () => {
    expect(rowsOf({ ...original, qty: 7 }, { ...original, note: 'b' })).toEqual([
      ['qty', 'yours'],
      ['note', 'theirs'],
    ]);
  });

  it('shows a field the user removed as absent on their side', () => {
    const draft: Record<string, unknown> = { ...original };
    delete draft.note;
    const [row] = classifyConflict(original, draft, { ...original, note: 'b' });
    expect(row).toMatchObject({ path: 'note', yours: null, theirs: { value: 'b' }, changedBy: 'both' });
  });

  it('needs no choice when both sides arrived at the same value', () => {
    expect(rowsOf({ ...original, qty: 7 }, { ...original, qty: 7 })).toEqual([['qty', 'yours']]);
  });

  it('counts a user path under a server path (and the reverse) as a clash', () => {
    expect(rowsOf({ ...original, o: { x: 2, y: 1 } }, { ...original, o: 'flat' })).toEqual([['o.x', 'both']]);
    expect(rowsOf({ ...original, o: 'flat' }, { ...original, o: { x: 2, y: 1 } })).toEqual([['o', 'both']]);
  });

  it('does not clash on sibling paths or on a shared name prefix', () => {
    expect(rowsOf({ ...original, o: { x: 2, y: 1 } }, { ...original, o: { x: 1, y: 2 } })).toEqual([
      ['o.x', 'yours'],
      ['o.y', 'theirs'],
    ]);
    expect(rowsOf({ ...original, no: 1 }, { ...original, n: 1 })).toEqual([
      ['no', 'yours'],
      ['n', 'theirs'],
    ]);
  });

  it('lists a server-only path once even when the user changed several others', () => {
    expect(rowsOf({ ...original, qty: 7, status: 'x' }, { ...original, note: 'b' })).toEqual([
      ['status', 'yours'],
      ['qty', 'yours'],
      ['note', 'theirs'],
    ]);
  });

  it('is empty when nobody changed anything', () => {
    expect(rowsOf(original, original)).toEqual([]);
  });
});

describe('resolveConflict', () => {
  const original = { _id: ID, status: 'pending', qty: 5, note: 'a' };
  const draft = { ...original, status: 'shipped', qty: 7 };
  const server = { ...original, status: 'cancelled', note: 'b' };
  const pick = (status?: 'mine' | 'theirs') =>
    plain(resolveConflict(original, draft, server, new Map(status ? [['status', status]] : [])));

  it('Keep mine puts the user\'s value over the server\'s and keeps what only the server changed', () => {
    expect(pick('mine')).toEqual({ _id: { $oid: ID.toHexString() }, status: 'shipped', qty: 7, note: 'b' });
  });

  it('Take theirs leaves the server\'s value, so nothing is written for that path', () => {
    const merged = resolveConflict(original, draft, server, new Map([['status', 'theirs']]));
    expect(plain(merged)).toMatchObject({ status: 'cancelled', qty: 7, note: 'b' });
    expect(Object.keys(diff(server, merged).set)).toEqual(['qty']);
  });

  it('applies a "yours" path whatever the choices say', () => {
    expect(pick('theirs')).toMatchObject({ qty: 7 });
    const merged = resolveConflict(original, draft, server, new Map([['qty', 'theirs']]));
    expect(plain(merged)).toMatchObject({ qty: 7 });
  });

  it('keeps a user removal unless the server\'s value was taken', () => {
    const removed: Record<string, unknown> = { ...original };
    delete removed.note;
    const bumped = { ...original, note: 'b' };
    const mine = resolveConflict(original, removed, bumped, new Map([['note', 'mine']]));
    const theirs = resolveConflict(original, removed, bumped, new Map([['note', 'theirs']]));
    expect('note' in mine).toBe(false);
    expect(theirs.note).toBe('b');
  });
});

describe('change strip text (W18 §13.2)', () => {
  const entries = (a: Record<string, unknown>, b: Record<string, unknown>) => changeList({ _id: ID, ...a }, { _id: ID, ...b });

  it('reads a changed, an added and a removed value', () => {
    const [changed, added, removed] = entries({ s: 'pending', gone: 1 }, { s: 'shipped', note: 'call back' }).concat(
      entries({ gone: 1 }, {}),
    );
    expect(changeText(changed!).text).toBe('s: "pending" → "shipped"');
    expect(changeText(added!).text).toBe('note: + "call back"');
    expect(changeText(removed!).text).toBe('gone: removed');
  });

  it('shows both types for a type change, and says when the value was cleared', () => {
    const [kept] = entries({ qty: new Int32(5) }, { qty: new Double(5) });
    expect(changeText(kept!).text).toBe('qty: 5 Int32 → 5 Double');
    const [cleared] = entries({ qty: 'abc' }, { qty: new Int32(0) });
    expect(changeText(cleared!).text).toBe('qty: "abc" String → 0 Int32 · value cleared');
  });

  it('cuts a long value in the line and keeps all of it in the title', () => {
    const long = 'x'.repeat(100);
    const [e] = entries({ a: 'y' }, { a: long });
    const { text, title } = changeText(e!);
    expect(text.length).toBeLessThan(title.length);
    expect(text).toContain('…');
    expect(title).toContain(long);
    expect(title).not.toContain('…');
  });

  it('oneLineValue cuts at max, not before it', () => {
    expect(oneLineValue('abcd', 6)).toBe('"abcd"');
    expect(oneLineValue('abcde', 6)).toBe('"abcd…');
    expect(oneLineValue({ a: [1, 2] })).toBe('{"a":[1,2]}');
  });

  it('oneLineValue reads a number, date or ObjectId as the text its field shows, with no sentinel wrapper', () => {
    expect(oneLineValue(new Double(1))).toBe('1');
    expect(oneLineValue(Long.fromString('9007199254740993'))).toBe('9007199254740993');
    expect(oneLineValue(Decimal128.fromString('1.10'))).toBe('1.10');
    expect(oneLineValue(new Date(0))).toBe('1970-01-01T00:00:00Z');
    expect(oneLineValue(ID)).toBe('507f1f77bcf86cd799439011');
  });

  it('typeChangeText with the cleared flag only appends the note when set', () => {
    const tc = { from: 'Int32', to: 'Double', cleared: false };
    expect(typeChangeText(new Int32(1), new Double(1), tc)).toBe('1 Int32 → 1 Double');
    expect(typeChangeText(new Int32(1), new Double(0), { ...tc, cleared: true })).toBe('1 Int32 → 0 Double · value cleared');
  });

  it('typeChangeOf is undefined when the kind is unchanged', () => {
    expect(typeChangeOf('a', 'b')).toBeUndefined();
    expect(typeChangeOf(new Int32(1), new Int32(2))).toBeUndefined();
  });

  it('names only the operators that carry something', () => {
    const [a, b] = entries({ x: 1, y: 2 }, { x: 2, y: 3 });
    const [c] = entries({ z: 1 }, {});
    expect(operatorSummary([a!, b!])).toBe('$set 2');
    expect(operatorSummary([c!])).toBe('$unset 1');
    expect(operatorSummary([a!, b!, c!])).toBe('$set 2 · $unset 1');
    expect(operatorSummary([])).toBe('');
  });
});
