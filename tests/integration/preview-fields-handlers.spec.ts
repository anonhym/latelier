import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type { IpcMainInvokeEvent } from 'electron';
import { IPC_CHANNELS, type Envelope } from '@shared/ipc';
import type { PreviewFields } from '@shared/types';
import { createRouter } from '../../electron/ipc/router';
import { registerPrefsChannels } from '../../electron/ipc/handlers/prefs';
import { AppStateRepo } from '../../electron/db/repositories/AppStateRepo';
import { AppStateService } from '../../electron/services/AppStateService';
import { PreviewFieldsRepo } from '../../electron/db/repositories/PreviewFieldsRepo';
import { PreviewFieldsService } from '../../electron/services/PreviewFieldsService';
import { createTempDb, type TempDb } from '../helpers/db';
import { invokeEvent, testSenderCheck } from '../helpers/ipcSender';

type Handler = (evt: IpcMainInvokeEvent, payload: unknown) => unknown;


const CONNECTION_ID = 'conn-1';
const DB_NAME = 'mydb';
const COLLECTION = 'users';

function ipcShim() {
  const handlers = new Map<string, Handler>();
  return {
    ipcMain: { handle: (ch: string, fn: Handler) => handlers.set(ch, fn) },
    has: (ch: string) => handlers.has(ch),
    invoke: async <T>(ch: string, payload?: unknown): Promise<Envelope<T>> => {
      const h = handlers.get(ch);
      // Deliberately the same failure the renderer would see if these
      // channels were registered conditionally and the service went missing.
      if (!h) throw new Error(`no handler for ${ch}`);
      return (await h(invokeEvent, payload)) as Envelope<T>;
    },
  };
}

/**
 * Router-level coverage for prefs:getPreviewFields / prefs:setPreviewFields —
 * the repo (`preview-fields-repo.spec.ts`) and service
 * (`preview-fields-service.spec.ts`) layers were already covered; the router
 * layer was not, so zod validation and the AppError → IpcError mapping for
 * these two channels went unexercised.
 *
 * This is also what makes the router registration self-defending. Making `previewSvc` a required
 * parameter means `tsc` rejects a dropped argument, but the type system is the
 * *only* thing enforcing it — re-introducing an `if (previewSvc)` guard would
 * silently unregister both channels again with every type still valid. The
 * first test below asserts that runtime invariant directly and fails if the
 * guard comes back (mutation-verified).
 */
describe('preview-fields handlers (router)', () => {
  let tmp: TempDb;
  let shim: ReturnType<typeof ipcShim>;

  beforeEach(() => {
    tmp = createTempDb();
    tmp.db.prepare(`
      INSERT INTO connections (
        id, name, color, connection_type, host, port,
        auth_mech, tls_enabled, tls_verify, ssh_enabled,
        connect_timeout_ms, socket_timeout_ms, server_selection_timeout_ms,
        read_preference, max_pool_size, direct_connection,
        created_at, updated_at
      ) VALUES (
        ?, 'Test', '#1A6835', 'standard', 'localhost', 27017,
        'none', 1, 1, 0,
        10000, 30000, 30000,
        'primary', 100, 0,
        ?, ?
      )
    `).run(CONNECTION_ID, new Date().toISOString(), new Date().toISOString());

    const wc = { send: vi.fn(), isDestroyed: () => false };
    shim = ipcShim();
    registerPrefsChannels(
      createRouter(shim.ipcMain, testSenderCheck),
      new AppStateService(new AppStateRepo(tmp.db)),
      () => wc as never,
      new PreviewFieldsService(new PreviewFieldsRepo(tmp.db)),
    );
  });

  afterEach(() => {
    tmp.cleanup();
  });

  it('registers both preview-field channels even when the service is missing', () => {
    // Deliberately subverts the type to call with the argument dropped — the
    // exact mistake `previewSvc: PreviewFieldsService` makes uncompilable.
    // `tsc` is the primary guard, but it is a *compile-time* one: someone
    // re-introducing an `if (previewSvc)` block would silently unregister
    // both channels again and every type stays valid. This asserts the
    // runtime invariant directly — registration must not depend on the
    // service being present, because `IpcApi` promises these two channels
    // unconditionally and the renderer calls them.
    const bare = ipcShim();
    (registerPrefsChannels as unknown as (...args: unknown[]) => void)(
      createRouter(bare.ipcMain, testSenderCheck),
      new AppStateService(new AppStateRepo(tmp.db)),
      () => null,
    );

    expect(bare.has(IPC_CHANNELS.prefsGetPreviewFields)).toBe(true);
    expect(bare.has(IPC_CHANNELS.prefsSetPreviewFields)).toBe(true);
  });

  it('get returns null through the router when nothing is stored', async () => {
    const env = await shim.invoke<PreviewFields | null>(IPC_CHANNELS.prefsGetPreviewFields, {
      connectionId: CONNECTION_ID,
      dbName: DB_NAME,
      collection: COLLECTION,
    });

    expect(env.ok).toBe(true);
    if (env.ok) expect(env.data).toBeNull();
  });

  it('set then get round-trips the field list through the router', async () => {
    const set = await shim.invoke<PreviewFields>(IPC_CHANNELS.prefsSetPreviewFields, {
      connectionId: CONNECTION_ID,
      dbName: DB_NAME,
      collection: COLLECTION,
      fields: ['name', 'email'],
    });
    expect(set.ok).toBe(true);

    const got = await shim.invoke<PreviewFields | null>(IPC_CHANNELS.prefsGetPreviewFields, {
      connectionId: CONNECTION_ID,
      dbName: DB_NAME,
      collection: COLLECTION,
    });

    expect(got.ok).toBe(true);
    if (got.ok) expect(got.data?.fields).toEqual(['name', 'email']);
  });

  it('rejects a malformed payload with a VALIDATION envelope, not a throw', async () => {
    // `fields` must be string[]; the router must map the zod failure to an
    // envelope rather than letting it escape as a raw rejection.
    const env = await shim.invoke(IPC_CHANNELS.prefsSetPreviewFields, {
      connectionId: CONNECTION_ID,
      dbName: DB_NAME,
      collection: COLLECTION,
      fields: 'name',
    });

    expect(env.ok).toBe(false);
    if (!env.ok) {
      expect(env.error.code).toBe('VALIDATION');
      expect((env.error as unknown as Record<string, unknown>).stack).toBeUndefined();
    }
  });
});
