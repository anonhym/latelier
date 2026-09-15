import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { PreviewFieldsRepo } from '../../electron/db/repositories/PreviewFieldsRepo';
import { createTempDb, type TempDb } from '../helpers/db';

const CONNECTION_ID = 'conn-1';
const DB_NAME = 'mydb';
const COLLECTION = 'users';

describe('PreviewFieldsRepo', () => {
  let tmp: TempDb;
  let repo: PreviewFieldsRepo;

  beforeEach(() => {
    tmp = createTempDb();
    // Insert a real connection row so FK constraint passes
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

    repo = new PreviewFieldsRepo(tmp.db);
  });

  afterEach(() => {
    tmp.cleanup();
  });

  it('get returns null when no entry exists', () => {
    const result = repo.get(CONNECTION_ID, DB_NAME, COLLECTION);
    expect(result).toBeNull();
  });

  it('set creates a new entry and get returns it', () => {
    const fields = ['name', 'email', 'createdAt'];
    const result = repo.set(CONNECTION_ID, DB_NAME, COLLECTION, fields);

    expect(result.connectionId).toBe(CONNECTION_ID);
    expect(result.dbName).toBe(DB_NAME);
    expect(result.collection).toBe(COLLECTION);
    expect(result.fields).toEqual(fields);
    expect(result.updatedAt).toBeTruthy();

    const fetched = repo.get(CONNECTION_ID, DB_NAME, COLLECTION);
    expect(fetched).not.toBeNull();
    expect(fetched!.fields).toEqual(fields);
  });

  it('set upserts on second call', () => {
    const fields1 = ['name', 'email'];
    const fields2 = ['name', 'status', 'role'];

    repo.set(CONNECTION_ID, DB_NAME, COLLECTION, fields1);
    repo.set(CONNECTION_ID, DB_NAME, COLLECTION, fields2);

    const fetched = repo.get(CONNECTION_ID, DB_NAME, COLLECTION);
    expect(fetched!.fields).toEqual(fields2);
  });

  it('different collections have independent entries', () => {
    repo.set(CONNECTION_ID, DB_NAME, 'colA', ['a', 'b']);
    repo.set(CONNECTION_ID, DB_NAME, 'colB', ['x', 'y', 'z']);

    expect(repo.get(CONNECTION_ID, DB_NAME, 'colA')!.fields).toEqual(['a', 'b']);
    expect(repo.get(CONNECTION_ID, DB_NAME, 'colB')!.fields).toEqual(['x', 'y', 'z']);
  });

  it('get with unknown collection returns null', () => {
    repo.set(CONNECTION_ID, DB_NAME, COLLECTION, ['name']);
    expect(repo.get(CONNECTION_ID, DB_NAME, 'nonexistent')).toBeNull();
  });

  it('set with empty fields persists empty array', () => {
    const result = repo.set(CONNECTION_ID, DB_NAME, COLLECTION, []);
    expect(result.fields).toEqual([]);

    const fetched = repo.get(CONNECTION_ID, DB_NAME, COLLECTION);
    expect(fetched!.fields).toEqual([]);
  });
});
