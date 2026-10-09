// Cheap gate for the reviver path below: does the text hold a bare integer
// token of 16+ digits (after a `:`, `,`, `[` or at the very start, for a lone
// scalar)? The smallest integer a double cannot hold, 2^53 = 9007199254740992,
// is 16 digits, so nothing shorter can lose precision. The reviver makes
// `JSON.parse` ~8x slower on a large payload, and a canonical result payload
// (quoted `$numberLong` / `$oid` strings) never matches, so it keeps the
// plain, fast path. The gate only decides speed: a looser one gives the same
// result, a tighter one loses precision.
const BARE_BIG_INT_HINT = /(?:^|[:,[])\s*-?\d{16}/;
const INT_TOKEN = /^-?\d+$/;

/**
 * The exact digits of an integer token a double cannot hold (|n| >= 2^53), or
 * `undefined` for any other value. `JSON.parse` has already rounded the token by
 * the time a reviver sees it, so the digits come from `context.source`.
 *
 * Without `context.source` the digits are gone, so this throws rather than
 * quietly keeping the rounded number. (Node 22+ and Chromium 114+ have it.)
 *
 * Exponent and fraction forms (`1e20`, `12345678901234567890.0`) are doubles by
 * spelling and give `undefined` too.
 */
function unsafeIntegerSource(value: unknown, context?: { source?: string }): string | undefined {
  // `isInteger` is false for every non-number, so strings, objects and fractions pass through here.
  if (!Number.isInteger(value) || Number.isSafeInteger(value)) return undefined;
  const source = sourceText(context);
  return INT_TOKEN.test(source) ? source : undefined;
}

function sourceText(context?: { source?: string }): string {
  const source = context?.source;
  if (source === undefined) {
    throw new Error('JSON.parse gave no source text, so a number beyond 2^53 cannot be kept exact');
  }
  return source;
}

/**
 * `JSON.parse` reviver: turns an integer token a double cannot hold into a
 * canonical `$numberLong` sentinel, which an EJSON walker then revives to a BSON
 * Long.
 *
 * Ceiling, on purpose: an integer beyond int64 stays the rounded double. BSON
 * has no wider integer, and turning it into a Decimal128 would change the type
 * of something the user typed as an integer — they write `NumberDecimal` /
 * `$numberDecimal` when they mean that.
 */
function keepBigInt(_key: string, value: unknown, context?: { source?: string }): unknown {
  const source = unsafeIntegerSource(value, context);
  if (source === undefined) return value;
  const big = BigInt(source);
  // asIntN(64) round-trips exactly when the value fits a signed 64-bit integer.
  return BigInt.asIntN(64, big) === big ? { $numberLong: source } : value;
}

// `JSON.rawJSON` (Node 22+, Chromium 114+, the same engines as `context.source`)
// is not in the TypeScript lib yet.
function rawJSON(text: string): unknown {
  return (JSON as unknown as { rawJSON(text: string): unknown }).rawJSON(text);
}

/**
 * `JSON.parse` reviver for `prettyPrintJsonKeepingBigInts`: a number that
 * `JSON.stringify` would write back as a different BSON value goes back out as
 * the user spelled it. That is any number of magnitude 2^53 or more, however it
 * is spelled (an integer token keeps its digits; `1e18` or
 * `1760000000000000768.0` would otherwise come out as a bare integer, which
 * `parseJsonKeepingBigInts` reads as a Long, and `1e400` as `null`), and `-0`,
 * which would come out as `0`, an Int32 instead of a Double. Unlike `keepBigInt`
 * it has no int64 ceiling, since it changes no type, only declines to rewrite.
 */
function keepNumberText(_key: string, value: unknown, context?: { source?: string }): unknown {
  if (typeof value !== 'number' || (Math.abs(value) < 2 ** 53 && !Object.is(value, -0))) return value;
  return rawJSON(sourceText(context));
}

/**
 * `JSON.parse` that does not round a bare integer beyond 2^53: it comes back as
 * a `{"$numberLong":"…"}` sentinel, ready for an EJSON walker (or a
 * `JSON.stringify` and a later EJSON parse). The one copy of this logic: the
 * renderer's `ejsonParse` and main's `safeEjsonParse` both parse through it,
 * and so does a caller that has to parse the text itself before reviving, such
 * as splitting a JSON array into documents.
 *
 * Pure on purpose (no Node, Electron or EJSON imports), so main can import it
 * from `src/` the way `QueryService` imports `exportFormat`.
 */
export function parseJsonKeepingBigInts(s: string): unknown {
  const reviver = BARE_BIG_INT_HINT.test(s) ? keepBigInt : undefined;
  return JSON.parse(s, reviver) as unknown;
}

/**
 * Pretty-prints JSON text without changing the BSON any number parses to:
 * `JSON.stringify(JSON.parse(s), null, indent)` would write
 * `9007199254740993` as `9007199254740992`, and the Double `1e18` as a bare
 * integer that parses back as a Long. Those numbers keep their spelling (see
 * `keepNumberText`); everything else comes out the way that round trip writes
 * it. Throws the `SyntaxError` `JSON.parse` throws for text that is not JSON.
 *
 * Not built on `parseJsonKeepingBigInts`: its `$numberLong` sentinel cannot be
 * told from one the user typed, so writing it back out as a bare integer would
 * change the user's text. It shares only the read of the token's source text.
 * No hint gate either: the gate looks for 16-digit integers, and `1e18` or
 * `-0` has none. This runs once on a click, on one stage body.
 */
export function prettyPrintJsonKeepingBigInts(s: string, indent: number): string {
  return JSON.stringify(JSON.parse(s, keepNumberText), null, indent);
}
