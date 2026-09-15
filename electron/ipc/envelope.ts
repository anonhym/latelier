import { ZodError } from 'zod';
import type { Envelope, IpcError, IpcErrorCode } from '@shared/ipc';
import { AppError } from '../errors.ts';

export function success<T>(data: T): Envelope<T> {
  return { ok: true, data };
}

export function failure(
  code: IpcErrorCode,
  message: string,
  details?: unknown,
): Envelope<never> {
  return { ok: false, error: { code, message, details } };
}

// Outer try/catch guards against a Proxy `getPrototypeOf` trap making `instanceof` itself throw before any branch runs.
export function toIpcError(err: unknown): IpcError {
  try {
    if (err instanceof AppError) {
      // .message is statically `string` but a subclass/descriptor can return
      // anything at runtime without throwing — guard it like the Error branch below.
      const rawMsg = err.message;
      const msg = typeof rawMsg === 'string' ? rawMsg : safeString(err);
      return { code: err.code, message: msg, details: err.details };
    }
    if (err instanceof ZodError) {
      const first = err.issues[0];
      return {
        code: 'VALIDATION',
        message: first
          ? `${first.path.join('.') || '(root)'}: ${first.message}`
          : 'validation failed',
        details: { issues: err.issues.map((i) => ({ path: i.path, message: i.message })) },
      };
    }
    let msg: string;
    if (err instanceof Error) {
      try {
        // Use .message as-is when it's a real string, not safeString's
        // "Name: message" form. Guard against a subclass/descriptor
        // returning a non-string, or a throwing getter.
        const rawMsg = err.message;
        msg = typeof rawMsg === 'string' ? rawMsg : safeString(err);
      } catch {
        msg = safeString(err);
      }
    } else {
      msg = safeString(err);
    }
    return { code: 'INTERNAL', message: msg };
  } catch {
    return { code: 'INTERNAL', message: '[unstringifiable thrown value]' };
  }
}

// String(err) throws for a value with no reachable toString/valueOf (e.g. Object.create(null)); .message access can throw too.
function safeString(err: unknown): string {
  try {
    return String(err);
  } catch {
    try {
      const message = (err as { message: unknown }).message;
      if (typeof message === 'string' && message.length > 0) return message;
    } catch {
      // fall through to the fixed marker
    }
    return '[unstringifiable thrown value]';
  }
}
