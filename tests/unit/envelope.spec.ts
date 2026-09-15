import { describe, it, expect } from 'vitest';
import { z, ZodError } from 'zod';
import { toIpcError, success, failure } from '../../electron/ipc/envelope';
import {
  AppError,
  ValidationError,
  NotFoundError,
  ConflictError,
  SystemError,
} from '../../electron/errors';

describe('toIpcError', () => {
  it('passes AppError fields through', () => {
    const e = new AppError('CONFLICT', 'dup', { field: 'name' });
    const r = toIpcError(e);
    expect(r).toEqual({ code: 'CONFLICT', message: 'dup', details: { field: 'name' } });
  });

  it('maps ValidationError/NotFoundError/ConflictError/SystemError to their codes', () => {
    expect(toIpcError(new ValidationError('x')).code).toBe('VALIDATION');
    expect(toIpcError(new NotFoundError('x')).code).toBe('NOT_FOUND');
    expect(toIpcError(new ConflictError('x')).code).toBe('CONFLICT');
    expect(toIpcError(new SystemError('DB_ERROR', 'x')).code).toBe('DB_ERROR');
  });

  it('maps ZodError to VALIDATION with a human message and exact details', () => {
    const schema = z.object({ x: z.number() });
    try {
      schema.parse({ x: 'nope' });
      throw new Error('should have thrown');
    } catch (err) {
      const r = toIpcError(err);
      const zerr = err as ZodError;
      const issue = zerr.issues[0];
      expect(r).toEqual({
        code: 'VALIDATION',
        message: `x: ${issue.message}`,
        details: { issues: [{ path: ['x'], message: issue.message }] },
      });
    }
  });

  it('joins a nested path with dots, not by concatenation', () => {
    const schema = z.object({ a: z.object({ b: z.number() }) });
    try {
      schema.parse({ a: { b: 'nope' } });
      throw new Error('should have thrown');
    } catch (err) {
      const r = toIpcError(err);
      // 'a.b' (join('.')) vs 'ab' (join('')) — proves the separator is real.
      expect(r.message.startsWith('a.b: ')).toBe(true);
      expect(r.message.startsWith('ab: ')).toBe(false);
    }
  });

  it('falls back to "(root)" when the failing issue has an empty path', () => {
    try {
      z.number().parse('nope');
      throw new Error('should have thrown');
    } catch (err) {
      const r = toIpcError(err);
      expect(r.message.startsWith('(root): ')).toBe(true);
    }
  });

  it('falls back to "validation failed" when the ZodError has no issues', () => {
    const r = toIpcError(new ZodError([]));
    expect(r).toEqual({
      code: 'VALIDATION',
      message: 'validation failed',
      details: { issues: [] },
    });
  });

  it('maps unknown throws to INTERNAL and preserves message without stack', () => {
    const r = toIpcError(new Error('mystery'));
    expect(r.code).toBe('INTERNAL');
    expect(r.message).toBe('mystery');
    expect((r as unknown as { stack?: unknown }).stack).toBeUndefined();
  });

  it('maps non-Error throws to INTERNAL', () => {
    expect(toIpcError('not an error')).toEqual({
      code: 'INTERNAL',
      message: 'not an error',
    });
    expect(toIpcError(42)).toEqual({ code: 'INTERNAL', message: '42' });
  });

  it('handles a thrown value with no reachable toString (null prototype)', () => {
    // { __proto__: null } here sets the prototype at construction time, which
    // is exactly what's needed to reproduce String(err) having nothing to call.
    const r = toIpcError({ __proto__: null, message: '' });
    expect(r.code).toBe('INTERNAL');
    expect(typeof r.message).toBe('string');
    expect(r.message.length).toBeGreaterThan(0);
  });

  it('handles a thrown value whose .message getter itself throws', () => {
    const err = Object.create(null);
    Object.defineProperty(err, 'message', {
      get() {
        throw new Error('boom');
      },
    });
    const r = toIpcError(err);
    expect(r).toEqual({ code: 'INTERNAL', message: '[unstringifiable thrown value]' });
  });

  it('recovers a usable .message from a null-prototype thrown value', () => {
    const r = toIpcError({ __proto__: null, message: 'boom' });
    expect(r).toEqual({ code: 'INTERNAL', message: 'boom' });
  });

  it('rejects a non-string .message even when it has a positive length', () => {
    const r = toIpcError({ __proto__: null, message: ['a', 'b'] });
    expect(r).toEqual({ code: 'INTERNAL', message: '[unstringifiable thrown value]' });
  });

  it('handles a thrown value whose toString is shadowed with null', () => {
    const r = toIpcError({ toString: null });
    expect(r.code).toBe('INTERNAL');
    expect(typeof r.message).toBe('string');
    expect(r.message.length).toBeGreaterThan(0);
  });

  it('handles a real Error subclass with a throwing message getter', () => {
    class ThrowingMessageError extends Error {
      get message(): string {
        throw new Error('boom');
      }
    }
    const r = toIpcError(new ThrowingMessageError());
    expect(r).toEqual({ code: 'INTERNAL', message: '[unstringifiable thrown value]' });
  });

  it('handles a real Error whose .message is a non-string value', () => {
    const err = new Error('initial');
    Object.defineProperty(err, 'message', { value: 42, enumerable: true });
    const r = toIpcError(err);
    expect(r.code).toBe('INTERNAL');
    expect(typeof r.message).toBe('string');
  });

  it('handles a Proxy whose getPrototypeOf trap throws, defeating instanceof itself', () => {
    const trap = new Proxy(
      {},
      {
        getPrototypeOf() {
          throw new Error('trap');
        },
      },
    );
    const r = toIpcError(trap);
    expect(r.code).toBe('INTERNAL');
    expect(typeof r.message).toBe('string');
    expect(r.message.length).toBeGreaterThan(0);
  });
});

describe('envelope helpers', () => {
  it('success wraps data', () => {
    expect(success({ a: 1 })).toEqual({ ok: true, data: { a: 1 } });
  });

  it('failure wraps error', () => {
    expect(failure('NOT_FOUND', 'gone', { id: 'x' })).toEqual({
      ok: false,
      error: { code: 'NOT_FOUND', message: 'gone', details: { id: 'x' } },
    });
  });
});
