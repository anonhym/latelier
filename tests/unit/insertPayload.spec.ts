import { describe, it, expect } from 'vitest';
import { classifyInsertPayload } from '../../src/utils/insertPayload';

describe('classifyInsertPayload', () => {
  it('classifies a plain object as single', () => {
    expect(classifyInsertPayload({ name: 'alpha' })).toEqual({ kind: 'single' });
  });

  it('classifies the empty document {} as single, not array-empty', () => {
    expect(classifyInsertPayload({})).toEqual({ kind: 'single' });
  });

  it('classifies an array of plain objects as array with a count', () => {
    expect(classifyInsertPayload([{ a: 1 }, { b: 2 }])).toEqual({ kind: 'array', count: 2 });
  });

  it('classifies [] as array-empty', () => {
    expect(classifyInsertPayload([])).toEqual({ kind: 'array-empty' });
  });

  it('classifies an array containing a string item as array-invalid-items', () => {
    expect(classifyInsertPayload([{ a: 1 }, 'oops'])).toEqual({ kind: 'array-invalid-items' });
  });

  it('classifies an array containing a number item as array-invalid-items', () => {
    expect(classifyInsertPayload([{ a: 1 }, 2])).toEqual({ kind: 'array-invalid-items' });
  });

  it('classifies an array containing null as array-invalid-items', () => {
    expect(classifyInsertPayload([{ a: 1 }, null])).toEqual({ kind: 'array-invalid-items' });
  });

  it('classifies an array containing a nested array as array-invalid-items', () => {
    expect(classifyInsertPayload([{ a: 1 }, [1, 2]])).toEqual({ kind: 'array-invalid-items' });
  });
});
