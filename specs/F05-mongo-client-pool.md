# F05 — Mongo client pool & lifecycle

## Purpose

Maintain at most one live `MongoClient` per saved connection for the lifetime of the app, hide the details of URI construction (including secrets) from callers, and expose simple connect/disconnect/ping semantics.

## Scope

- **In**: `MongoPool` service (map of `connectionId → MongoClient`), URI assembly from Connection row + secrets, connection status tracking, graceful shutdown.
- **Out**: Actual query/aggregation methods (they live in `QueryService` W03 and `AggregationService` A04 and use this pool). SSH tunneling (deferred).

## Dependencies

- F01, F02, F03, C01 (connection model), C02 (connection repo).
- `mongodb` npm package.

## 1. Responsibilities

`MongoPool` is the only place that:
- Imports `mongodb`.
- Holds `MongoClient` instances.
- Reads secrets via `SecretsVault`.
- Assembles a `mongodb+srv://` or `mongodb://` URI.
- Knows how to apply timeouts, pool size, read preference, TLS options.

Everything else depends on `MongoPool.getDb(connectionId)` or `getClient(connectionId)`.

## 2. Public API

```ts
// electron/mongo/MongoPool.ts
import type { Db, MongoClient, MongoClientOptions } from 'mongodb';

export type ConnectionStatus = 'disconnected' | 'connecting' | 'connected' | 'error';

export interface ConnectionRuntime {
  id: string;
  status: ConnectionStatus;
  errorMessage?: string;
  connectedAt?: string;  // ISO
  serverVersion?: string;
  topology?: 'Single' | 'ReplicaSet' | 'Sharded' | 'Unknown';
}

export class MongoPool {
  constructor(
    private repo: ConnectionRepo,
    private vault: SecretsVault,
    private log: Logger,
  );

  /** Lazily connects if needed. Returns client or throws. */
  getClient(connectionId: string): Promise<MongoClient>;

  /** Convenience: getClient().db(dbName ?? default_db). */
  getDb(connectionId: string, dbName?: string): Promise<Db>;

  /** Current status snapshot — never throws. */
  status(connectionId: string): ConnectionRuntime;

  /** Forces a connect attempt, even if already connecting. */
  connect(connectionId: string): Promise<ConnectionRuntime>;

  /** Closes the client if open. */
  disconnect(connectionId: string): Promise<void>;

  /** Closes everything — called on app shutdown (F06). */
  disconnectAll(): Promise<void>;

  /** Issues a `{ ping: 1 }` and returns round-trip ms. Used by Overview tab (C06). */
  ping(connectionId: string): Promise<number>;

  /** Fetches serverStatus + buildInfo for the Overview tab. */
  serverInfo(connectionId: string): Promise<ServerInfo>;

  /** Validates a transient connection without persisting anything. Used by Test (C04). */
  probe(input: ConnectionInput): Promise<ProbeResult>;
}

export interface ServerInfo {
  version: string;
  uptimeSeconds: number;
  connectionsCurrent: number;
  connectionsAvailable: number;
  opcountersPerSec: number;
  latencyP99Ms?: number;
  cacheHitRate?: number;
  databaseCount: number;
  dataSizeBytes: number;
  storageSizeBytes: number;
  indexCount: number;
  topology: 'Single' | 'ReplicaSet' | 'Sharded' | 'Unknown';
}

export interface ProbeResult {
  ok: boolean;
  serverVersion?: string;
  topology?: string;
  roundTripMs?: number;
  errorCode?: 'AUTH' | 'NETWORK' | 'TIMEOUT' | 'TLS' | 'UNKNOWN';
  errorMessage?: string;
}
```

## 3. URI assembly

Given a `Connection` row and decrypted secrets:

