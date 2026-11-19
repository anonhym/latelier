import { describe, expect, it } from 'vitest';
import { detectValueSlot } from '../../src/features/fieldSuggestions/aggGrammar';
import { fieldSlot, isPlainKey, lookupFrom } from '../../src/features/fieldSuggestions/stageFieldPositions';

/** Parse a fixture where `|` marks the caret. */
function slotAt(s: string) {
  const caret = s.indexOf('|');
  if (caret === -1) throw new Error('fixture missing caret marker');
  return detectValueSlot(s.slice(0, caret) + s.slice(caret + 1), caret);
}

describe('detectValueSlot', () => {
  it.each([
    ['{ _id: "$|" }', { path: ['_id'], token: '$', quoted: true, replaceStart: 8, replaceEnd: 9 }],
    ['{ _id: "|" }', { path: ['_id'], token: '', quoted: true, replaceStart: 8, replaceEnd: 8 }],
    ['{ _id: |', { path: ['_id'], token: '', quoted: false, replaceStart: 7, replaceEnd: 7 }],
    ['{ _id: $to|', { path: ['_id'], token: '$to', quoted: false, replaceStart: 7, replaceEnd: 10 }],
    ['{ t: { $sum: "$a|" } }', { path: ['t', '$sum'], token: '$a', quoted: true, replaceStart: 14, replaceEnd: 16 }],
    ['{ $concat: ["|"] }', { path: ['$concat', '[]'], token: '', quoted: true, replaceStart: 13, replaceEnd: 13 }],
    ['["a", "|"]', { path: ['[]'], token: '', quoted: true, replaceStart: 7, replaceEnd: 7 }],
    ['"$un|"', { path: [], token: '$un', quoted: true, replaceStart: 1, replaceEnd: 4 }],
    ['{ localField: "na|" }', { path: ['localField'], token: 'na', quoted: true, replaceStart: 15, replaceEnd: 17 }],
  ])('%s', (fixture, expected) => {
    expect(slotAt(fixture)).toEqual(expected);
  });

  it.each([
    ['a key being typed, quoted', '{ "na|" }'],
    ['a key being typed, bare', '{ na| }'],
    ['an empty key position', '{ | }'],
    ['after a key, before its colon', '{ "a"| }'],
    ['after a comma, where a key goes', '{ a: 1, | }'],
    ['outside any object', '|'],
  ])('is no slot: %s', (_name, fixture) => {
    expect(slotAt(fixture)).toBeNull();
  });
});

describe('fieldSlot', () => {
  const D = { form: 'dollar', fields: 'input' };
  const B = { form: 'bare', fields: 'input' };
  const BF = { form: 'bare', fields: 'from' };
  it.each([
    ['$group', ['_id'], D],
    ['$group', ['_id', 'a'], D],
    ['$group', ['total', '$sum'], D],
    ['$group', ['total', '$push', '[]'], D],
    ['$group', ['total'], null],
    ['$project', ['a'], D],
    ['$project', ['a', '$concat', '[]'], D],
    ['$project', [], null],
    ['$addFields', ['a'], D],
    ['$set', ['a'], D],
    ['$unwind', [], D],
    ['$unwind', ['path'], D],
    ['$unwind', ['preserveNullAndEmptyArrays'], null],
    ['$sortByCount', [], D],
    ['$replaceWith', ['a'], D],
    ['$redact', ['$cond', '[]'], D],
    ['$replaceRoot', ['newRoot'], D],
    ['$replaceRoot', ['other'], null],
    ['$bucket', ['groupBy'], D],
    ['$bucketAuto', ['groupBy'], D],
    ['$bucket', ['output', 'n', '$sum'], D],
    ['$bucket', ['output', 'n'], null],
    ['$bucket', ['boundaries', '[]'], null],
    ['$setWindowFields', ['partitionBy'], D],
    ['$setWindowFields', ['output', 'n', '$sum'], D],
    ['$lookup', ['localField'], B],
    ['$lookup', ['foreignField'], BF],
    ['$lookup', ['let', 'v'], D],
    ['$lookup', ['let'], null],
    ['$lookup', ['from'], null],
    ['$lookup', ['as'], null],
    ['$graphLookup', ['startWith'], D],
    ['$graphLookup', ['connectFromField'], BF],
    ['$graphLookup', ['connectToField'], BF],
    ['$graphLookup', ['as'], null],
    ['$unset', [], B],
    ['$unset', ['[]'], B],
    ['$unset', ['a'], null],
    ['$match', ['a'], null],
    ['$match', ['$expr', '$eq', '[]'], D],
    ['$sort', ['a'], null],
    ['$limit', [], null],
    ['$facet', ['a', '[]'], null],
  ])('%s %j', (op, path, expected) => {
    expect(fieldSlot(op, path)).toEqual(expected);
  });

  it('takes nothing without a stage', () => {
    expect(fieldSlot(undefined, ['_id'])).toBeNull();
  });
});

describe('lookupFrom', () => {
  it.each([
    ['{ from: "customers", as: "c" }', 'customers'],
    ["{ from: 'customers' }", 'customers'],
    ['{ "from": "customers" }', 'customers'],
    ['{ localField: "a",\n  from : "x y" }', 'x y'],
    ['{ from: "" }', null],
    ['{ from: { db: "d", coll: "c" } }', null],
    ['{ foreign_from: "a" }', null],
    ['{ as: "from" }', null],
    ['{ }', null],
  ])('%s', (body, expected) => {
    expect(lookupFrom(body)).toBe(expected);
  });
});

describe('isPlainKey', () => {
  it.each([
    ['name', true],
    ['_id', true],
    ['$sum', true],
    ['a1', true],
    ['address.city', false],
    ['first name', false],
    ['1a', false],
    ['', false],
  ])('%s', (key, expected) => {
    expect(isPlainKey(key)).toBe(expected);
  });
});
