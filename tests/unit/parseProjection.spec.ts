import { describe, it, expect } from 'vitest';
import {
  parseProjection,
  formatProjection,
  isRawProjection,
} from '../../src/pages/Workspace/projection';
import { compileFindOptions, projectionProblem } from '../../src/pages/Workspace/builder';
import type { BuilderState } from '@shared/types';

// `parseProjection` returns a discriminated result rather than a bare null
// (W14 §3): the QueryBar has to tell the user which of the two failure
// causes it hit, because they call for different actions.
const fieldsOf = (text: string) => {
  const r = parseProjection(text);
  return r.ok ? r.fields : null;
};
const reasonOf = (text: string) => {
  const r = parseProjection(text);
  return r.ok ? null : r.reason;
};

describe('parseProjection', () => {
  it('returns [] on empty input (cleared projection)', () => {
    expect(fieldsOf('')).toEqual([]);
    expect(fieldsOf('   ')).toEqual([]);
    expect(fieldsOf('{}')).toEqual([]);
  });

  it('accepts strict JSON inclusion projection', () => {
    expect(fieldsOf('{"a":1,"b":1}')).toEqual(['a', 'b']);
    expect(fieldsOf('{"a":true,"b":1}')).toEqual(['a', 'b']);
  });

  it('accepts mongo-shell-style unquoted keys', () => {
    expect(fieldsOf('{a: 1, b: 1}')).toEqual(['a', 'b']);
    expect(fieldsOf('{ date: 1, account: 1, amount: 1 }')).toEqual([
      'date',
      'account',
      'amount',
    ]);
  });

  it('accepts bare comma list (no colons)', () => {
    expect(fieldsOf('a, b, c')).toEqual(['a', 'b', 'c']);
  });

  it('reports "unmodelable" on explicit non-inclusion via strict JSON', () => {
    // BuilderState.projection only models inclusions; surfacing the failure
    // lets the caller keep the user's draft text instead of silently dropping
    // the exclusion or $slice, and point at raw MQL rather than at a typo.
    expect(reasonOf('{"a":0}')).toBe('unmodelable');
    expect(reasonOf('{"a":1,"b":0}')).toBe('unmodelable');
    expect(reasonOf('{"a":false}')).toBe('unmodelable');
    expect(reasonOf('{"a":{"$slice":5}}')).toBe('unmodelable');
  });

  it('reports "unmodelable" on explicit non-inclusion via lenient path', () => {
    expect(reasonOf('{a: 0}')).toBe('unmodelable');
    expect(reasonOf('{a: 1, b: 0}')).toBe('unmodelable');
    expect(reasonOf('a: 0, b: 1')).toBe('unmodelable');
    expect(reasonOf('{a: {$slice: 5}}')).toBe('unmodelable');
  });

  it('reports "malformed" on text that is no projection at all', () => {
    // A colon with nothing after it is half-typed, not an exclusion.
    expect(reasonOf('{a: }')).toBe('malformed');
    expect(reasonOf('a: 1, b:')).toBe('malformed');
    // Nothing survives the split — no field names by any reading.
    expect(reasonOf(',,,')).toBe('malformed');
  });
});

describe('formatProjection', () => {
  it('formats nothing for an empty list', () => {
    expect(formatProjection([])).toBe('');
  });

  it('formats inclusion shorthand for non-empty lists', () => {
    expect(formatProjection(['a', 'b'])).toBe('{ a: 1, b: 1 }');
  });

  it('round-trips with parseProjection', () => {
    const fields = ['date', 'account', 'amount'];
    const text = formatProjection(fields);
    expect(fieldsOf(text)).toEqual(fields);
  });

  // W15 §12.3 — every form `parseProjection` accepts must survive the
  // trip out through `formatProjection` and back in. The interesting half is
  // that the *forms* converge while the fields don't change: whichever way a
  // user writes an inclusion list, what gets stored and re-displayed is the
  // one canonical rendering, and re-parsing that rendering is a fixed point.
  it.each([
    ['strict JSON', '{"a":1,"b":1}'],
    ['strict JSON with booleans', '{"a":true,"b":1}'],
    ['shell-style unquoted keys', '{a: 1, b: 1}'],
    ['bare comma list', 'a, b'],
    ['dotted paths', '{ "user.name": 1, "user.address.city": 1 }'],
    ['single field', 'name'],
    ['empty', ''],
  ])('round-trips %s through formatProjection', (_label, text) => {
    const first = parseProjection(text);
    expect(first.ok).toBe(true);
    const fields = first.ok ? first.fields : [];
    const formatted = formatProjection(fields);
    const second = parseProjection(formatted);
    expect(second.ok).toBe(true);
    expect(second.ok && second.fields).toEqual(fields);
    // Fixed point: formatting the re-parsed fields changes nothing.
    expect(formatProjection(second.ok ? second.fields : [])).toBe(formatted);
  });
});

