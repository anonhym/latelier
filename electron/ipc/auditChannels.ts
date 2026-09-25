import { IPC_CHANNELS, type Envelope } from '@shared/ipc';
import type { AuditOp, AuditOutcome, AuditSummary } from '@shared/types';

/** One audit row, before it has an id or timestamps. */
export interface AuditRecord {
  connectionId: string;
  dbName: string;
  collection: string | null;
  op: AuditOp;
  summary: AuditSummary;
  outcome: AuditOutcome;
  errorCode: string | null;
}

type Fields = Record<string, unknown>;

interface ChannelSpec {
  op: AuditOp;
  /** `data` is the handler's result, or undefined when the Operation failed. */
  summarize: (input: Fields, data: unknown) => AuditSummary;
}

function count(source: unknown, key: string): number | undefined {
  if (source === null || typeof source !== 'object') return undefined;
  const v = (source as Fields)[key];
  return typeof v === 'number' ? v : undefined;
}

// Summaries name what was targeted and what came back — never a document body
// (`docsJson`, `updateJson`), and never a confirm token (deleteMany's or
// updateMany's).
const filterOf = (input: Fields): string => input.filterJson as string;

/**
 * The audited channels. A channel absent from this table is not audited, so a
 * write channel added later stays unrecorded until someone decides what its
 * row should hold — failing closed rather than recording something it
 * shouldn't.
 */
const AUDITED_CHANNELS: Readonly<Record<string, ChannelSpec>> = {
  [IPC_CHANNELS.docInsertMany]: {
    op: 'insertMany',
    summarize: (_input, data) => ({ op: 'insertMany', insertedCount: count(data, 'insertedCount') }),
  },
  [IPC_CHANNELS.docUpdateOne]: {
    op: 'updateOne',
    summarize: (input, data) => ({
      op: 'updateOne',
      filter: filterOf(input),
      matchedCount: count(data, 'matchedCount'),
      modifiedCount: count(data, 'modifiedCount'),
    }),
  },
  [IPC_CHANNELS.docUpdateMany]: {
    op: 'updateMany',
    summarize: (input, data) => ({
      op: 'updateMany',
      filter: filterOf(input),
      matchedCount: count(data, 'matchedCount'),
      modifiedCount: count(data, 'modifiedCount'),
    }),
  },
  [IPC_CHANNELS.docDeleteOne]: {
    op: 'deleteOne',
    summarize: (input, data) => ({
      op: 'deleteOne',
      filter: filterOf(input),
      deletedCount: count(data, 'deletedCount'),
    }),
  },
  [IPC_CHANNELS.docDeleteMany]: {
    op: 'deleteMany',
    summarize: (input, data) => ({
      op: 'deleteMany',
      filter: filterOf(input),
      deletedCount: count(data, 'deletedCount'),
    }),
  },
  [IPC_CHANNELS.collectionDrop]: {
    op: 'collectionDrop',
    summarize: () => ({ op: 'collectionDrop' }),
  },
  [IPC_CHANNELS.collectionRename]: {
    op: 'collectionRename',
    summarize: (input) => ({
      op: 'collectionRename',
      fromName: input.collection as string,
      toName: input.newName as string,
    }),
  },
  [IPC_CHANNELS.databaseDrop]: {
    op: 'databaseDrop',
    summarize: () => ({ op: 'databaseDrop' }),
  },
};

/**
 * The row an invocation of `channel` should leave, or null when the channel is
 * not audited. `input` is the validated payload; `envelope` is exactly what
 * the renderer received, so `error_code` can never disagree with it.
 */
export function auditRecordFor(
  channel: string,
  input: unknown,
  envelope: Envelope<unknown>,
): AuditRecord | null {
  if (!Object.hasOwn(AUDITED_CHANNELS, channel)) return null;
  const spec = AUDITED_CHANNELS[channel]!;
  const fields = input as Fields;
  const target = {
    connectionId: fields.connectionId as string,
    dbName: fields.dbName as string,
    collection: (fields.collection as string | undefined) ?? null,
    op: spec.op,
  };
  if (envelope.ok) {
    return { ...target, summary: spec.summarize(fields, envelope.data), outcome: 'ok', errorCode: null };
  }
  // `ordered: true` stops at the first failing document, so a failed
  // insertMany can still have changed the collection. The error carries how
  // many landed; anything above zero is a partial, not a plain failure.
  const insertedCount = spec.op === 'insertMany' ? count(envelope.error.details, 'insertedCount') : undefined;
  if (insertedCount !== undefined) {
    return {
      ...target,
      summary: { op: 'insertMany', insertedCount },
      outcome: insertedCount > 0 ? 'partial' : 'error',
      errorCode: envelope.error.code,
    };
  }
  return { ...target, summary: spec.summarize(fields, undefined), outcome: 'error', errorCode: envelope.error.code };
}
