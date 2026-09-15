import { describe, it, expect } from 'vitest';
import { buildKeySpec } from '../../electron/mongo/IndexService';

/**
 * `field` is validated only as `z.string().min(1)`, so an index on a field
 * named `__proto__` is a legal input. Plain bracket assignment into a fresh
 * `{}` no-ops for that name (Object.prototype's accessor swallows the set
 * silently instead of creating an own property), so the key vanishes from
 * the spec MongoDB is asked to build the index on.
 */
describe('buildKeySpec — field named "__proto__"', () => {
  it('creates the index key instead of silently dropping it', () => {
    const spec = buildKeySpec([{ field: '__proto__', direction: 1 }]);
    expect(Object.prototype.hasOwnProperty.call(spec, '__proto__')).toBe(true);
    expect(spec.__proto__).toBe(1);
    expect(JSON.stringify(spec)).toBe('{"__proto__":1}');
  });

  it('preserves every field in a compound key including the hostile one', () => {
    const spec = buildKeySpec([
      { field: 'status', direction: 1 },
      { field: '__proto__', direction: -1 },
    ]);
    expect(Object.keys(spec)).toEqual(['status', '__proto__']);
    expect(spec.status).toBe(1);
    expect(spec.__proto__).toBe(-1);
  });
});
