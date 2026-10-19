import { describe, it, expect } from 'vitest';
import { Long, ObjectId } from 'bson';
import {
  MAX_REPORTED_ERRORS,
  emptyReport,
  extensionFormat,
  parseJsonArray,
  parseJsonlLine,
  recordFailure,
  sniffFormat,
} from '../../electron/mongo/importParse';
import { ejsonStringify } from '../../electron/mongo/ejson';

describe('extensionFormat', () => {
  it('settles .jsonl and .ndjson, leaves .json to sniffing, refuses the rest', () => {
    expect(extensionFormat('/d/a.jsonl')).toBe('jsonl');
    expect(extensionFormat('/d/a.NDJSON')).toBe('jsonl');
    expect(extensionFormat('/d/a.Json')).toBe('sniff');
    expect(extensionFormat('/d/a.CSV')).toBe('csv');
    expect(extensionFormat('/d/a.tsv')).toBeUndefined();
    expect(extensionFormat('/d/json')).toBeUndefined();
    expect(extensionFormat('/d/a.constructor')).toBeUndefined();
  });
});

describe('sniffFormat', () => {
  it('reads the first significant character, stepping over whitespace and a BOM', () => {
    expect(sniffFormat('﻿ \n\t[')).toBe('json');
    expect(sniffFormat('  {"a":1}')).toBe('jsonl');
    expect(sniffFormat('x[')).toBe('jsonl');
    expect(sniffFormat(' \n ')).toBeUndefined();
    expect(sniffFormat('')).toBeUndefined();
  });
});

describe('parseJsonlLine', () => {
  it('parses a document, reviving EJSON', () => {
    const oid = new ObjectId();
    const rec = parseJsonlLine(`{"_id":{"$oid":"${oid.toHexString()}"}}`, 4);
    expect(rec).toEqual({ at: 4, doc: { _id: oid } });
  });

  it('skips a blank or whitespace-only line', () => {
    expect(parseJsonlLine('', 2)).toBeNull();
    expect(parseJsonlLine(' \t ', 2)).toBeNull();
  });

  it('strips a BOM from the first line only', () => {
    expect(parseJsonlLine('﻿{"a":1}', 1)).toEqual({ at: 1, doc: { a: 1 } });
    expect(parseJsonlLine('﻿', 1)).toBeNull();
    expect(parseJsonlLine('﻿{"a":1}', 2)).toMatchObject({ at: 2, error: expect.stringMatching(/^invalid document: /) });
  });

  it('reports malformed JSON and a non-document by line', () => {
    expect(parseJsonlLine('{"a":', 3)).toEqual({ at: 3, error: expect.stringMatching(/^invalid document: /) });
    expect(parseJsonlLine('[1]', 5)).toEqual({ at: 5, error: 'invalid document: expected a document like { field: 1 }' });
  });
});

