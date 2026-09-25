import { describe, it, expect } from 'vitest';
import { assertUndoable, attachUndo, undoCaptureOf } from '../../electron/mongo/undo';
import { AppError } from '../../electron/errors';
import { undoFailureMessage, undoneMessage } from '../../src/utils/auditUndo';

function refusal(row: { reversible: number; undone_at: string | null; undo_json: string | null }): string | null {
  try {
    assertUndoable(row);
    return null;
  } catch (err) {
    expect(err).toBeInstanceOf(AppError);
    return (err as AppError).code;
  }
}

describe('assertUndoable — refuses before anything is written', () => {
  const held = { reversible: 1, undone_at: null, undo_json: '{"preImage":{}}' };

  it('lets a held, unused Pre-image through', () => {
    expect(refusal(held)).toBeNull();
  });

  it('refuses an entry that never kept a Pre-image', () => {
    expect(refusal({ reversible: 0, undone_at: null, undo_json: null })).toBe('AUDIT_NOT_REVERSIBLE');
  });

  it('refuses an entry already undone, even though its Pre-image is gone too', () => {
    expect(refusal({ ...held, undone_at: '2026-01-01T00:00:00.000Z', undo_json: null })).toBe('AUDIT_ALREADY_UNDONE');
  });

  it('refuses an entry whose Pre-image was swept', () => {
    expect(refusal({ ...held, undo_json: null })).toBe('AUDIT_UNDO_EXPIRED');
  });

  it('names what happened in the message, not only the code', () => {
    expect(() => assertUndoable({ ...held, undo_json: null })).toThrow('too old to undo');
    expect(() => assertUndoable({ ...held, reversible: 0 })).toThrow('Nothing was kept');
    expect(() => assertUndoable({ ...held, undone_at: 'x' })).toThrow('already been undone');
  });
});

describe('attachUndo / undoCaptureOf', () => {
  it('hands back the same result object, with the capture readable beside it', () => {
    const result = { deletedCount: 1 };
    const capture = { preImage: { _id: 1 } };

    expect(attachUndo(result, capture)).toBe(result);
    expect(undoCaptureOf(result)).toBe(capture);
    expect(Object.keys(result)).toEqual(['deletedCount']);
  });

  it('finds nothing for a result that carried no capture, or for a non-object', () => {
    expect(undoCaptureOf({ deletedCount: 1 })).toBeUndefined();
    expect(undoCaptureOf(null)).toBeUndefined();
    expect(undoCaptureOf(undefined)).toBeUndefined();
    expect(undoCaptureOf('x')).toBeUndefined();
  });
});

describe('undoFailureMessage', () => {
  const err = (code: string, message = code) => ({ code, message });

  it.each([
    ['AUDIT_TARGET_CHANGED', /has changed since.*outside L'Atelier can't be unwound from here/],
    ['AUDIT_ALREADY_UNDONE', /^This change has already been undone\.$/],
    ['AUDIT_UNDO_EXPIRED', /^This change is too old to undo/],
    ['AUDIT_NOT_REVERSIBLE', /^This change can't be undone/],
    ['CONFLICT', /same _id exists again/],
  ])('explains %s in words', (code, text) => {
    expect(undoFailureMessage(err(code))).toMatch(text);
  });

  it('falls back to the error message for any other failure', () => {
    expect(undoFailureMessage(err('READ_ONLY', 'Connection "prod" is read-only.'))).toBe(
      'Connection "prod" is read-only.',
    );
  });

  it('falls back to a generic line when there is no usable message', () => {
    expect(undoFailureMessage(undefined)).toBe('Undo failed');
    expect(undoFailureMessage({ message: 'no code' })).toBe('no code');
  });
});

describe('undoneMessage', () => {
  it('counts what came back', () => {
    expect(undoneMessage({ restored: 1, skipped: 0 })).toBe('Restored 1 document');
    expect(undoneMessage({ restored: 3, skipped: 0 })).toBe('Restored 3 documents');
  });
});
