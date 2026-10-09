import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { IPC_CHANNELS } from '@shared/ipc';
import { createRouter } from '../../electron/ipc/router';
import { registerSavedChannels } from '../../electron/ipc/handlers/saved';
import { registerTabsChannels } from '../../electron/ipc/handlers/tabs';
import { registerRecentChannels } from '../../electron/ipc/handlers/recent';
import { SavedQueryRepo } from '../../electron/db/repositories/SavedQueryRepo';
import { SavedQueryService } from '../../electron/services/SavedQueryService';
import { WorkspaceTabRepo } from '../../electron/db/repositories/WorkspaceTabRepo';
import { WorkspaceStateService } from '../../electron/services/WorkspaceStateService';
import { RecentQueryRepo } from '../../electron/db/repositories/RecentQueryRepo';
import { RecentQueryService } from '../../electron/services/RecentQueryService';
import { RecentFieldValueRepo } from '../../electron/db/repositories/RecentFieldValueRepo';
import { RecentFieldValueService } from '../../electron/services/RecentFieldValueService';
import { createTempDb, insertConnectionRow, type TempDb } from '../helpers/db';
import { createIpcShim } from '../helpers/ipcShim';
import { testSenderCheck } from '../helpers/ipcSender';

/**
 * Every table with a foreign key to `connections` that a channel can write
 * with a renderer-supplied `connectionId`. SQLite refuses the row, and the
 * repo has to turn that into the NOT_FOUND the pool and `conn:*` channels
 * already answer for an unknown connection, not let the raw
 * `FOREIGN KEY constraint failed` cross IPC as INTERNAL.
 *
 * `refs:create` is covered in refs-handlers.spec.ts. Not here, on purpose:
 * `recent_queries` rows are written after a run on a connection the pool
 * already resolved (fire-and-forget, never part of a reply), `audit_log`
 * rows by the router's audit sink (a failed write is logged and the envelope
 * stands), and `connection_secrets` only after `ConnectionService` has
 * loaded or inserted the connection row.
 */
const REAL = 'fk-real-conn';
const GHOST = 'fk-no-such-conn';

const FIND_PAYLOAD = {
  kind: 'find',
  builder: { projection: [], sort: '', limit: '' },
  queryRaw: '{}',
};

const cases: Array<{ channel: string; payload: (connectionId: string) => unknown }> = [
  {
    channel: IPC_CHANNELS.savedCreate,
    payload: (connectionId) => ({
      connectionId,
      dbName: 'd',
      collection: 'c',
      kind: 'find',
      name: 'q',
      payload: FIND_PAYLOAD,
    }),
  },
  {
    channel: IPC_CHANNELS.tabsOpenCollection,
    payload: (connectionId) => ({ connectionId, dbName: 'd', collection: 'c' }),
  },
  {
    channel: IPC_CHANNELS.tabsOpenAggregation,
    payload: (connectionId) => ({ connectionId, dbName: 'd', collection: 'c' }),
  },
  {
    channel: IPC_CHANNELS.tabsOpenDefault,
    payload: (connectionId) => ({ connectionId, dbName: 'd', collection: 'c' }),
  },
  {
    // The placeholder-tab branch: no db, no collection.
    channel: IPC_CHANNELS.tabsOpenDefault,
    payload: (connectionId) => ({ connectionId }),
  },
  {
    channel: IPC_CHANNELS.tabsOpenScript,
    payload: (connectionId) => ({ connectionId }),
  },
  {
    channel: IPC_CHANNELS.recentRecordFieldValues,
    payload: (connectionId) => ({
      connectionId,
      dbName: 'd',
      collection: 'c',
      entries: [{ field: 'name', value: 'x', valType: 'string', op: '$eq' }],
    }),
  },
];

describe('writes naming an unknown connection answer NOT_FOUND, not INTERNAL', () => {
  let tmp: TempDb;
  const shim = createIpcShim();

  beforeAll(() => {
    tmp = createTempDb();
    insertConnectionRow(tmp.db, REAL);
    const router = createRouter(shim.ipcMain, testSenderCheck);
    registerSavedChannels(router, new SavedQueryService(new SavedQueryRepo(tmp.db)));
    registerTabsChannels(router, new WorkspaceStateService(new WorkspaceTabRepo(tmp.db)));
    registerRecentChannels(
      router,
      new RecentQueryService(new RecentQueryRepo(tmp.db)),
      new RecentFieldValueService(new RecentFieldValueRepo(tmp.db)),
    );
  });

  afterAll(() => {
    tmp.cleanup();
  });

  const count = (table: string): number =>
    (tmp.db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get() as { n: number }).n;

  it.each(cases.map((c, i) => [`${c.channel} #${i}`, c] as const))(
    '%s',
    async (_name, { channel, payload }) => {
      const env = await shim.invoke(channel, payload(GHOST));
      expect(env.ok).toBe(false);
      if (env.ok) return;
      expect(env.error.code).toBe('NOT_FOUND');
      expect(env.error.message).toBe(`connection ${GHOST} not found`);
    },
  );

  it('stored nothing for the unknown connection', () => {
    expect(count('saved_queries')).toBe(0);
    expect(count('workspace_tabs')).toBe(0);
    expect(count('recent_field_values')).toBe(0);
  });

  // The control: the same payloads against a connection that exists succeed,
  // so the NOT_FOUND above is the foreign key and not a broken payload.
  it.each(cases.map((c, i) => [`${c.channel} #${i}`, c] as const))(
    'accepts the same payload for an existing connection: %s',
    async (_name, { channel, payload }) => {
      const env = await shim.invoke(channel, payload(REAL));
      expect(env.ok).toBe(true);
    },
  );
});
