import { createReadStream } from 'node:fs';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createInterface } from 'node:readline';
import { MongoBulkWriteError, type Collection, type Db, type Document } from 'mongodb';
import type { DataImportInput, ImportFormat, ImportReport } from '@shared/types';
import { AppError, NotFoundError, SystemError, ValidationError } from '../errors.ts';
import { DEFAULT_MAX_EJSON_BYTES } from './ejson.ts';
import { classifyMongoOpError } from './errors.ts';
import {
  emptyReport,
  extensionFormat,
  parseJsonArray,
  parseJsonlLine,
  recordFailure,
  sniffFormat,
  type ImportRecord,
} from './importParse.ts';
import type { MongoPool } from './MongoPool.ts';
import { QUERY_TIMEOUT_MS } from './timeouts.ts';

const DEFAULT_BATCH_SIZE = 1000;

// Filesystem failures are not driver errors, so they must never reach
// `classifyMongoOpError` and come back labelled MONGO_ERROR.
function fileError(action: string, err: unknown, details?: Record<string, unknown>): SystemError {
  return new SystemError('INTERNAL', `failed to ${action} import file: ${(err as Error).message}`, details);
}

async function sniffFile(filePath: string): Promise<ImportFormat> {
  const stream = createReadStream(filePath, { encoding: 'utf8' });
  try {
    for await (const chunk of stream) {
      const format = sniffFormat(chunk as string);
      if (format) return format;
    }
  } catch (err) {
    throw fileError('read', err);
  } finally {
    stream.destroy();
  }
  // Empty or whitespace only: as JSONL it is simply no documents.
  return 'jsonl';
}

async function* jsonlRecords(filePath: string): AsyncGenerator<ImportRecord> {
  const lines = createInterface({
    input: createReadStream(filePath, { encoding: 'utf8' }),
    crlfDelay: Infinity,
  });
  let lineNo = 0;
  for await (const line of lines) {
    // Counted before the blank check, so a reported line number is the
    // editor's line number.
    lineNo++;
    const record = parseJsonlLine(line, lineNo);
    if (record) yield record;
  }
}

/**
 * Imports a JSON array or JSONL file into an existing collection. Parses in
 * main and inserts unordered in batches, so a malformed line or a rejected
 * document is counted in the report rather than stopping the import. An error
 * that does stop it part-way carries `insertedCount` in its details, which is
 * what records the audit row as `partial`.
 */
export class ImportService {
  private pool: MongoPool;
  private maxArrayBytes: number;
  private batchSize: number;

  constructor(pool: MongoPool, opts: { maxArrayBytes?: number; batchSize?: number } = {}) {
    this.pool = pool;
    this.maxArrayBytes = opts.maxArrayBytes ?? DEFAULT_MAX_EJSON_BYTES;
    this.batchSize = opts.batchSize ?? DEFAULT_BATCH_SIZE;
  }

  async importFile(input: DataImportInput): Promise<ImportReport> {
    // First, before the file is touched: refuses a read-only connection.
    const w = this.pool.write(input.connectionId);
    const { format, size } = await this.checkFile(input.path);
    if (format === 'json' && size > this.maxArrayBytes) {
      throw new ValidationError(
        `a JSON array file over ${this.maxArrayBytes} bytes cannot be imported — convert it to JSONL, which is read line by line`,
        { size, maxBytes: this.maxArrayBytes },
      );
    }
    const db = await w.db(input.dbName);
    await this.assertCollection(db, input);
    const coll = db.collection(input.collection);
    const report = emptyReport(path.basename(input.path), format);

    let records: Iterable<ImportRecord> | AsyncIterable<ImportRecord>;
    if (format === 'json') {
      let text: string;
      try {
        text = await fs.readFile(input.path, 'utf8');
      } catch (err) {
        throw fileError('read', err);
      }
      records = parseJsonArray(text);
    } else {
      records = jsonlRecords(input.path);
    }

    let batch: { at: number; doc: Record<string, unknown> }[] = [];
    try {
      for await (const record of records) {
        if ('error' in record) {
          recordFailure(report, record.at, record.error);
          continue;
        }
        batch.push(record);
        if (batch.length >= this.batchSize) {
          await this.insertBatch(coll, batch, report);
          batch = [];
        }
      }
      if (batch.length > 0) await this.insertBatch(coll, batch, report);
    } catch (err) {
      // `insertBatch` has already classified its own errors; what is left is
      // the JSONL stream failing to read part-way.
      if (err instanceof AppError) throw err;
      throw fileError('read', err, { insertedCount: report.inserted });
    }
    return report;
  }

  /** Re-checks the path the renderer sent: absolute, an allowed extension, a regular file. */
  private async checkFile(filePath: string): Promise<{ format: ImportFormat; size: number }> {
    if (!path.isAbsolute(filePath)) {
      throw new ValidationError('import path must be absolute', { field: 'path' });
    }
    const byExtension = extensionFormat(filePath);
    if (byExtension === undefined) {
      throw new ValidationError('only .json, .jsonl and .ndjson files can be imported', { field: 'path' });
    }
    let stat;
    try {
      stat = await fs.stat(filePath);
    } catch (err) {
      throw fileError('open', err);
    }
    if (!stat.isFile()) {
      throw new ValidationError(`${path.basename(filePath)} is not a file`, { field: 'path' });
    }
    const format = byExtension === 'sniff' ? await sniffFile(filePath) : byExtension;
    return { format, size: stat.size };
  }

  private async assertCollection(db: Db, input: DataImportInput): Promise<void> {
    let found: Document[];
    try {
      found = await db.listCollections({ name: input.collection }).toArray();
    } catch (err) {
      throw classifyMongoOpError(err);
    }
    if (found.length === 0) {
      throw new NotFoundError(`collection ${input.dbName}.${input.collection} not found`);
    }
    if (found[0]!.type === 'view') {
      throw new ValidationError(`${input.collection} is a view — documents cannot be imported into it`);
    }
  }

  private async insertBatch(
    coll: Collection,
    batch: { at: number; doc: Record<string, unknown> }[],
    report: ImportReport,
  ): Promise<void> {
    try {
      const result = await coll.insertMany(batch.map((r) => r.doc), { ordered: false, maxTimeMS: QUERY_TIMEOUT_MS });
      report.inserted += result.insertedCount;
    } catch (err) {
      if (err instanceof MongoBulkWriteError) {
        const writeErrors = Array.isArray(err.writeErrors) ? err.writeErrors : [err.writeErrors];
        // Unordered: every document either landed or has a write error. When
        // the two don't add up to the batch, something beyond per-document
        // rejections went wrong, and the import stops.
        if (writeErrors.length > 0 && err.result.insertedCount + writeErrors.length === batch.length) {
          report.inserted += err.result.insertedCount;
          for (const e of writeErrors) recordFailure(report, batch[e.index]!.at, e.errmsg ?? `write error ${e.code}`);
          return;
        }
        report.inserted += err.result.insertedCount;
      }
      throw classifyMongoOpError(err, { insertedCount: report.inserted });
    }
  }
}
