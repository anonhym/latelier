import { describe, it, expect } from 'vitest';
import {
  containsDistinctive,
  matchesDistinctive,
  distinctiveValues,
  MAX_DISTINCTIVE_VALUES,
  MAX_SCAN_CHARS,
} from '../../src/utils/distinctiveValues';

const ID = '507f1f77bcf86cd799439011';
const UUID = '123e4567-e89b-12d3-a456-426614174000';

describe('distinctiveValues: ids', () => {
  it('finds an ObjectId in each spelling', () => {
    expect(distinctiveValues(ID)).toEqual([ID]);
    expect(distinctiveValues(`ObjectId("${ID}")`)).toEqual([ID]);
    expect(distinctiveValues(`{"$oid": "${ID}"}`)).toEqual([ID]);
    expect(distinctiveValues(`{ _id: ObjectId('${ID}') }`)).toEqual([ID]);
  });

  it('lower-cases a hex id so spellings of one id agree', () => {
    expect(distinctiveValues(ID.toUpperCase())).toEqual([ID]);
  });

  it('keeps the case of a string that only holds or ends in an id', () => {
    expect(distinctiveValues(`{ ref: "Order ${ID.toUpperCase()}" }`)).toContain(`Order ${ID.toUpperCase()}`);
    expect(distinctiveValues(`{ ref: "${ID.toUpperCase()} Order" }`)).toContain(`${ID.toUpperCase()} Order`);
  });

  it('does not take 24 hex characters out of a longer hex run', () => {
    expect(distinctiveValues(`${ID}ab`.replace(/^/, 'f'))).not.toContain(ID);
    expect(distinctiveValues(`0${ID}`)).not.toContain(ID);
    expect(distinctiveValues(`${ID}0`)).not.toContain(ID);
  });

  it('finds a canonical UUID, in either case', () => {
    expect(distinctiveValues(UUID)).toEqual([UUID]);
    expect(distinctiveValues(`UUID("${UUID.toUpperCase()}")`)).toEqual([UUID]);
  });

  it('does not read the last group of a UUID as a number', () => {
    expect(distinctiveValues(`{ id: "${UUID}" }`)).toEqual([UUID]);
  });

  it('does not take a UUID out of a longer hex run', () => {
    expect(distinctiveValues(`a${UUID}`)).not.toContain(UUID);
    expect(distinctiveValues(`${UUID}a`)).not.toContain(UUID);
  });
});

describe('distinctiveValues: strings', () => {
  it('keeps a quoted string of 6 characters and drops one of 5', () => {
    expect(distinctiveValues('{ "name": "abcdef" }')).toEqual(['abcdef']);
    expect(distinctiveValues('{ "name": "abcde" }')).toEqual([]);
  });

  it('reads single-quoted literals too', () => {
    expect(distinctiveValues("{ name: 'Alice Wonderland' }")).toEqual(['Alice Wonderland']);
  });

  it('leaves out object keys: a field name says nothing about the server it was copied on', () => {
    expect(distinctiveValues('{ "customer_id": 1, "customer_name" : "Alice Wonderland" }')).toEqual(['Alice Wonderland']);
    expect(distinctiveValues("{ 'customer_id':\t'abcdefgh' }")).toEqual(['abcdefgh']);
  });

  it('leaves out a key with a tab before its colon', () => {
    expect(distinctiveValues('{ "customer_id"\t: "abcdefgh" }')).toEqual(['abcdefgh']);
  });

  it('skips an escaped quote inside a literal', () => {
    expect(distinctiveValues('{ "q": "say \\"hello\\" now" }')).toEqual(['say \\"hello\\" now']);
  });

  it('carries on after an unterminated quote', () => {
    expect(distinctiveValues('"never closed\n"closed-string"')).toEqual(['closed-string']);
  });

  it('keeps a bare string, as the Value copy writes one, at 6 characters and not at 5', () => {
    expect(distinctiveValues('abcdef')).toEqual(['abcdef']);
    expect(distinctiveValues('abcde')).toEqual([]);
    expect(distinctiveValues('  Alice Wonderland  ')).toEqual(['Alice Wonderland']);
  });

  it('keeps a bare string that holds a quote, a call or digits', () => {
    expect(distinctiveValues("O'Brien Smith")).toEqual(["O'Brien Smith"]);
    expect(distinctiveValues('foo bar(baz)')).toEqual(['foo bar(baz)']);
    expect(distinctiveValues('abcdef1234')).toEqual(['abcdef1234']);
    expect(distinctiveValues('123456abc')).toEqual(['123456abc']);
  });

  it('does not take a call such as ObjectId(…) as one bare string', () => {
    expect(distinctiveValues('ObjectId(abc)')).toEqual([]);
    expect(distinctiveValues('ISODate(x)')).toEqual([]);
  });

  it('takes no bare string from text that already held an id', () => {
    expect(distinctiveValues(`see ${ID} please`)).toEqual([ID]);
  });

  it('does not take a document, an array or a multi-line text as one bare string', () => {
    expect(distinctiveValues('{ a: 1 }')).toEqual([]);
    expect(distinctiveValues('[1, 2, 3]')).toEqual([]);
    expect(distinctiveValues('line one\nline two')).toEqual([]);
  });
});

