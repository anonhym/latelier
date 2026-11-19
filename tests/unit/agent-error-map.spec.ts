import { describe, it, expect } from 'vitest';
import { z } from 'zod';
import {
  AGENT_ERROR_CODES,
  AgentToolError,
  defaultAgentMessage,
  errorText,
  toAgentError,
} from '../../electron/agent/errorMap';

function driverError(message: string, extra: Record<string, unknown> = {}): Error {
  return Object.assign(new Error(message), extra);
}

describe('toAgentError', () => {
  const LEAKS = ['secret-value-42', 'payroll.salaries', 'db-prod-3.internal:27017', 'ada@example.com'];

  it.each(LEAKS)('never forwards a driver message that carries %s', (leak) => {
    const errors = [
      driverError(`E11000 duplicate key ${leak}`, { code: 11000 }),
      driverError(`not authorized on ${leak}`, { code: 13, codeName: 'Unauthorized' }),
      driverError(`connect ECONNREFUSED ${leak}`, { name: 'MongoNetworkError' }),
      driverError(`operation exceeded time limit ${leak}`, { codeName: 'MaxTimeMSExpired' }),
      driverError(`aborted ${leak}`, { name: 'AbortError' }),
      driverError(`something odd ${leak}`),
      `plain string ${leak}`,
      { message: leak, code: 2 },
    ];
    for (const err of errors) {
      const mapped = toAgentError(err);
      expect(JSON.stringify(mapped)).not.toContain(leak);
      expect(errorText(mapped)).not.toContain(leak);
    }
  });

  it('passes an app-raised error through with its own code and message', () => {
    expect(toAgentError(new AgentToolError('JS_NOT_ALLOWED'))).toEqual({
      code: 'JS_NOT_ALLOWED',
      message: defaultAgentMessage('JS_NOT_ALLOWED'),
      serverCode: undefined,
    });
    expect(toAgentError(new AgentToolError('NAMESPACE_DENIED', 'custom app text')).message).toBe('custom app text');
  });

  it('maps MaxTimeMSExpired to TIMEOUT', () => {
    expect(toAgentError(driverError('x', { codeName: 'MaxTimeMSExpired', code: 50 })).code).toBe('TIMEOUT');
  });

  it.each([
    ['AbortError', { name: 'AbortError' }],
    ['MongoAbortedError', { name: 'MongoAbortedError' }],
    ['an ABORT_ERR code', { code: 'ABORT_ERR' }],
  ])('maps %s to CANCELLED', (_n, extra) => {
    expect(toAgentError(driverError('x', extra)).code).toBe('CANCELLED');
  });

  it('keeps only the numeric server code on DB_ERROR', () => {
    const mapped = toAgentError(driverError('has a value', { code: 11000 }));
    expect(mapped).toEqual({ code: 'DB_ERROR', message: defaultAgentMessage('DB_ERROR'), serverCode: 11000 });
    expect(errorText(mapped)).toBe('DB_ERROR: The database returned an error. (server code 11000)');
  });

  it('maps an error with no numeric code to a bare DB_ERROR', () => {
    expect(toAgentError(driverError('x'))).toEqual({ code: 'DB_ERROR', message: defaultAgentMessage('DB_ERROR') });
    expect(toAgentError('x').serverCode).toBeUndefined();
    expect(toAgentError(null).code).toBe('DB_ERROR');
    expect(toAgentError({ code: 1.5 }).serverCode).toBeUndefined();
    expect(toAgentError({ code: '13' }).serverCode).toBeUndefined();
  });

  it('describes a schema failure by path and issue code, never by received value', () => {
    const schema = z.strictObject({ limit: z.number().int().max(200), mode: z.enum(['a', 'b']) });
    const result = schema.safeParse({ limit: 'secret-value-42', mode: 'secret-value-42', extra: 'secret-value-42' });
    expect(result.success).toBe(false);
    const mapped = toAgentError(result.error);
    expect(mapped.code).toBe('INVALID_INPUT');
    expect(mapped.message).toContain('limit: invalid_type');
    expect(mapped.message).toContain('unknown field extra');
    expect(mapped.message).not.toContain('secret-value-42');
  });

  it('reports at most five issues and cuts long path parts', () => {
    const shape = Object.fromEntries(Array.from({ length: 8 }, (_v, i) => [`f${i}`, z.string()]));
    const bad = z.strictObject(shape).safeParse({});
    const msg = toAgentError(bad.error).message;
    expect(msg.match(/invalid_type/g)).toHaveLength(5);
    const long = z.strictObject({}).safeParse({ ['k'.repeat(100)]: 1 });
    expect(toAgentError(long.error).message).toContain(`unknown field ${'k'.repeat(64)}`);
    expect(toAgentError(long.error).message).not.toContain('k'.repeat(65));
  });

  it('names a root-level issue as input', () => {
    const bad = z.strictObject({}).safeParse('nope');
    expect(toAgentError(bad.error).message).toContain('input: invalid_type');
  });
});

describe('errorText', () => {
  it('is the code, a colon and the message', () => {
    expect(errorText({ code: 'NOT_SHARED', message: 'm' })).toBe('NOT_SHARED: m');
  });
});

describe('the code list', () => {
  it('is the eleven stable codes and every one has a default message', () => {
    expect([...AGENT_ERROR_CODES].sort((a, b) => a.localeCompare(b))).toEqual(
      [
        'ACCESS_OFF', 'BUSY', 'CANCELLED', 'DB_ERROR', 'INVALID_INPUT', 'JS_NOT_ALLOWED',
        'NAMESPACE_DENIED', 'NOT_OPEN', 'NOT_SHARED', 'STAGE_NOT_ALLOWED', 'TIMEOUT',
      ],
    );
    for (const code of AGENT_ERROR_CODES) expect(defaultAgentMessage(code).length).toBeGreaterThan(5);
  });
});
