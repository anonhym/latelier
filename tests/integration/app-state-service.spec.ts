import { describe, it, expect, afterEach } from 'vitest';
import { AppStateRepo } from '../../electron/db/repositories/AppStateRepo';
import { AppStateService } from '../../electron/services/AppStateService';
import { createTempDb, type TempDb } from '../helpers/db';

describe('AppStateService', () => {
  let tmp: TempDb | null = null;

  afterEach(() => {
    tmp?.cleanup();
    tmp = null;
  });

  function svc() {
    tmp = createTempDb();
    return { service: new AppStateService(new AppStateRepo(tmp.db)), tmp };
  }

  it('set/get/delete round-trips and surfaces an updated_at bump', () => {
    const { service, tmp: t } = svc();
    service.set('k', { hello: 'world' });
    expect(service.get<{ hello: string }>('k')).toEqual({ hello: 'world' });

    const before = t.db.prepare('SELECT updated_at FROM app_state WHERE key = ?').get('k') as {
      updated_at: string;
    };
    service.set('k', { hello: 'updated' });
    const after = t.db.prepare('SELECT updated_at FROM app_state WHERE key = ?').get('k') as {
      updated_at: string;
    };
    expect(new Date(after.updated_at).getTime()).toBeGreaterThanOrEqual(
      new Date(before.updated_at).getTime(),
    );

    service.delete('k');
    expect(service.get('k')).toBeNull();
  });

  it('caches reads after the first hit', () => {
    const { service, tmp: t } = svc();
    service.set('cached', 'first');
    expect(service.get('cached')).toBe('first');
    // Mutate the underlying row out from under the cache.
    t.db
      .prepare("UPDATE app_state SET value_json = '\"second\"' WHERE key = 'cached'")
      .run();
    expect(service.get('cached')).toBe('first');
  });

  it('notifies subscribers on set and delete', () => {
    const { service } = svc();
    const events: Array<unknown> = [];
    const off = service.subscribe('theme.mode', (v) => events.push(v));
    service.set('theme.mode', 'dark');
    service.set('theme.mode', 'light');
    service.delete('theme.mode');
    off();
    service.set('theme.mode', 'system');
    expect(events).toEqual(['dark', 'light', null]);
  });
});
