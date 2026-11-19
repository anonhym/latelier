import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import {
  shapeBefore,
  shapeFields,
  type ShapeStage,
  type SourceField,
} from '../../src/features/fieldSuggestions/stageShape';

const fieldName = fc.stringMatching(/^[a-z][a-z0-9]{0,6}$/);
const sourceFields = fc
  .uniqueArray(fieldName, { minLength: 1, maxLength: 8 })
  .map((names): SourceField[] => names.map((path) => ({ path })));

// Pass-through stages, each with a body that parses and one that does not:
// what a pass-through stage says never changes the fields.
const passThrough = fc
  .tuple(
    fc.constantFrom('$match', '$sort', '$limit', '$skip', '$sample'),
    fc.constantFrom('{}', '{ a: 1 }', '5', '{ broken', ''),
    fc.boolean(),
  )
  .map(([op, body, enabled]): ShapeStage => ({ op, body, enabled }));

const paths = (fields: Array<{ path: string }>) => fields.map((f) => f.path).sort((a, b) => a.localeCompare(b));

describe('stage shape properties', () => {
  it('any chain of pass-through stages offers exactly the source fields', () => {
    fc.assert(
      fc.property(fc.array(passThrough, { maxLength: 8 }), sourceFields, (stages, source) => {
        const { fields, unknownShape } = shapeFields(shapeBefore(stages, stages.length), source, []);
        expect(paths(fields)).toEqual(paths(source));
        expect(unknownShape).toBe(false);
      }),
    );
  });

  it('a $group after any chain drops every source field that its keys do not reuse', () => {
    fc.assert(
      fc.property(
        fc.array(passThrough, { maxLength: 5 }),
        sourceFields,
        fc.uniqueArray(fieldName, { maxLength: 4 }),
        (chain, source, outputs) => {
          const body = `{ _id: "$x", ${outputs.map((k) => `${k}: { $sum: 1 }`).join(', ')} }`;
          const stages = [...chain, { op: '$group', body, enabled: true }];
          const { fields } = shapeFields(shapeBefore(stages, stages.length), source, []);
          const offered = new Set(paths(fields));
          for (const f of source) {
            expect(offered.has(f.path)).toBe(f.path === '_id' || outputs.includes(f.path));
          }
          expect(offered.has('_id')).toBe(true);
          for (const k of outputs) expect(offered.has(k)).toBe(true);
        },
      ),
    );
  });

  it('a preview never removes a field, and every field it names is offered', () => {
    fc.assert(
      fc.property(fc.array(passThrough, { maxLength: 4 }), sourceFields, fc.array(fieldName, { maxLength: 5 }), (stages, source, preview) => {
        const shape = shapeBefore(stages, stages.length);
        const without = new Set(paths(shapeFields(shape, source, []).fields));
        const withPreview = new Set(paths(shapeFields(shape, source, preview).fields));
        for (const p of without) expect(withPreview.has(p)).toBe(true);
        for (const p of preview) expect(withPreview.has(p)).toBe(true);
      }),
    );
  });
});
