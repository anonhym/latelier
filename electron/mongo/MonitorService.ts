import type {
  CurrentOpInput,
  CurrentOpSummary,
  ProfileLevel,
  ProfileStatus,
} from '@shared/types';
import type { MongoClient } from 'mongodb';
import { ejsonEncodeArray, ejsonStringifyDriverValue } from './ejson.ts';
import { classifyMongoOpError } from './errors.ts';
import type { MongoPool } from './MongoPool.ts';
import { STATS_TIMEOUT_MS } from './timeouts.ts';
import type { Logger } from '../log.ts';

const OPS_LIMIT = 200;
const COMMAND_MAX_CHARS = 2000;

interface RawOp {
  opid?: unknown;
  op?: string;
  ns?: string;
  secs_running?: number;
  client?: string;
  client_s?: string;
  desc?: string;
  planSummary?: string;
  command?: unknown;
}

/**
 * The Monitor tab (C06 §9): running operations, killOp and the database
 * profiler. Reads go over the pooled client; kill and set-level go through
 * `pool.write`, so a read-only connection refuses them (ADR 0005). None of
 * this changes a document, so none of it is audited (ADR 0002).
 */
export class MonitorService {
  private pool: MongoPool;
  private log: Logger | undefined;

  constructor(pool: MongoPool, log?: Logger) {
    this.pool = pool;
    this.log = log;
  }

  async currentOp(input: CurrentOpInput): Promise<{ ops: CurrentOpSummary[] }> {
    const client = await this.pool.readClient(input.connectionId);
    const match: Record<string, unknown> = {};
    if (input.activeOnly) match.active = true;
    if (input.minSecsRunning !== undefined && input.minSecsRunning > 0) {
      match.secs_running = { $gte: input.minSecsRunning };
    }
    try {
      const rows = (await client
        .db('admin')
        .aggregate(
          [
            { $currentOp: { allUsers: true, idleConnections: false } },
            { $match: match },
            { $sort: { secs_running: -1 } },
            { $limit: OPS_LIMIT },
          ],
          { maxTimeMS: STATS_TIMEOUT_MS },
        )
        .toArray()) as RawOp[];
      return { ops: rows.map(toOpSummary) };
    } catch (err) {
      throw classifyMongoOpError(err);
    }
  }

  /**
   * Over a control client of its own, like `AggregationService.killWrite`: on
   * the pooled client the kill would queue behind the very op it targets
   * whenever that op holds the pool's last connection.
   */
  async killOp(input: { connectionId: string; opid: string }): Promise<{ ok: true }> {
    // Refuses a read-only connection; the kill itself goes over the control client.
    this.pool.write(input.connectionId);
    let control: MongoClient | undefined;
    try {
      control = await this.pool.openControlClient(input.connectionId);
      await control
        .db('admin')
        .command({ killOp: 1, op: opidForKill(input.opid), maxTimeMS: STATS_TIMEOUT_MS });
      return { ok: true };
    } catch (err) {
      throw classifyMongoOpError(err);
    } finally {
      await control?.close().catch((err: unknown) => {
        this.log?.warn('mongo', 'closing the control client failed', {
          message: err instanceof Error ? err.message : String(err),
        });
      });
    }
  }

  async profileStatus(input: { connectionId: string; dbName: string }): Promise<ProfileStatus> {
    const client = await this.pool.readClient(input.connectionId);
    try {
      // `profile: -1` reads without changing; the current level comes back as `was`.
      const res = (await client
        .db(input.dbName)
        .command({ profile: -1, maxTimeMS: STATS_TIMEOUT_MS })) as { was: ProfileLevel; slowms: number };
      return { level: res.was, slowms: res.slowms };
    } catch (err) {
      throw classifyMongoOpError(err);
    }
  }

  async setProfileLevel(input: {
    connectionId: string;
    dbName: string;
    level: ProfileLevel;
    slowms?: number;
  }): Promise<{ ok: true }> {
    const w = this.pool.write(input.connectionId);
    const cmd: Record<string, unknown> = { profile: input.level, maxTimeMS: STATS_TIMEOUT_MS };
    if (input.slowms !== undefined) cmd.slowms = input.slowms;
    const client = await w.client();
    try {
      await client.db(input.dbName).command(cmd);
      return { ok: true };
    } catch (err) {
      throw classifyMongoOpError(err);
    }
  }

  async profileTail(input: {
    connectionId: string;
    dbName: string;
    limit?: number;
  }): Promise<{ docs: unknown[] }> {
    const client = await this.pool.readClient(input.connectionId);
    // The handler's schema caps `limit` at 100.
    const limit = input.limit ?? 50;
    try {
      const docs = await client
        .db(input.dbName)
        .collection('system.profile')
        .find({}, { sort: { ts: -1 }, limit, maxTimeMS: STATS_TIMEOUT_MS })
        .toArray();
      return { docs: ejsonEncodeArray(docs) };
    } catch (err) {
      throw classifyMongoOpError(err);
    }
  }
}

function toOpSummary(raw: RawOp): CurrentOpSummary {
  const command = ejsonStringifyDriverValue(raw.command ?? {});
  const out: CurrentOpSummary = {
    opid: String(raw.opid),
    op: raw.op ?? 'none',
    command: command.length > COMMAND_MAX_CHARS ? command.slice(0, COMMAND_MAX_CHARS) : command,
  };
  if (raw.ns) out.ns = raw.ns;
  if (raw.secs_running !== undefined) out.secsRunning = raw.secs_running;
  const client = raw.client ?? raw.client_s;
  if (client) out.client = client;
  if (raw.desc) out.desc = raw.desc;
  if (raw.planSummary) out.planSummary = raw.planSummary;
  return out;
}

/**
 * The opid as the server gave it: a number on mongod, a `"shard:id"` string on
 * mongos. `String()` of the former round-trips through this.
 */
export function opidForKill(opid: string): number | string {
  return /^-?\d+$/.test(opid) ? Number.parseInt(opid, 10) : opid;
}
