import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { PreviewFieldsRepo } from '../../electron/db/repositories/PreviewFieldsRepo';
import { PreviewFieldsService } from '../../electron/services/PreviewFieldsService';
import { createTempDb, type TempDb } from '../helpers/db';

const CONNECTION_ID = 'conn-1';
const DB_NAME = 'mydb';
const COLLECTION = 'users';

/**
 * Regression test for P1-1: the prefs:getPreviewFields / prefs:setPreviewFields
 * handlers used to wire directly to the repo. They now go through
 * PreviewFieldsService — verify the service's get/set delegate correctly
 * (and that the repo's behavior is preserved through the wrapper).
 */
describe('PreviewFieldsService', () => {
  let tmp: TempDb;
  let svc: PreviewFieldsService;

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

    svc = new PreviewFieldsService(new PreviewFieldsRepo(tmp.db));
  });

  afterEach(() => {
    tmp.cleanup();
  });

  it('get returns null when no entry exists', () => {
    expect(svc.get(CONNECTION_ID, DB_NAME, COLLECTION)).toBeNull();
  });

  it('set then get round-trips a list of fields', () => {
    const fields = ['name', 'email', 'createdAt'];
    const written = svc.set(CONNECTION_ID, DB_NAME, COLLECTION, fields);

    expect(written.connectionId).toBe(CONNECTION_ID);
    expect(written.fields).toEqual(fields);

    const read = svc.get(CONNECTION_ID, DB_NAME, COLLECTION);
    expect(read?.fields).toEqual(fields);
  });
});
