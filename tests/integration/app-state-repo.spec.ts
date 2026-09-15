import { describe, it, expect, afterEach } from 'vitest';
import { AppStateRepo } from '../../electron/db/repositories/AppStateRepo';
import { createTempDb, type TempDb } from '../helpers/db';

describe('AppStateRepo', () => {
  let tmp: TempDb | null = null;

  afterEach(() => {
    tmp?.cleanup();
    tmp = null;
  });

  it('set/get round-trips JSON-encoded values', () => {
    tmp = createTempDb();
    const repo = new AppStateRepo(tmp.db);
    repo.set('theme.mode', 'dark');
    repo.set('window.bounds', { x: 10, y: 20, width: 800, height: 600 });

    expect(repo.get<string>('theme.mode')).toBe('dark');
    expect(repo.get<{ width: number }>('window.bounds')).toEqual({
      x: 10,
      y: 20,
      width: 800,
      height: 600,
    });
  });

  it('get returns null for missing keys', () => {
    tmp = createTempDb();
    const repo = new AppStateRepo(tmp.db);
    expect(repo.get('missing')).toBeNull();
  });

  it('set upserts in place', () => {
    tmp = createTempDb();
    const repo = new AppStateRepo(tmp.db);
    repo.set('k', 1);
    repo.set('k', 2);
    expect(repo.get('k')).toBe(2);

    const count = (tmp.db.prepare('SELECT COUNT(*) AS c FROM app_state WHERE key = ?').get('k') as {
      c: number;
    }).c;
    expect(count).toBe(1);
  });

  it('delete removes a key', () => {
    tmp = createTempDb();
    const repo = new AppStateRepo(tmp.db);
    repo.set('k', 'v');
    repo.delete('k');
    expect(repo.get('k')).toBeNull();
  });
});
