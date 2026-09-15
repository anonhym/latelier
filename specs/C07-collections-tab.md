# C07 — Collections tab (real listing)

## Purpose

List every collection across every database on the selected connection, with real document counts, size, index count, and last-modified timestamps. Clicking a row opens that collection in the Workspace (W01). Clicking "Open" on the header opens the default database's first collection.

## Scope

- **In**: `meta:listDatabases`, `meta:listCollections`, row selection → workspace navigation, filter, virtualized list for large deployments.
- **Out**: Write operations (W08), query execution (W03).

## Dependencies

- C05 (selected connection), F05 (MongoPool), W01 (workspace tab creation).

## 1. Data flow

### `meta:listDatabases`
Input: `{ connectionId }`.  
Output: `Array<{ name: string; sizeOnDisk: number; empty: boolean; }>`.  
Implementation: `(await pool.getClient(id)).db('admin').admin().listDatabases({ nameOnly: false })`.  
Excludes `local`, `admin`, and `config` by default (toggleable in §5 UI).

### `meta:listCollections`
Input: `{ connectionId; dbName }`.  
Output:
```ts
Array<{
  name: string;
  type: 'collection' | 'view' | 'timeseries';
  documentCount: number;
  sizeBytes: number;
  indexCount: number;
  lastModified?: string;     // ISO, from $collStats if available
  capped: boolean;
}>
```
Implementation: `db.listCollections({}, { nameOnly: false }).toArray()` → then for each collection an aggregation:
```js
db.getCollection(name).aggregate([
  { $collStats: { storageStats: {}, latencyStats: {} } }
]).toArray();
```
`documentCount` from `storageStats.count`; `sizeBytes` from `storageStats.size`; `indexCount` from `storageStats.nindexes`. `lastModified` from `storageStats.wiredTiger.creationTime` if present, else absent.

If `$collStats` is not authorized (Atlas Free tier): fall back to `collection.estimatedDocumentCount()` + `collection.indexes()` + no lastModified.

## 2. Flatten / group strategy

For a connection with one DB (common case) we render the mock's exact table: one row per collection. For multiple DBs, **group by database**:

- Header row per database: colored strip, db name, total collection count, total data size, collapse chevron.
- Collapsed by default if `databaseCount > 3`.
- Expanded shows the same rows as the single-DB view.

## 3. UI layout

```
┌─ Search row ──────────────────────────────────────────────────────┐
│ [🔍 Filter collections…]           [ Show system DBs ☐ ]          │
├─ Database group ──────────────────────────────────────────────────┤
│  ▸ downlink   5 colls · 210 MB                                    │
│  ▾ config     1 coll · < 1 MB                                     │
├───────────────────────────────────────────────────────────────────┤
│  Column headers: Collection │ Documents │ Size │ Indexes │ Mod… │ │
│  ─────────────────────────────────────────────────────────────── │
│  📄 journalEntry   832,004   102 MB   5   12 min ago   [Open] │
│  …                                                              │
└───────────────────────────────────────────────────────────────────┘
```

### Row interactions
- Click anywhere on the row → opens workspace with this collection in a new tab (W01).
- Right-click → context menu: `Open in new tab`, `Copy name`, `Copy count`, `View indexes (coming soon)`.
- `Open` button (trailing) — keyboard-accessible action equivalent to click.

### Filter
- Case-insensitive substring match on `name`. Filters within each database group; hides empty groups.

### System DBs toggle
- Persisted to `app_state['ui.showSystemDbs']`. Default `false`. When off, hides `admin`, `local`, `config`.

### Virtualization
- If total rows > 200, use `react-window` for the list. Below that, plain DOM.

## 4. Loading states

- Databases → Collections loads in two waves. While DBs are loading: skeleton of 3 group headers. While each database's collections load: skeleton rows inside that group.
- Per-database error (e.g., unauthorized to `listCollections`): show an inline amber row "Couldn't list collections for {db}: {msg}".

## 5. Refresh

- Small refresh button in the top-right of the tab. Re-fetches all DBs + collections.
- No auto-refresh — could be costly on large clusters.

## 6. Opening a collection

On click:
1. `api.tabs.openCollection({ connectionId, dbName, collection: name })` (W01) — main returns the new tab id.
2. `navigate('/workspace')`.

Main performs:
- `api.conn.touchUsed(connectionId)`.
- Inserts a new row into `workspace_tabs` (W01).
- Marks it active.
- Persists.

## 7. IPC contract

| Channel               | Input                               | Output              |
| --------------------- | ----------------------------------- | ------------------- |
| `meta:listDatabases`  | `{ connectionId }`                  | `DbInfo[]`          |
| `meta:listCollections`| `{ connectionId, dbName }`          | `CollectionInfo[]`  |

Both validate input as UUID string / plain string.

## 8. Error handling

| Error            | UX                                       |
| ---------------- | ---------------------------------------- |
| `NOT_FOUND`      | Show "Connection no longer exists" banner → back to list |
| `UNAUTHORIZED`   | Amber inline row                         |
| `NETWORK`/`TIMEOUT` | Full-panel state with Retry         |

## 9. Acceptance criteria

- [ ] Tab lists every collection from every non-system database by default.
- [ ] Toggling "Show system DBs" reveals `admin`/`local`/`config`; preference persists across relaunches.
- [ ] Row counts and sizes match `$collStats` output.
- [ ] Clicking a row opens Workspace with the chosen collection pre-selected.
- [ ] On Atlas free tier (no `$collStats`), fallback counts still render.
- [ ] Filter narrows rows within each DB group and hides empty groups.
- [ ] Virtualization kicks in beyond 200 rows (verify via DOM node count).

## 10. Test cases

### Integration (against `mongodb-memory-server` seeded with 2 DBs × 3 colls)
- **list-databases.spec.ts**: omits `admin`/`local`/`config` by default; includes when `showSystemDbs`.
- **list-collections-collstats.spec.ts**: counts and sizes from seed match.
- **list-collections-fallback.spec.ts**: stub `$collStats` to throw Unauthorized → falls back to `estimatedDocumentCount`; result omits `lastModified`.

### Component
- **collections-render.spec.tsx**: mock returns 2 DBs × 2 colls → rows render grouped.
- **filter.spec.tsx**: typing "journal" narrows correctly.
- **show-system-toggle.spec.tsx**: checking toggle calls `api.prefs.set('ui.showSystemDbs', true)` and re-fetches.
- **click-open.spec.tsx**: click row → `api.tabs.openCollection` called with right payload; navigation to `/workspace`.

### E2E
- **collections-to-workspace.e2e.ts**: create conn → pick Collections tab → click a row → arrives at workspace with the collection name in breadcrumb.
