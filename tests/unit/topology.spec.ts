import { describe, it, expect } from 'vitest';
import { topologyFromHello, type HelloResponse } from '../../electron/mongo/topology';

// Fixtures keep the discriminating fields of real `hello` / `isMaster` replies
// (the dozens of limits and timestamps the server also sends are irrelevant).
const standalone: HelloResponse = {
  isWritablePrimary: true,
  maxWireVersion: 21,
  ok: 1,
};

const rsPrimary: HelloResponse = {
  setName: 'rs0',
  hosts: ['a:27017', 'b:27017', 'c:27017'],
  primary: 'a:27017',
  me: 'a:27017',
  isWritablePrimary: true,
  secondary: false,
  ok: 1,
};

const rsSecondary: HelloResponse = {
  setName: 'rs0',
  hosts: ['a:27017', 'b:27017', 'c:27017'],
  primary: 'a:27017',
  me: 'b:27017',
  isWritablePrimary: false,
  secondary: true,
  ok: 1,
};

describe('topologyFromHello', () => {
  it.each<[string, HelloResponse, string]>([
    ['standalone', standalone, 'Single'],
    ['pre-4.4 standalone (isMaster reply, legacy ismaster field)', { ismaster: true, ok: 1 }, 'Single'],
    ['replica set primary', rsPrimary, 'ReplicaSet'],
    ['replica set secondary', rsSecondary, 'ReplicaSet'],
    [
      'replica set arbiter',
      { setName: 'rs0', hosts: ['a:27017'], arbiters: ['c:27017'], isWritablePrimary: false, secondary: false, arbiterOnly: true, ok: 1 } as HelloResponse,
      'ReplicaSet',
    ],
    [
      'hidden member',
      { ...rsSecondary, hidden: true } as HelloResponse,
      'ReplicaSet',
    ],
    [
      'passive (priority 0) member',
      { ...rsSecondary, passive: true } as HelloResponse,
      'ReplicaSet',
    ],
    [
      'replica set config server',
      { ...rsPrimary, configsvr: 2 } as HelloResponse,
      'ReplicaSet',
    ],
    [
      'pre-4.4 replica set primary (isMaster reply)',
      { setName: 'rs0', ismaster: true, secondary: false, ok: 1 },
      'ReplicaSet',
    ],
    [
      'replica set member without a valid config yet',
      { isWritablePrimary: false, secondary: false, isreplicaset: true, ok: 1 },
      'ReplicaSet',
    ],
    ['mongos', { isWritablePrimary: true, msg: 'isdbgrid', maxWireVersion: 21, ok: 1 }, 'Sharded'],
    [
      'load-balanced connection (assumed to reach a mongos; hand-built reply with a serviceId)',
      { isWritablePrimary: true, msg: 'isdbgrid', serviceId: '66f000000000000000000001', ok: 1 } as HelloResponse,
      'Sharded',
    ],
  ])('%s', (_name, hello, expected) => {
    expect(topologyFromHello(hello)).toBe(expected);
  });

  it.each<[string, HelloResponse | null]>([
    ['a hello that failed or timed out (null)', null],
    ['an empty document', {}],
    ['a reply with ok: 0', { ok: 0, isWritablePrimary: true, setName: 'rs0' }],
    ['a reply without ok', { isWritablePrimary: true }],
    ['ok: 2 (anything but exactly 1)', { ok: 2, isWritablePrimary: true }],
    ['a server that is neither writable nor in a replica set', { ok: 1, isWritablePrimary: false }],
    ['a reply with no role fields at all', { ok: 1 }],
  ])('is Unknown for %s', (_name, hello) => {
    expect(topologyFromHello(hello)).toBe('Unknown');
  });

  it('does not treat an empty setName as a replica set', () => {
    expect(topologyFromHello({ ...standalone, setName: '' })).toBe('Single');
  });

  it('ignores a setName that is not a string', () => {
    expect(topologyFromHello({ ...standalone, setName: 42 as unknown as string })).toBe('Single');
  });

  it('ignores isreplicaset unless it is exactly true', () => {
    expect(topologyFromHello({ ...standalone, isreplicaset: false })).toBe('Single');
    expect(topologyFromHello({ ...standalone, isreplicaset: 1 as unknown as boolean })).toBe('Single');
  });

  it('ignores ismaster and isWritablePrimary unless they are exactly true', () => {
    expect(topologyFromHello({ ok: 1, isWritablePrimary: 1 as unknown as boolean })).toBe('Unknown');
    expect(topologyFromHello({ ok: 1, ismaster: 1 as unknown as boolean })).toBe('Unknown');
  });

  it('prefers Sharded over a replica-set marker (a mongos never carries setName; order is msg first)', () => {
    expect(topologyFromHello({ ...standalone, msg: 'isdbgrid', setName: 'rs0' })).toBe('Sharded');
  });

  it('ignores a msg other than isdbgrid', () => {
    expect(topologyFromHello({ ...standalone, msg: 'something else' })).toBe('Single');
  });
});
