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
 * `JSON.parse` reviver: turns an integer token a double cannot hold (|n| >=
 * 2^53) into a canonical `$numberLong` sentinel, which an EJSON walker then
 * revives to a BSON Long. `JSON.parse` has already rounded the token by the
 * time a reviver sees it, so the exact digits come from `context.source`.
 *
 * Ceiling, on purpose: an integer beyond int64 stays the rounded double. BSON
 * has no wider integer, and turning it into a Decimal128 would change the type
 * of something the user typed as an integer — they write `NumberDecimal` /
 * `$numberDecimal` when they mean that. Exponent and fraction forms (`1e20`,
 * `12345678901234567890.0`) are doubles by spelling and are left alone too.
 *
 * Without `context.source` the digits are gone, so this throws rather than
 * quietly keeping the rounded number. (Node 22+ and Chromium 114+ have it.)
 */
function keepBigInt(_key: string, value: unknown, context?: { source?: string }): unknown {
  // `isInteger` is false for every non-number, so strings, objects and fractions pass through here.
  if (!Number.isInteger(value) || Number.isSafeInteger(value)) return value;
  const source = context?.source;
  if (source === undefined) {
    throw new Error('JSON.parse gave no source text, so an integer beyond 2^53 cannot be kept exact');
  }
  if (!INT_TOKEN.test(source)) return value;
  const big = BigInt(source);
  // asIntN(64) round-trips exactly when the value fits a signed 64-bit integer.
  return BigInt.asIntN(64, big) === big ? { $numberLong: source } : value;
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
