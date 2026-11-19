import { SystemError } from '../errors.ts';
import { ejsonStringifyRelaxed } from '../mongo/ejson.ts';

/** X27 §9.2: at most 1 MiB of serialised Relaxed EJSON per response. */
export const MAX_RESPONSE_BYTES = 1_048_576;

/** An `_id` longer than this is left out of an oversize stub, so the stub stays small whatever the document was. */
const MAX_STUB_ID_BYTES = 1_024;

export type AppliedLimit = 'limit' | 'bytes';

export interface BudgetResult {
  /** A JSON array of Relaxed EJSON documents, at most `maxBytes` long. */
  json: string;
  /** Documents in `json`, stubs included. */
  count: number;
  bytes: number;
  truncated: boolean;
  appliedLimits: AppliedLimit[];
}

export interface BudgetOptions {
  /** Documents to return. Callers read `limit + 1` from the cursor, so a document past the limit means more exist. */
  limit: number;
  maxBytes?: number;
}

function encode(doc: unknown): string {
  const json = ejsonStringifyRelaxed(doc);
  // `undefined` is what EJSON returns for a value it cannot serialise.
  if (json === undefined) throw new SystemError('INTERNAL', 'a document could not be serialised');
  return json;
}

/** What replaces one document too large to send alone: its `_id` and its size. */
function stubFor(doc: unknown, bytes: number): string {
  const omitted = `"_latelierOmitted":{"bytes":${bytes}}`;
  const id = (doc as { _id?: unknown } | null)?._id;
  if (id === undefined) return `{${omitted}}`;
  const idJson = ejsonStringifyRelaxed(id);
  if (idJson === undefined || Buffer.byteLength(idJson) > MAX_STUB_ID_BYTES) return `{${omitted}}`;
  return `{"_id":${idJson},${omitted}}`;
}

/**
 * Takes documents from a cursor (or any iterable) while they fit (X27 §9.2).
 * Iteration stops, and a cursor is closed by the `for await` that ends, at
 * whichever comes first: the document limit, or the next document not fitting
 * the byte budget. A single document larger than the whole budget becomes a
 * stub, so one huge document cannot hide the ones after it.
 */
export async function takeWithinBudget(
  source: AsyncIterable<unknown> | Iterable<unknown>,
  options: BudgetOptions,
): Promise<BudgetResult> {
  const maxBytes = options.maxBytes ?? MAX_RESPONSE_BYTES;
  const pieces: string[] = [];
  // The brackets, then one comma between every two pieces.
  let bytes = 2;
  let hitLimit = false;
  let hitBytes = false;
  let sentStub = false;

  for await (const doc of source) {
    if (pieces.length >= options.limit) {
      hitLimit = true;
      break;
    }
    let piece = encode(doc);
    let size = Buffer.byteLength(piece);
    const oversize = size + 2 > maxBytes;
    if (oversize) {
      piece = stubFor(doc, size);
      size = Buffer.byteLength(piece);
    }
    const added = size + (pieces.length === 0 ? 0 : 1);
    if (bytes + added > maxBytes) {
      hitBytes = true;
      break;
    }
    pieces.push(piece);
    bytes += added;
    if (oversize) sentStub = true;
  }

  // A stub is a cut, so it counts as `bytes` too; one dropped to fit the budget was not sent and is only the stop.
  const appliedLimits: AppliedLimit[] = [];
  if (hitLimit) appliedLimits.push('limit');
  if (hitBytes || sentStub) appliedLimits.push('bytes');
  return {
    json: `[${pieces.join(',')}]`,
    count: pieces.length,
    bytes,
    truncated: appliedLimits.length > 0,
    appliedLimits,
  };
}

/** The sentence after the envelope: how many documents came back, and why it stopped when it did. */
export function describeResult(result: Pick<BudgetResult, 'count' | 'appliedLimits'>, limit: number): string {
  const noun = result.count === 1 ? 'document' : 'documents';
  const reasons: string[] = [];
  if (result.appliedLimits.includes('limit')) {
    reasons.push(`stopped at the limit of ${limit} documents, so more exist`);
  }
  if (result.appliedLimits.includes('bytes')) {
    reasons.push(`stopped at the ${MAX_RESPONSE_BYTES / 1024 / 1024} MiB size limit`);
  }
  return reasons.length === 0
    ? `Returned ${result.count} ${noun}.`
    : `Returned ${result.count} ${noun}; ${reasons.join(' and ')}.`;
}