// ─── W15 §2.2 — the `_id`-exclusion path ─────────────────────────────

const builder = (over: Partial<BuilderState> = {}): BuilderState => ({
  projection: [],
  sort: '',
  limit: '',
  ...over,
});

describe('isRawProjection — the escape hatch that makes {_id: 0} reachable', () => {
  it('accepts the exclusions and $slice the inclusion model refuses', () => {
    // Each of these is `unmodelable` above — that is the point: the same text
    // the structured parser hands back now has somewhere to go.
    for (const text of ['{"_id":0}', '{ "_id": 0, "name": 1 }', '{"a":{"$slice":5}}']) {
      expect(reasonOf(text)).toBe('unmodelable');
      expect(isRawProjection(text)).toBe(true);
    }
  });

  it('refuses anything that is not an EJSON document', () => {
    // Same bar as the filter's `queryRaw` — one rule for both raw fields.
    expect(isRawProjection('{"_id": 0')).toBe(false);
    expect(isRawProjection('{_id: 0}')).toBe(false); // unquoted key is not JSON
    expect(isRawProjection('[1,2]')).toBe(false); // `find` takes a document
    expect(isRawProjection('"nope"')).toBe(false);
    expect(isRawProjection('')).toBe(false);
    expect(isRawProjection('   ')).toBe(false);
  });
});

describe('compileFindOptions — raw projection wins, and is never silently dropped', () => {
  it('sends the raw text verbatim and ignores the modelled fields', () => {
    const compiled = compileFindOptions(
      builder({ projection: ['name'], projectionRaw: '{ "name": 1, "_id": 0 }' }),
    );
    // Verbatim, down to the whitespace and the key order: no `{_id: 1}`
    // seeding, no re-serialization. A compiler that re-stringified would
    // still "work" here and quietly rewrite what the user asked for.
    expect(compiled.projection).toBe('{ "name": 1, "_id": 0 }');
  });

  it('keeps seeding _id on the modelled path when there is no raw', () => {
    expect(compileFindOptions(builder({ projection: ['name'] })).projection)
      .toBe('{"_id":1,"name":1}');
    expect(compileFindOptions(builder({ projection: ['name'], projectionRaw: '  ' })).projection)
      .toBe('{"_id":1,"name":1}');
  });

  it('passes an unparseable raw through rather than compiling to "no projection"', () => {
    // The §11 fail-closed invariant, at the compiler. Returning `undefined`
    // here would run the find with no projection at all — every field, from
    // text the user meant to *narrow* the result. The fail-open projection analogue.
    const compiled = compileFindOptions(builder({ projectionRaw: '{"_id":0' }));
    expect(compiled.projection).toBe('{"_id":0');
    expect(compiled.projection).not.toBeUndefined();
  });
});

describe('projectionProblem — the gate the compiler leans on', () => {
  it('is null when there is no raw projection, or the raw one parses', () => {
    expect(projectionProblem(builder())).toBeNull();
    expect(projectionProblem(builder({ projection: ['a'] }))).toBeNull();
    expect(projectionProblem(builder({ projectionRaw: '' }))).toBeNull();
    expect(projectionProblem(builder({ projectionRaw: '{"_id":0}' }))).toBeNull();
  });

  it('reports an unparseable raw projection', () => {
    expect(projectionProblem(builder({ projectionRaw: '{"_id":0' })))
      .toMatch(/Can't parse this projection/);
    expect(projectionProblem(builder({ projectionRaw: '[1,2]' })))
      .toMatch(/Can't parse this projection/);
  });
});
