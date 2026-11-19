import { describe, it, expect } from 'vitest';
import { isSameReferenceTarget } from '../../src/features/references/display';
import type { ReferenceRule } from '@shared/types';

const RULE = { id: 'r1', owner: { familyId: 'fam' } } as unknown as ReferenceRule;

describe('isSameReferenceTarget', () => {
  it('is false with no frame', () => {
    expect(isSameReferenceTarget(undefined, RULE, 'u1')).toBe(false);
  });

  it('matches the same rule and value', () => {
    expect(isSameReferenceTarget({ rule: RULE, value: 'u1' }, RULE, 'u1')).toBe(true);
    expect(isSameReferenceTarget({ rule: RULE, value: { $oid: 'a' } }, RULE, { $oid: 'a' })).toBe(true);
  });

  it('differs by rule or by value', () => {
    expect(isSameReferenceTarget({ rule: RULE, value: 'u1' }, { ...RULE, id: 'r2' }, 'u1')).toBe(false);
    expect(isSameReferenceTarget({ rule: RULE, value: 'u1' }, RULE, 'u2')).toBe(false);
  });

  it('treats the same shared rule and value on another Connection as another reference', () => {
    expect(isSameReferenceTarget({ rule: RULE, value: 'u1', connectionId: 'A' }, RULE, 'u1', 'B')).toBe(false);
    expect(isSameReferenceTarget({ rule: RULE, value: 'u1', connectionId: 'A' }, RULE, 'u1', 'A')).toBe(true);
  });

  it('compares Connections only when both sides name one', () => {
    expect(isSameReferenceTarget({ rule: RULE, value: 'u1' }, RULE, 'u1', 'B')).toBe(true);
    expect(isSameReferenceTarget({ rule: RULE, value: 'u1', connectionId: 'A' }, RULE, 'u1')).toBe(true);
  });
});
