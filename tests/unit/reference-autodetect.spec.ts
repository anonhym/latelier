import { describe, it, expect } from 'vitest';
import { detectCandidateFieldsFromDocs } from '../../electron/services/ReferenceRulesService';

describe('detectCandidateFieldsFromDocs', () => {
  it('finds snake_case *_id fields', () => {
    const out = detectCandidateFieldsFromDocs([
      { _id: 1, contact_id: 'x', user_id: 'y' },
    ]);
    const fields = out.map((c) => c.sourceField).sort();
    expect(fields).toEqual(['contact_id', 'user_id']);
  });

  it('finds camelCase *Id fields', () => {
    const out = detectCandidateFieldsFromDocs([
      { _id: 1, customerId: 'x', productId: 'y' },
    ]);
    const fields = out.map((c) => c.sourceField).sort();
    expect(fields).toEqual(['customerId', 'productId']);
  });

  it('captures each field only once across multiple docs', () => {
    const out = detectCandidateFieldsFromDocs([
      { contact_id: 'a' },
      { contact_id: 'b' },
      { contact_id: 'c' },
    ]);
    expect(out).toHaveLength(1);
    expect(out[0]!.sourceField).toBe('contact_id');
  });

  it('ignores the primary _id field', () => {
    const out = detectCandidateFieldsFromDocs([{ _id: 'pk' }]);
    expect(out).toHaveLength(0);
  });

  it('skips raw `Id` with no stem (empty left side)', () => {
    const out = detectCandidateFieldsFromDocs([{ Id: 'x' }]);
    expect(out).toHaveLength(0);
  });

  it('records the stem for pluralization', () => {
    const out = detectCandidateFieldsFromDocs([
      { order_id: 'a', categoryId: 'b' },
    ]);
    const stems = Object.fromEntries(out.map((c) => [c.sourceField, c.stem]));
    expect(stems).toEqual({ order_id: 'order', categoryId: 'category' });
  });

  it('does not confuse EJSON sentinels with nested objects', () => {
    const out = detectCandidateFieldsFromDocs([
      { _id: { $oid: 'abc' }, item_id: 'x' },
    ]);
    const fields = out.map((c) => c.sourceField);
    expect(fields).toContain('item_id');
    expect(fields.every((f) => !f.startsWith('_id.'))).toBe(true);
  });

  it('walks one nested-object level for dotted fields', () => {
    const out = detectCandidateFieldsFromDocs([
      { meta: { owner_id: 'x' } },
    ]);
    const fields = out.map((c) => c.sourceField);
    expect(fields).toContain('meta.owner_id');
  });
});
