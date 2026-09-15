# C06 — Overview tab (real stats)

## Purpose

Replace the mocked server/storage/performance cards with real data drawn from the live Mongo server. Shows only metrics we can trust: MongoDB version, uptime, connection counts, DB count, data/storage size, index count, ops/sec, cache hit rate, topology.

## Scope

- **In**: `mongo:serverInfo` and `mongo:ping` IPC channels (F05), ServerInfo card rendering, loading/error states, manual refresh, auto-refresh cadence.
- **Out**: Connection CRUD (C02), collections table (C07).

## Dependencies

- C05 (selected connection), F05 (`MongoPool.serverInfo` and `ping`), F04 (event stream optional).

## 1. Data source

`MongoPool.serverInfo(id): Promise<ServerInfo>` (F05 §2) runs inside main:

```ts
const admin = (await pool.getClient(id)).db('admin');
const [buildInfo, serverStatus, listDbs] = await Promise.all([
  admin.command({ buildInfo: 1 }),
  admin.command({ serverStatus: 1 }),
  admin.command({ listDatabases: 1, nameOnly: false }),
]);
```

Derived fields:

| ServerInfo field       | Source |
| ---------------------- | ------ |
| `version`              | `buildInfo.version` |
| `uptimeSeconds`        | `serverStatus.uptime` |
| `connectionsCurrent`   | `serverStatus.connections.current` |
| `connectionsAvailable` | `serverStatus.connections.available` |
| `opcountersPerSec`     | delta of `serverStatus.opcounters` sum over 1s — see §2 |
| `latencyP99Ms`         | `serverStatus.opLatencies.reads.latency / ops` if available (else undefined) |
| `cacheHitRate`         | `wiredTiger.cache` ratios if available (else undefined) |
| `databaseCount`        | `listDbs.databases.length` |
| `dataSizeBytes`        | `listDbs.totalSize` |
| `storageSizeBytes`     | `sum over listDbs.databases[*].sizeOnDisk` |
| `indexCount`           | sum of per-collection `nindexes` across all databases; see §3 |
| `topology`             | from client topology description |

## 2. Ops/sec computation

`serverStatus` opcounters are cumulative. First call: record baseline and return `0`. Subsequent call: `(now - prev) / (seconds elapsed)`. Cache baseline per connection id in main.

## 3. Index count

Counting all indexes server-wide may be expensive on huge deployments. Heuristic:
- If `databaseCount > 50`, **do not** iterate collections; render `indexCount: null` and the UI shows "—".
- Else enumerate via `listCollections` + `collection.indexes()`; sum `length`.

This computation is async and may take seconds on large clusters. The Overview card renders a "Computing…" state for `indexCount` while the rest of the card is already filled.

## 4. IPC contract

Already declared in F05; restated:

| Channel             | Input    | Output        |
| ------------------- | -------- | ------------- |
| `mongo:serverInfo`  | `{id}`   | `ServerInfo`  |
| `mongo:ping`        | `{id}`   | `{ roundTripMs }` |

Errors surface as normal envelope failures.

## 5. UI

### Layout
Three cards (Server, Storage, Performance) in a flex-wrap row — same as mock. Each card shows 4–5 rows. A small Refresh button in the section's top-right. The whole Overview panel has a single "Last updated" timestamp above the cards.

### Loading / disconnected
- If `pool.status(id).status === 'connected'` and no ServerInfo cached yet → show a skeleton card (three rows per card, shimmering).
- If `status === 'connecting'`:
  - Render a centered card showing "Connecting…" and a **Cancel connection** button.
  - Clicking Cancel connection calls `api.mongo.disconnect(id)`, which force-closes the in-flight client; the pool's `catch` block only flips to `error` if status is still `connecting`, so a user-initiated cancel leaves the terminal status as `disconnected`, not `error`. The Overview tab transitions back to the disconnected / Connect CTA state automatically via the `mongo:status` event.
- If `status === 'disconnected'` (never connected):
  - Render a centered card: "Not connected. [Connect]".
  - Clicking Connect calls `api.mongo.connect(id)`; on success, triggers a serverInfo fetch.
- If `status === 'error'`:
  - Centered card with the last `errorMessage` and a `Retry` button.

### Card rows

**Server**
- Host (`host:port`) — from the `Connection` shape; not from ServerInfo.
- Version — `version`.
- Uptime — human-formatted (`humanDuration(uptimeSeconds)` → "14d 6h").
- Topology — `topology`.

**Storage**
- Databases — `databaseCount`.
- Data size — `humanBytes(dataSizeBytes)`.
- Storage size — `humanBytes(storageSizeBytes)`.
- Indexes — `indexCount ?? '—'`.

**Performance**
- Connections — `${current} / ${available + current}`.
- Ops/sec — rounded.
- Latency p99 — "{n} ms" or "—".
- Cache hit — `${(cacheHitRate * 100).toFixed(1)}%` or "—".

### Refresh
- Manual: button in header triggers fetch.
- Automatic: if the tab is visible, refetch every 15 seconds. Stop when tab hidden (use `document.visibilityState`).

## 6. Error handling

- If `serverInfo` throws `NETWORK` / `TIMEOUT` → render cards with their cached values (if any) and a small amber "Stale — couldn't refresh" pill.
- If no cache and it fails → render the error state card.

## 7. Acceptance criteria

- [ ] Selecting a connection in C05 and clicking Overview triggers at most one `mongo:serverInfo` call.
- [ ] Opening Overview on a cached connection renders within one frame (< 16ms).
- [ ] Refresh interval stops when the window is hidden.
- [ ] Values are formatted humanely (bytes as KB/MB/GB/TB, uptime as days/hours).
- [ ] Disconnected state offers Connect; Connect transition works.
- [ ] Large-deploy heuristic skips index count when `databaseCount > 50`.

## 8. Test cases

### Integration (against `mongodb-memory-server`)
- **serverinfo-basics.spec.ts**: returns populated fields; `databaseCount >= 1`; topology is `Single` for in-memory.
- **opcounters-delta.spec.ts**: two successive calls on a quiet server report a small (≥ 0, < large) per-sec rate.
- **index-count-skip.spec.ts**: stub `listDatabases` to return 60 entries → `indexCount === null`.

### Component
- **overview-loading.spec.tsx**: initial render shows skeleton; resolving mock hides it.
- **disconnected-connect.spec.tsx**: status disconnected → Connect button calls `api.mongo.connect` then refetches.
- **refresh-visibility.spec.tsx**: toggling `document.visibilityState` stops/resumes the interval.
- **stale-pill.spec.tsx**: second fetch errors → cached values remain; stale pill visible.

### E2E
- **overview-flow.e2e.ts**: create conn against memory Mongo → open ConnectionManager → Overview renders real version + db count.