```ts
function buildUri(c: Connection, password?: string): string {
  const scheme = c.connection_type === 'srv' ? 'mongodb+srv' : 'mongodb';
  const userinfo = c.auth_mech === 'none' ? ''
    : `${encodeURIComponent(c.auth_username!)}${password ? ':' + encodeURIComponent(password) : ''}@`;
  const hostport = c.connection_type === 'srv'
    ? c.host                    // SRV cannot carry port
    : `${c.host}:${c.port}`;
  const path = c.default_db ? `/${encodeURIComponent(c.default_db)}` : '';
  const params = new URLSearchParams();
  if (c.auth_database) params.set('authSource', c.auth_database);
  if (c.auth_mech === 'scram256') params.set('authMechanism', 'SCRAM-SHA-256');
  if (c.auth_mech === 'scram1')   params.set('authMechanism', 'SCRAM-SHA-1');
  if (c.auth_mech === 'x509')     params.set('authMechanism', 'MONGODB-X509');
  if (c.auth_mech === 'awsiam')   params.set('authMechanism', 'MONGODB-AWS');
  if (c.read_preference)          params.set('readPreference', c.read_preference);
  if (c.app_name)                 params.set('appName', c.app_name);
  if (c.direct_connection)        params.set('directConnection', 'true');
  return `${scheme}://${userinfo}${hostport}${path}?${params}`;
}
```

`MongoClientOptions` carries the rest:
```ts
{
  connectTimeoutMS: c.connect_timeout_ms,
  socketTimeoutMS: c.socket_timeout_ms,
  serverSelectionTimeoutMS: c.server_selection_timeout_ms,
  maxPoolSize: c.max_pool_size,
  tls: c.tls_enabled,
  tlsAllowInvalidCertificates: !c.tls_verify,
  tlsCAFile: c.tls_ca_path || undefined,
  tlsCertificateKeyFile: c.tls_client_cert_path || undefined,
}
```

## 4. Lifecycle

### getClient
1. Look up entry in the internal `Map<string, Entry>`.
2. If `status === 'connected'`, return existing client.
3. If `status === 'connecting'`, await the shared promise.
4. Else set `status = 'connecting'`, build URI, decrypt password, `new MongoClient(...)`, `.connect()`.
5. On success → store, set `status = 'connected'`, record `serverVersion` and `topology`, resolve.
6. On failure → set `status = 'error'`, store `errorMessage`, reject all waiters, do not retain the client.
7. Subsequent `getClient` calls after an error re-attempt from step 4.

### probe
- Builds URI with a **separate** MongoClient with `serverSelectionTimeoutMS: 5000`, `connectTimeoutMS: 5000`.
- Connects, pings, reads `buildInfo`, closes.
- Classifies errors into `AUTH | NETWORK | TIMEOUT | TLS | UNKNOWN` (see §6).
- Used by both:
  - C04 **Test connection** — called with form data *before* save.
  - C02 `connect` IPC — called to warm the pool post-save (optional).

### disconnect / disconnectAll
- `await client.close()`. Remove from map. Set status `disconnected`.
- `disconnectAll` runs in parallel (`Promise.allSettled`) and logs any failures.

## 5. Events

`MongoPool` extends `EventEmitter`:
- `status` → `(runtime: ConnectionRuntime)` whenever a status changes.
- Used by main to push updates to the renderer via `mongo:status` channel (see F04 §6 push pattern).

## 6. Error classification

Mongo driver errors vary. Classifier:

| Condition                                                            | code        |
| -------------------------------------------------------------------- | ----------- |
| `err.code === 18` / message matches `AuthenticationFailed`           | `AUTH`      |
| `err.name === 'MongoServerSelectionError'`                           | `TIMEOUT`   |
| `err.message` matches `/ENOTFOUND|ECONNREFUSED|EAI_AGAIN/`           | `NETWORK`   |
| `err.message` matches `/SSL|TLS|certificate/i`                       | `TLS`       |
| default                                                              | `UNKNOWN`   |

Classifier lives in `electron/mongo/errors.ts` and has unit tests with fixture errors.

## 7. IPC surface owned by this spec

| Channel          | Input                 | Output                | Notes |
| ---------------- | --------------------- | --------------------- | ----- |
| `mongo:connect`  | `{ id }`              | `ConnectionRuntime`   | Warms pool |
| `mongo:disconnect` | `{ id }`            | `void`                | |
| `mongo:status`   | `{ id }`              | `ConnectionRuntime`   | Snapshot |
| `mongo:ping`     | `{ id }`              | `{ roundTripMs }`     | |
| `mongo:serverInfo` | `{ id }`            | `ServerInfo`          | Used by C06 Overview |
| `mongo:probe`    | `ConnectionInput`     | `ProbeResult`         | SECRET_INPUT, used by C04 |

`ConnectionInput` is defined in C01.

## 8. Graceful shutdown

- `app.on('before-quit', …)` calls `pool.disconnectAll()` with a 5-second total budget. Any client still open after 5s is abandoned (`unref`) and the app proceeds to quit.

## 9. Acceptance criteria

- [ ] At most one `MongoClient` exists per connection id across the app lifetime.
- [ ] `getClient` called concurrently for the same id only opens one underlying client.
- [ ] `disconnectAll` resolves within 5 seconds even if a client is unresponsive.
- [ ] `probe` never leaves a lingering client on failure or success.
- [ ] Status events fire exactly once per transition.

## 10. Test cases

### Unit
- **uri-builder.spec.ts**: table-driven tests for `buildUri` covering SRV, standard, with/without auth, URL-encoded special characters in password, SRV without port, default_db present/absent, app_name, directConnection.
- **error-classifier.spec.ts**: fixture errors → expected code.

### Integration (Vitest + `mongodb-memory-server`)
- **connect-once.spec.ts**: call `getClient` twice concurrently → only one `MongoClient` instantiation observed (spy on constructor).
- **reconnect-after-error.spec.ts**: first attempt fails (wrong URI) → status `error`. Repo updated with correct URI, second attempt succeeds.
- **probe.spec.ts**: successful probe returns `ok: true` with serverVersion; wrong password returns `ok: false`, `errorCode: 'AUTH'`.
- **disconnect-all-timeout.spec.ts**: inject a fake client whose `close` hangs; `disconnectAll` resolves within 5s.
- **ping.spec.ts**: returns a positive number; after disconnect throws.

### E2E
Covered indirectly by C04 and W03.
