import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { ZodError } from 'zod';
import { toIpcError } from '../../electron/ipc/envelope';
import {
  AppError,
  ValidationError,
  NotFoundError,
  ConflictError,
  ReadOnlyConnectionError,
  SystemError,
  MongoOpError,
  type AppErrorCode,
} from '../../electron/errors';

const ALL_CODES: AppErrorCode[] = [
  'VALIDATION', 'NOT_FOUND', 'CONFLICT', 'UNAUTHORIZED', 'TIMEOUT', 'NETWORK',
  'MONGO_ERROR', 'DB_ERROR', 'SECRETS_UNAVAILABLE', 'SECRET_DECRYPT_FAILED', 'READ_ONLY', 'INTERNAL',
];

describe('toIpcError property: every AppError-family instance carries its own code/message/details through unchanged', () => {
  // details is opaque to toIpcError — read once, never spread or inspected —
  // so there is no point in this module where an arbitrary string becomes an
  // object key. fc.anything() is safe here with no __proto__-key hazard;
  // reference identity (`toBe`) is the honest assertion for a pass-through.
  it('AppError, SystemError and MongoOpError echo whatever code they were constructed with', () => {
    fc.assert(
      fc.property(
        fc.constantFrom(...ALL_CODES),
        fc.string({ maxLength: 20 }),
        fc.anything(),
        (code, message, details) => {
          for (const err of [
            new AppError(code, message, details),
            new SystemError(code, message, details),
            new MongoOpError(code, message, details),
          ]) {
            const r = toIpcError(err);
            expect(r.code).toBe(code);
            expect(r.message).toBe(message);
            expect(r.details).toBe(details);
          }
        },
      ),
      { numRuns: 30 },
    );
  });

  // The single-purpose subclasses each hard-code their own fixed code —
  // checking every one individually is what catches a copy-paste mistake in
  // any single subclass (e.g. ConflictError wired to 'NOT_FOUND').
  it('ValidationError/NotFoundError/ConflictError/ReadOnlyConnectionError map to their fixed code', () => {
    const subclasses: Array<[new (message: string, details?: unknown) => AppError, AppErrorCode]> = [
      [ValidationError, 'VALIDATION'],
      [NotFoundError, 'NOT_FOUND'],
      [ConflictError, 'CONFLICT'],
      [ReadOnlyConnectionError, 'READ_ONLY'],
    ];
    fc.assert(
      fc.property(
        fc.constantFrom(...subclasses),
        fc.string({ maxLength: 20 }),
        fc.anything(),
        ([Ctor, code], message, details) => {
          const r = toIpcError(new Ctor(message, details));
          expect(r).toEqual({ code, message, details });
        },
      ),
      { numRuns: 30 },
    );
  });

  // AppError is itself an Error subclass, so its statically-`string`
  // .message is exposed to the same runtime-descriptor hazard as a plain
  // Error (see the throwableArb-covered branch below) — a hostile own
  // descriptor can return a non-string without throwing. This must still
  // come back as a string, not the raw non-string value.
  it('a non-string .message descriptor on an AppError falls back to a string, never the raw value', () => {
    fc.assert(
      fc.property(
        fc.constantFrom(...ALL_CODES),
        fc.oneof(fc.integer(), fc.boolean(), fc.constant(null), fc.array(fc.integer(), { maxLength: 3 })),
        fc.anything(),
        (code, hostileMessage, details) => {
          const err = new AppError(code, 'placeholder', details);
          Object.defineProperty(err, 'message', { value: hostileMessage, enumerable: true });
          const r = toIpcError(err);
          expect(typeof r.message).toBe('string');
          expect(r.code).toBe(code);
          expect(r.details).toBe(details);
        },
      ),
      { numRuns: 30 },
    );
  });
});

const zodPathArb = fc.array(fc.oneof(fc.string({ maxLength: 6 }), fc.nat({ max: 20 })), { maxLength: 4 });
const zodIssueArb = fc.record({
  code: fc.constant('custom' as const),
  path: zodPathArb,
  message: fc.string({ maxLength: 20 }),
});

describe('toIpcError property: ZodError shape', () => {
  it('VALIDATION code; message is the first issue\'s path (dot-joined, "(root)" when empty) plus its message; details lists every issue', () => {
    fc.assert(
      fc.property(fc.array(zodIssueArb, { minLength: 1, maxLength: 5 }), (issues) => {
        const err = new ZodError(issues);
        const r = toIpcError(err);
        const first = issues[0]!;
        const joined = first.path.join('.');
        const prefix = joined || '(root)';
        expect(r).toEqual({
          code: 'VALIDATION',
          message: `${prefix}: ${first.message}`,
          details: { issues: issues.map((i) => ({ path: i.path, message: i.message })) },
        });
      }),
      { numRuns: 30 },
    );
  });
});

class ThrowingMessageError extends Error {
  get message(): string {
    throw new Error('boom');
  }
}

// Forwards property lookups (String(), .toString()) straight to the target,
// but a bare `getPrototypeOf` trap is enough to make `instanceof` throw —
// nothing else on this object is hostile.
function makeInstanceofTrap(): object {
  return new Proxy(
    {},
    {
      getPrototypeOf() {
        throw new Error('trap');
      },
    },
  );
}