describe('distinctiveValues: numbers', () => {
  it('counts zeros and nines as digits', () => {
    expect(distinctiveValues('{ n: 100000 }')).toEqual(['100000']);
    expect(distinctiveValues('{ n: 99999 }')).toEqual([]);
    expect(distinctiveValues('{ n: 999999 }')).toEqual(['999999']);
    expect(distinctiveValues('{ n: 1.0000 }')).toEqual([]);
  });

  it('keeps an integer of 6 digits and drops one of 5', () => {
    expect(distinctiveValues('{ n: 123456 }')).toEqual(['123456']);
    expect(distinctiveValues('{ n: 12345 }')).toEqual([]);
  });

  it('counts the digits of a decimal and of a negative number', () => {
    expect(distinctiveValues('{ n: 12.3456 }')).toEqual(['12.3456']);
    expect(distinctiveValues('{ n: 1.2345 }')).toEqual([]);
    expect(distinctiveValues('{ n: -123456 }')).toEqual(['-123456']);
    expect(distinctiveValues('{ n: -12345 }')).toEqual([]);
  });

  it('does not take digits out of a word or a longer token', () => {
    expect(distinctiveValues('{ n: abc123456 }')).toEqual([]);
    expect(distinctiveValues('{ n: 123456abc }')).toEqual([]);
  });

  it('keeps the number in an identifier after a separator', () => {
    expect(distinctiveValues('{ "sku": "ORD-123456" }')).toEqual(['ORD-123456', '123456']);
  });

  it('is not a bare string when the whole text is a number, long or short', () => {
    expect(distinctiveValues('123456')).toEqual(['123456']);
    expect(distinctiveValues('-12345')).toEqual([]);
    expect(distinctiveValues('1.2345')).toEqual([]);
  });
});

describe('distinctiveValues: never distinctive', () => {
  it.each(['true', 'false', 'null', 'undefined', '3', '"x"', '{ ok: true, n: null, k: 3 }', ''])(
    '%j',
    (text) => {
      expect(distinctiveValues(text)).toEqual([]);
    },
  );

  it('does not take an id out of a literal word', () => {
    expect(distinctiveValues('  false  ')).toEqual([]);
  });
});

describe('distinctiveValues: dedupe and order', () => {
  it('lists each value once, in the order it first appears', () => {
    expect(distinctiveValues(`"zzzzzz" ${ID} "zzzzzz" "aaaaaa"`)).toEqual([ID, 'zzzzzz', 'aaaaaa']);
  });
});

describe('distinctiveValues: caps', () => {
  it('keeps at most the first 1,000 values', () => {
    const many = Array.from({ length: MAX_DISTINCTIVE_VALUES + 50 }, (_, i) => `"value-${String(i).padStart(5, '0')}"`).join(',');
    const found = distinctiveValues(many);
    expect(found).toHaveLength(MAX_DISTINCTIVE_VALUES);
    expect(found[0]).toBe('value-00000');
    expect(found[MAX_DISTINCTIVE_VALUES - 1]).toBe(`value-${String(MAX_DISTINCTIVE_VALUES - 1).padStart(5, '0')}`);
  });

  it('scans at most 256 KB', () => {
    const filler = ' '.repeat(MAX_SCAN_CHARS);
    expect(distinctiveValues(`${filler}"beyond-the-cap"`)).toEqual([]);
    expect(distinctiveValues(`${' '.repeat(MAX_SCAN_CHARS - 20)}"inside-the-cap"`)).toEqual(['inside-the-cap']);
  });

  it('stays fast on a long run of quotes and backslashes', () => {
    const hostile = '"\\'.repeat(100_000);
    const started = performance.now();
    distinctiveValues(hostile);
    expect(performance.now() - started).toBeLessThan(2000);
  });
});

describe('containsDistinctive', () => {
  it('matches a hex id and a UUID without regard to case', () => {
    expect(containsDistinctive(`{ _id: ObjectId("${ID.toUpperCase()}") }`, ID)).toBe(true);
    expect(containsDistinctive(UUID.toUpperCase(), UUID)).toBe(true);
  });

  it('matches any other value exactly', () => {
    expect(containsDistinctive('{ name: "Alice Wonderland" }', 'Alice Wonderland')).toBe(true);
    expect(containsDistinctive('{ name: "alice wonderland" }', 'Alice Wonderland')).toBe(false);
  });
});

describe('matchesDistinctive', () => {
  it('compares a hex id or UUID without regard to case', () => {
    expect(matchesDistinctive(ID.toUpperCase(), ID)).toBe(true);
    const uuid = '00112233-4455-6677-8899-aabbccddeeff';
    expect(matchesDistinctive(uuid.toUpperCase(), uuid)).toBe(true);
  });

  it('compares anything else exactly', () => {
    expect(matchesDistinctive('Alice-0001', 'Alice-0001')).toBe(true);
    expect(matchesDistinctive('ALICE-0001', 'Alice-0001')).toBe(false);
    expect(matchesDistinctive('alice-0001', 'alice-0001 ')).toBe(false);
    expect(matchesDistinctive('x alice-0001', 'alice-0001')).toBe(false);
  });

  it('does not match a hex id that only contains the value', () => {
    expect(matchesDistinctive(`x${ID}`, ID)).toBe(false);
  });
});
