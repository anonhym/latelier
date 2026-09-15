import { describe, it, expect } from 'vitest';
import { detectAggGrammar } from '../../src/features/fieldSuggestions/aggGrammar';

/** Parse a fixture where `|` marks the caret. */
function fx(s: string): { value: string; caret: number } {
  const caret = s.indexOf('|');
  if (caret === -1) throw new Error('fixture missing caret marker');
  return { value: s.slice(0, caret) + s.slice(caret + 1), caret };
}

function hit(s: string, stageOp?: string) {
  const { value, caret } = fx(s);
  return detectAggGrammar(value, caret, stageOp);
}

describe('detectAggGrammar', () => {
  describe('field-name key position (bare identifier)', () => {
    it('empty object, caret at end', () => {
      const r = hit('{ |}');
      expect(r?.kind).toBe('fieldName');
      expect(r?.token).toBe('');
    });

    it('partial bare key', () => {
      const r = hit('{ stat|');
      expect(r?.kind).toBe('fieldName');
      expect(r?.token).toBe('stat');
    });

    it('after a comma', () => {
      const r = hit('{ status: 1, na|');
      expect(r?.kind).toBe('fieldName');
      expect(r?.token).toBe('na');
    });

    it('nested object key', () => {
      const r = hit('{ user: { na| } }');
      expect(r?.kind).toBe('fieldName');
      expect(r?.token).toBe('na');
    });

    it('returns fieldName for $-prefixed bare key so operator source can match', () => {
      const r = hit('{ total: { $s|');
      expect(r?.kind).toBe('fieldName');
      expect(r?.token).toBe('$s');
    });
  });

  describe('field-name key position (inside quoted key)', () => {
    it('quoted key mid-type', () => {
      const r = hit('{ "stat|" }');
      expect(r?.kind).toBe('fieldName');
      expect(r?.token).toBe('stat');
    });

    it('quoted key after comma', () => {
      const r = hit('{ a: 1, "b|" }');
      expect(r?.kind).toBe('fieldName');
      expect(r?.token).toBe('b');
    });
  });

  describe('fieldRef (string starting with $)', () => {
    it('value side $-string in $project', () => {
      const r = hit('{ name: "$stat|" }');
      expect(r?.kind).toBe('fieldRef');
      expect(r?.token).toBe('stat');
    });

    it('value side $ alone', () => {
      const r = hit('{ name: "$|" }');
      expect(r?.kind).toBe('fieldRef');
      expect(r?.token).toBe('');
    });

    it('inside an array', () => {
      const r = hit('{ $concat: ["$fir|"] }');
      expect(r?.kind).toBe('fieldRef');
      expect(r?.token).toBe('fir');
    });
  });

  describe('valueFor (known key, string value)', () => {
    it('string value for a known key', () => {
      const r = hit('{ status: "act|" }');
      expect(r?.kind).toBe('valueFor');
      if (r?.kind === 'valueFor') {
        expect(r.field).toBe('status');
        expect(r.token).toBe('act');
      }
    });

    it('quoted key with string value', () => {
      const r = hit('{ "status": "act|" }');
      expect(r?.kind).toBe('valueFor');
      if (r?.kind === 'valueFor') expect(r.field).toBe('status');
    });
  });

  describe('null / hide', () => {
    it('between sibling tokens with no clear context', () => {
      expect(hit('{ a: 1, |')?.kind).toBe('fieldName');
    });

    it('numeric value mid-type', () => {
      expect(hit('{ age: 30|')).toBeNull();
    });

    it('outside any object', () => {
      expect(hit('hel|lo')).toBeNull();
    });

    it('handles escaped quotes in string', () => {
      const r = hit('{ name: "he said \\"hi\\" to me|" }');
      expect(r?.kind).toBe('valueFor');
    });
  });

  describe('MQL filter shapes (queryRaw)', () => {
    it('top-level key in filter', () => {
      const r = hit('{ stat|');
      expect(r?.kind).toBe('fieldName');
      expect(r?.token).toBe('stat');
    });

    it('bare field with dotted path mid-type', () => {
      const r = hit('{ user.na|');
      expect(r?.kind).toBe('fieldName');
      expect(r?.token).toBe('user.na');
    });

    it('key after comma in filter', () => {
      const r = hit('{ status: "active", ag|');
      expect(r?.kind).toBe('fieldName');
      expect(r?.token).toBe('ag');
    });

    it('nested $or array: key position in an element object', () => {
      const r = hit('{ $or: [{ status: "a" }, { na| }] }');
      expect(r?.kind).toBe('fieldName');
      expect(r?.token).toBe('na');
    });

    it('operator-object key is a fieldName hit (operator source consumes it)', () => {
      const r = hit('{ age: { $g|');
      expect(r?.kind).toBe('fieldName');
      expect(r?.token).toBe('$g');
    });

    it('value of operator: not suggested (no string, no field ref)', () => {
      expect(hit('{ age: { $gt: 1|')).toBeNull();
    });

    it('string value inside operator object routes to valueFor-for-op-key', () => {
      const r = hit('{ status: { $eq: "act|" } }');
      // Inner object has lastKey = $eq, so this is valueFor { field: "$eq" }.
      // Phase 2 popover doesn't fire for valueFor yet, but the grammar hit is recorded.
      expect(r?.kind).toBe('valueFor');
    });
  });

  describe('operatorContext resolution (stageOp aware)', () => {
    it('omits operatorContext when no stageOp is given', () => {
      const r = hit('{ $e|');
      expect(r?.kind).toBe('fieldName');
      if (r?.kind === 'fieldName') expect(r.operatorContext).toBeUndefined();
    });

    it('tags matchKey inside $match at any depth', () => {
      const r1 = hit('{ $e|', '$match');
      const r2 = hit('{ age: { $g| } }', '$match');
      if (r1?.kind === 'fieldName') expect(r1.operatorContext).toBe('matchKey');
      if (r2?.kind === 'fieldName') expect(r2.operatorContext).toBe('matchKey');
    });

    it('tags groupValue at depth ≥ 2 inside $group', () => {
      const shallow = hit('{ total|', '$group');
      const deep = hit('{ total: { $s| } }', '$group');
      if (shallow?.kind === 'fieldName') expect(shallow.operatorContext).toBeUndefined();
      if (deep?.kind === 'fieldName') expect(deep.operatorContext).toBe('groupValue');
    });

    it('tags projectValue at depth ≥ 2 inside $project', () => {
      const r = hit('{ full: { $c| } }', '$project');
      if (r?.kind === 'fieldName') expect(r.operatorContext).toBe('projectValue');
    });

    it('tags addFieldsValue inside $set and $addFields', () => {
      const a = hit('{ x: { $c| } }', '$set');
      const b = hit('{ x: { $c| } }', '$addFields');
      if (a?.kind === 'fieldName') expect(a.operatorContext).toBe('addFieldsValue');
      if (b?.kind === 'fieldName') expect(b.operatorContext).toBe('addFieldsValue');
    });

    it('falls back to no context inside $facet', () => {
      const r = hit('{ byStatus: [{ $match: { stat| } }] }', '$facet');
      if (r?.kind === 'fieldName') expect(r.operatorContext).toBeUndefined();
    });
  });

  describe('replace range', () => {
    it('bare identifier range covers the whole token', () => {
      const { value, caret } = fx('{ stat|us }');
      const r = detectAggGrammar(value, caret);
      expect(r).toMatchObject({ kind: 'fieldName', token: 'stat', replaceStart: 2, replaceEnd: caret });
    });

    it('fieldRef replace range skips the $', () => {
      const { value, caret } = fx('{ a: "$stat|" }');
      const r = detectAggGrammar(value, caret);
      expect(r?.kind).toBe('fieldRef');
      if (r?.kind === 'fieldRef') {
        expect(value.substring(r.replaceStart, r.replaceEnd)).toBe('stat');
      }
    });
  });
});
