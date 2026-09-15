import { describe, it, expect } from 'vitest';
import { projectionToMongo } from '../../electron/services/ReferenceRulesService';

/**
 * `projection` is validated only as `z.array(z.string())`, so a field named
 * `__proto__` is a legal input. Plain bracket assignment into a fresh `{}`
 * no-ops for that name (Object.prototype's accessor swallows the set
 * silently instead of creating an own property), so the field silently
 * drops out of the projection sent to MongoDB.
 */
describe('projectionToMongo — field named "__proto__"', () => {
  it('includes the field instead of silently dropping it', () => {
    const projection = projectionToMongo(['name', '__proto__']);
    expect(projection).toBeDefined();
    expect(Object.prototype.hasOwnProperty.call(projection, '__proto__')).toBe(true);
    expect(projection!.__proto__).toBe(1);
    // Literal `__proto__:` object-initializer syntax sets the prototype
    // instead of creating an own property, so the expected value here is
    // built with a computed key to actually carry it as data.
    expect(projection).toEqual({ name: 1, ['__proto__']: 1, _id: 1 });
  });
});
