import { describe, expect, it } from 'vitest';
import { locationModel, mostRecentlyConnected } from '../../src/pages/Workspace/locationModel';
import type { CollectionTab, ConnectionSummary, ScriptTab } from '@shared/types';

const conn = (id: string, over: Partial<ConnectionSummary> = {}): ConnectionSummary => ({
  id,
  name: id.toUpperCase(),
  color: '#000',
  host: 'localhost',
  port: 27017,
  connectionType: 'standalone',
  status: 'connected',
  readOnly: false,
  ...over,
});

const coll = (connectionId: string): CollectionTab =>
  ({ id: 't', kind: 'collection', connectionId, dbName: 'shop', collection: 'orders', state: {} }) as CollectionTab;

const script = (connectionId: string, title: string): ScriptTab =>
  ({ id: 's', kind: 'script', connectionId, state: { title } }) as unknown as ScriptTab;

describe('mostRecentlyConnected', () => {
  it('is null when nothing is connected', () => {
    expect(mostRecentlyConnected([])).toBeNull();
    expect(mostRecentlyConnected([conn('a', { status: 'unknown' }), conn('b', { status: 'connecting' })])).toBeNull();
  });

  it('picks the latest connect time among the connected', () => {
    const list = [
      conn('a', { connectedAt: '2026-11-13T10:00:00.000Z' }),
      conn('b', { connectedAt: '2026-11-13T12:00:00.000Z' }),
      conn('c', { connectedAt: '2026-11-13T11:00:00.000Z' }),
      // Later, but no longer connected.
      conn('d', { status: 'error', connectedAt: '2026-11-13T13:00:00.000Z' }),
    ];
    expect(mostRecentlyConnected(list)?.id).toBe('b');
  });

  it('prefers a timed Connection over an untimed one, and the first on a tie', () => {
    expect(mostRecentlyConnected([conn('a'), conn('b', { connectedAt: '2026-11-13T10:00:00.000Z' })])?.id).toBe('b');
    expect(mostRecentlyConnected([conn('a', { connectedAt: '2026-11-13T10:00:00.000Z' }), conn('b')])?.id).toBe('a');
    expect(mostRecentlyConnected([conn('a'), conn('b')])?.id).toBe('a');
  });
});

describe('locationModel', () => {
  it('draws nothing when no Connection is saved', () => {
    expect(locationModel(null, [])).toBeNull();
    expect(locationModel(coll('a'), [])).toBeNull();
  });

  it('reads connection, database, collection for a collection tab', () => {
    const a = conn('a');
    expect(locationModel(coll('a'), [conn('z'), a])).toEqual({
      connection: a,
      segments: [
        { kind: 'database', label: 'shop' },
        { kind: 'collection', label: 'orders' },
      ],
    });
  });

  it('reads connection and tab label for a script tab', () => {
    const a = conn('a', { status: 'unknown' });
    expect(locationModel(script('a', 'Script 2'), [a])).toEqual({
      connection: a,
      segments: [{ kind: 'script', label: 'Script 2' }],
    });
  });

  it('names the most recently connected Connection when no tab is open', () => {
    const b = conn('b', { connectedAt: '2026-11-13T12:00:00.000Z' });
    expect(locationModel(null, [conn('a', { connectedAt: '2026-11-13T10:00:00.000Z' }), b])).toEqual({
      connection: b,
      segments: [{ kind: 'choose', label: 'Choose a collection…' }],
    });
  });

  it('has no subject and no further segment when nothing is open', () => {
    expect(locationModel(null, [conn('a', { status: 'unknown' })])).toEqual({ connection: null, segments: [] });
  });

  it('keeps the tab segments when the tab names a Connection that is not in the list', () => {
    expect(locationModel(coll('gone'), [conn('a')])).toEqual({
      connection: null,
      segments: [
        { kind: 'database', label: 'shop' },
        { kind: 'collection', label: 'orders' },
      ],
    });
  });
});
