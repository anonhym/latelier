import type { MongoTopology } from '@shared/types';

/**
 * Hello-command response shape. We only consume the fields that identify the
 * deployment — the driver returns dozens more. `isMaster` (the pre-4.4 alias)
 * returns the same fields plus a legacy `ismaster` boolean in place of
 * `isWritablePrimary`.
 */
export interface HelloResponse {
  ok?: number;
  setName?: string;
  /** Present and true on a replica-set member that has no valid config yet. */
  isreplicaset?: boolean;
  hosts?: string[];
  primary?: string;
  me?: string;
  msg?: string;            // 'isdbgrid' on a mongos
  isWritablePrimary?: boolean;
  ismaster?: boolean;      // legacy field on isMaster responses (Mongo < 4.4)
  secondary?: boolean;
  arbiterOnly?: boolean;
  maxWireVersion?: number;
}

/**
 * Deployment kind a `hello` reply describes. The driver hides its own topology
 * type behind internals (and freezes it to Single under `directConnection`), so
 * the reply is the only source that works for every connection.
 *
 * Replica-set members all carry `setName` whatever their role — primary,
 * secondary, arbiter, hidden, passive, config server — so one check covers them.
 * A mongos is told apart by `msg: 'isdbgrid'`. A load-balanced deployment
 * fronts mongos routers, so it should classify as Sharded too (not checked
 * against a real balancer; the app cannot build a `loadBalanced` URI today).
 * `null` is a hello that failed.
 */
export function topologyFromHello(hello: HelloResponse | null): MongoTopology {
  if (!hello || hello.ok !== 1) return 'Unknown';
  if (hello.msg === 'isdbgrid') return 'Sharded';
  if ((typeof hello.setName === 'string' && hello.setName.length > 0) || hello.isreplicaset === true) {
    return 'ReplicaSet';
  }
  if (hello.isWritablePrimary === true || hello.ismaster === true) return 'Single';
  return 'Unknown';
}