describe('parseJsonArray', () => {
  it('reports each element by index, each revived on its own', () => {
    expect(parseJsonArray('﻿[{"a":1}, 2, {"d":{"$date":"nope"}}, {"b":{"$numberLong":"5"}}]')).toEqual([
      { at: 0, doc: { a: 1 } },
      { at: 1, error: 'invalid document: expected a document like { field: 1 }' },
      { at: 2, error: expect.stringMatching(/invalid \$date/) },
      { at: 3, doc: { b: expect.anything() } },
    ]);
    expect(parseJsonArray('[]')).toEqual([]);
  });

  // The whole file is parsed before any document is revived, so a plain
  // JSON.parse would round a bare integer past 2^53 first. A JSONL line never
  // had that problem; the two formats must agree.
  it('keeps a bare integer past 2^53 exact as a Long, at any depth and in either sign', () => {
    const [rec] = parseJsonArray(
      '[{"a":9007199254740993,"b":-9007199254740993,"max":9223372036854775807,"min":-9223372036854775808,"n":{"xs":[1,9007199254740993]}}]',
    );
    const doc = (rec as unknown as { doc: { a: Long; b: Long; max: Long; min: Long; n: { xs: [number, Long] } } }).doc;
    for (const [got, digits] of [
      [doc.a, '9007199254740993'],
      [doc.b, '-9007199254740993'],
      [doc.max, '9223372036854775807'],
      [doc.min, '-9223372036854775808'],
      [doc.n.xs[1], '9007199254740993'],
    ] as const) {
      expect(got).toBeInstanceOf(Long);
      expect((got as Long).toString()).toBe(digits);
    }
    expect(doc.n.xs[0]).toBe(1);
  });

  it('leaves safe integers, doubles spelled as doubles and integers beyond int64 as JS numbers', () => {
    // 1.5e18 is a double by its spelling; it must not turn into a Long just
    // because its digits fit int64 once written out.
    const text = '{"safe":1234567890123456,"exp":1.5e18,"frac":12345678901234567890.0,"wide":123456789012345678901,"small":7}';
    const [rec] = parseJsonArray(`[${text}]`);
    const doc = (rec as { doc: Record<string, unknown> }).doc;
    // What plain JSON.parse gives for the same text: all five stay plain numbers.
    expect(doc).toEqual(JSON.parse(text));
    for (const v of Object.values(doc)) expect(typeof v).toBe('number');
  });

  it('gives the same document as the same text on one JSONL line', () => {
    for (const text of [
      '{"a":9007199254740993,"b":[-9223372036854775808,1.5e18],"c":"9007199254740993"}',
      '{"a":{"$numberLong":"9007199254740993"},"b":{"$date":"2024-01-02T03:04:05Z"}}',
      '{"a":1234567890123456,"b":123456789012345678901}',
    ]) {
      const fromArray = parseJsonArray(`[${text}]`)[0] as { doc: unknown };
      const fromLine = parseJsonlLine(text, 1) as { doc: unknown };
      expect(ejsonStringify(fromArray.doc)).toBe(ejsonStringify(fromLine.doc));
    }
  });

  // Both formats hand the parsed value straight to the reviver, with no
  // JSON.stringify in between (which would write -0 as 0 and Infinity as null),
  // so a JSON array and a JSONL line agree on the numbers JSON.parse produces.
  it.each([
    ['a JSON array', (text: string) => (parseJsonArray(`[${text}]`)[0] as { doc: Record<string, unknown> }).doc],
    ['a JSONL line', (text: string) => (parseJsonlLine(text, 1) as { doc: Record<string, unknown> }).doc],
  ])('keeps -0 as -0 and an overflowing exponent as Infinity in %s', (_name, parse) => {
    const doc = parse('{"zero":-0,"up":1e400,"down":-1e400}');
    expect(Object.is(doc.zero, -0)).toBe(true);
    expect(doc.up).toBe(Infinity);
    expect(doc.down).toBe(-Infinity);
  });

  it('still reports a bad element by index when its neighbours hold big integers', () => {
    expect(parseJsonArray('[{"a":9007199254740993}, 5, {"b":9007199254740993}]')).toEqual([
      { at: 0, doc: { a: expect.any(Long) } },
      { at: 1, error: 'invalid document: expected a document like { field: 1 }' },
      { at: 2, doc: { b: expect.any(Long) } },
    ]);
  });

  it('refuses invalid JSON and a top level that is not an array', () => {
    expect(() => parseJsonArray('[{"a":1},')).toThrow(/^invalid JSON array: /);
    expect(() => parseJsonArray('{"a":1}')).toThrow('expected a JSON array of documents');
  });
});

describe('recordFailure', () => {
  it('lists the first failures and only counts the rest', () => {
    const report = emptyReport('f.json', 'json');
    expect(report).toEqual({ fileName: 'f.json', format: 'json', inserted: 0, failed: 0, errors: [], errorsTruncated: false, cancelled: false });
    for (let i = 0; i < MAX_REPORTED_ERRORS; i++) recordFailure(report, i, `e${i}`);
    expect(report.errors).toHaveLength(50);
    expect(report.errors[49]).toEqual({ at: 49, message: 'e49' });
    expect(report.errorsTruncated).toBe(false);
    recordFailure(report, 50, 'e50');
    expect(report.failed).toBe(51);
    expect(report.errors).toHaveLength(50);
    expect(report.errorsTruncated).toBe(true);
  });
});