// `thrown` is `unknown` and the arbitrary widens it with primitives and
// null/undefined, so a bare `instanceof Error` result stashed in a `boolean`
// doesn't narrow `thrown` back to `Error` for TS. A discriminated return
// carries the narrowed value instead of a flag, and stays total the same way
// the module must: `instanceof` itself can throw (the getPrototypeOf trap).
type Classification = { kind: 'trap' } | { kind: 'error'; value: Error } | { kind: 'other' };

function classify(thrown: unknown): Classification {
  try {
    return thrown instanceof Error ? { kind: 'error', value: thrown } : { kind: 'other' };
  } catch {
    return { kind: 'trap' };
  }
}

// Deliberately excludes AppError/ZodError instances — those have their own
// dedicated properties above with a different (non-INTERNAL) expected code.
const throwableArb = fc.oneof(
  fc.string({ maxLength: 20 }).map((m) => new Error(m)),
  fc.string({ maxLength: 20 }).map((m) => new TypeError(m)),
  fc.string({ maxLength: 20 }),
  fc.integer(),
  fc.boolean(),
  fc.constant(null),
  fc.constant(undefined),
  fc.array(fc.string({ maxLength: 5 }), { maxLength: 3 }),
  fc.record({ message: fc.string({ maxLength: 10 }) }),
  // A .message that is length-bearing but not a string (e.g. an array) —
  // some of fc.record's generated objects are null-prototype (its own
  // edge-case bias), which routes these into the uncoercible fallback and
  // exercises the `typeof message === 'string'` guard there, not just the
  // `.length > 0` check.
  fc.record({ message: fc.array(fc.string({ maxLength: 5 }), { minLength: 1, maxLength: 3 }) }),
  // A real Error whose .message is a non-string value — Error.message is
  // statically typed as string but can return any value at runtime. Verifies
  // the guard against non-string returns in the instanceof Error branch.
  fc.oneof(
    fc.integer(),
    fc.boolean(),
    fc.array(fc.string({ maxLength: 5 }), { minLength: 1, maxLength: 2 }),
  ).map((nonString) => {
    const err = new Error('initial');
    Object.defineProperty(err, 'message', { value: nonString, enumerable: true });
    return err;
  }),
  // A real Error whose .message getter throws — takes the `instanceof Error`
  // branch, unlike every other case above.
  fc.constant(0).map(() => new ThrowingMessageError()),
  // instanceof itself throws before any branch runs.
  fc.constant(0).map(() => makeInstanceofTrap()),
);

describe('toIpcError property: total over arbitrary non-AppError, non-ZodError throwables', () => {
  // Pins the INTERNAL fallback branch's exact shape — {code, message} only.
  // A mutant that spread `...err` instead of picking `.message` would leak
  // `.stack` (and any other own property an Error carries) across the IPC
  // boundary; this is the check that would catch it.
  it('always INTERNAL, message is a string, and no other property (stack included) ever leaks through', () => {
    fc.assert(
      fc.property(throwableArb, (thrown) => {
        const r = toIpcError(thrown);
        expect(r.code).toBe('INTERNAL');
        expect(typeof r.message).toBe('string');
        expect(Object.keys(r).sort()).toEqual(['code', 'message']);

        // Read the classification the same guarded way the module must —
        // `instanceof` itself can throw (a Proxy with a throwing
        // `getPrototypeOf` trap), and that case only promises a non-empty
        // message, same as any other uncoercible value.
        const classification = classify(thrown);

        if (classification.kind === 'trap') {
          expect(r.message.length).toBeGreaterThan(0);
          return;
        }

        if (classification.kind === 'error') {
          // A throwing `.message` getter takes this branch but can't be
          // read directly either — same guarded read, same fallback marker
          // as the module's own total fallback.
          let message: unknown;
          try {
            message = classification.value.message;
          } catch {
            expect(r).toEqual({ code: 'INTERNAL', message: '[unstringifiable thrown value]' });
            return;
          }
          // Error.message is statically typed as `string`, but a subclass or
          // descriptor can return any value at runtime. If it's non-string,
          // the module routes through safeString(err) → String(err).
          if (typeof message !== 'string') {
            // Expect the same fallback as the module: String(err).
            const coerced = String(classification.value);
            expect(r.message).toBe(coerced);
            return;
          }
          expect(r.message).toBe(message);
          return;
        }

        // String(thrown) is itself part of the contract only when it
        // succeeds — some generated records are null-prototype objects
        // (fc.record's own edge-case bias), and String() throws for those.
        // Attempt it the same way the module must, rather than assuming it
        // always works.
        let coerced: string | undefined;
        try {
          coerced = String(thrown);
        } catch {
          coerced = undefined;
        }

        if (coerced !== undefined) {
          expect(r.message).toBe(coerced);
          return;
        }

        // Uncoercible thrown value: the contract only promises a non-empty
        // message, recovering a usable .message when the thrown value has
        // one.
        expect(r.message.length).toBeGreaterThan(0);
        const thrownMessage = (thrown as { message?: unknown } | null)?.message;
        if (typeof thrownMessage === 'string' && thrownMessage.length > 0) {
          expect(r.message).toBe(thrownMessage);
        }
      }),
      { numRuns: 40 },
    );
  });
});
