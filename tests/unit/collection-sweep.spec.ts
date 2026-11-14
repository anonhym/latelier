import { describe, expect, it } from 'vitest';
import type { ConnectionSummary } from '@shared/types';
import { isSweepPending, sweepConnectionId } from '../../src/pages/Workspace/collectionSweep';
import { emptyCache, type ConnectionCache } from '../../src/pages/Workspace/navigatorTreeReducer';

const conn = (id: string, over: Partial<ConnectionSummary> = {}): ConnectionSummary => ({
  id,
  name: id,
  color: '#000',
  host: 'localhost',
  port: 27017,
  connectionType: 'standard',
  status: 'connected',
  readOnly: false,
  ...over,
});

const cache = (over: Partial<ConnectionCache>): ConnectionCache => ({ ...emptyCache(), ...over });
const db = (name: string) => ({ name }) as NonNullable<ConnectionCache['dbs']>[number];

describe('sweepConnectionId', () => {
  it('is the Focused Tab\'s Connection, whether or not it is open', () => {
    const all = [conn('a', { connectedAt: '2026-11-13T10:00:00Z' }), conn('b', { status: 'disconnected' })];
    expect(sweepConnectionId('b', all)).toBe('b');
  });

  it('is the most recently connected Open Connection when no tab is in front', () => {
    const all = [
      conn('a', { connectedAt: '2026-11-13T10:00:00Z' }),
      conn('b', { connectedAt: '2026-11-13T12:00:00Z' }),
      conn('c', { status: 'disconnected', connectedAt: '2026-11-13T13:00:00Z' }),
    ];
    expect(sweepConnectionId(null, all)).toBe('b');
  });

  it('is null with no tab and nothing open', () => {
    expect(sweepConnectionId(null, [conn('a', { status: 'disconnected' })])).toBeNull();
    expect(sweepConnectionId(null, [])).toBeNull();
  });
});

describe('isSweepPending', () => {
  it('waits while nothing is cached or the database list is on its way', () => {
    expect(isSweepPending(undefined)).toBe(true);
    expect(isSweepPending(cache({ dbsLoading: true }))).toBe(true);
    expect(isSweepPending(cache({}))).toBe(true);
  });

  it('is settled once the database list failed', () => {
    expect(isSweepPending(cache({ err: { code: 'NETWORK', message: 'no' } }))).toBe(false);
  });

  it('waits for a database never asked, or being listed', () => {
    expect(isSweepPending(cache({ dbs: [db('shop')] }))).toBe(true);
    expect(isSweepPending(cache({ dbs: [db('shop')], collsLoading: { shop: true } }))).toBe(true);
  });

  it('is settled when every database has its list, or its listing finished without one', () => {
    expect(isSweepPending(cache({ dbs: [], }))).toBe(false);
    expect(isSweepPending(cache({ dbs: [db('shop')], colls: { shop: [] }, collsLoading: { shop: false } }))).toBe(false);
    expect(isSweepPending(cache({ dbs: [db('shop')], collsLoading: { shop: false } }))).toBe(false);
  });

  it('keeps waiting for a later database while an earlier one is listed', () => {
    const c = cache({ dbs: [db('shop'), db('crm')], colls: { shop: [] }, collsLoading: { shop: false } });
    expect(isSweepPending(c)).toBe(true);
  });

  it('reads a database named like an Object property as its own', () => {
    expect(isSweepPending(cache({ dbs: [db('constructor')] }))).toBe(true);
  });
});
