# X13 — Operation audit log & undo

## Purpose

A user who deletes the wrong documents, replaces a document with a bad edit, or drops the wrong collection has no record that it happened and no way to put it back. The only trace is a line in a text log file the app never surfaces.

X13 gives every Connection a durable **Audit Log** of the Operations that changed its documents, and offers **Undo** on the subset where putting the state back is honest. Recording is the spine — it works for every audited Operation, succeeded or failed. Undo hangs off it.

## Scope

**In scope** — eight channels, chosen by blast radius on documents rather than by API level:

| Channel | `op` |
| --- | --- |
| `docInsertMany` | `insertMany` |
| `docReplace` | `replace` |
| `docUpdateOne` | `updateOne` |
| `docDeleteOne` | `deleteOne` |
| `docDeleteMany` | `deleteMany` |
| `collectionDrop` | `collectionDrop` |
| `collectionRename` | `collectionRename` |
| `databaseDrop` | `databaseDrop` |

Also in scope: migration `010`, an `AuditRepo` + `AuditService`, two IPC channels, an Undo action on the success toast, an audit modal over the Active Connection, retention in `MaintenanceService`, and one line in each of the three confirm dialogs stating whether the action can be undone.

**Out of scope** — see [ADR 0002](../docs/adr/0002-audit-log-scope.md) for why each of these is excluded, not merely deferred:

- Reads. `recent_queries` is already that history.
- `userCreate` / `userUpdate` / `userDrop` — excluding them is what keeps credentials structurally out of the table.
- `docInsert` (single), `collectionCreate`, `indexCreate`, `indexDrop`.
- `scriptRun` / `mshellWrite`. A script that deletes 400 documents is invisible to X13.
- The activity log — session-scoped, in-memory, records failures rather than changes. Deliberately uncoupled.
- Deleting an aggregation stage — editor state and never touches Mongo.

## Dependencies

- F02 (SQLite persistence & migrations) — migration `010`.
- F04 (IPC bridge & error envelope) — recording taps `createRouter`.
- W08 (document write ops), C07/C09 (collection admin) — the audited channels.

## See also

- [ADR 0002](../docs/adr/0002-audit-log-scope.md) — scope boundary, and why audit never blocks an Operation.
- `CONTEXT.md` — Operation, Query, Audit Log, Pre-image, Reversible, Undo.

## User stories

1. As someone who has just deleted 40 documents by mistake, I want an Undo button on the toast that told me it happened, so that I can put them back without leaving the screen.
2. As someone who edited a document yesterday, I want to find that edit in a list, so that I can see what the document looked like before.
3. As someone who dropped the wrong collection, I want the trail to show that I did it and when, so that I can tell my colleague exactly what happened even though I can't undo it.
4. As someone about to delete 250,000 documents, I want the confirm dialog to tell me this is beyond the undo limit, so that I can decide differently before I commit.
5. As someone who has edited a document twice, I want undoing the first edit to be refused rather than silently discard the second, so that Undo can't cost me data.
6. As someone whose `deleteMany` failed with an authorization error, I want that attempt recorded with its error, so that I can see what I tried and why it didn't work.
7. As someone whose `insertMany` stopped part-way through, I want the trail to say "3 of 10 inserted" rather than "failed", so that I know the collection changed.
8. As someone who ran the same delete across three collections, I want to filter the log by collection, so that I can find the one I care about.
9. As someone reviewing what I did to a production server, I want the trail to survive a relaunch, so that closing the app doesn't lose it.
10. As someone who deleted a saved Connection, I want its trail to go with it, so that I don't accumulate history for servers I no longer have.
11. As someone whose disk is full, I want my delete to still work, so that a bookkeeping failure never stops me doing my job.
12. As someone who restored documents, I want the entry to show it was undone, so that I don't try twice.
13. As someone who renamed a collection by mistake, I want to rename it back from the log, so that I don't have to remember the old name.
14. As a developer adding a new write channel next year, I want it to be un-audited until I say otherwise, so that a forgotten channel fails closed rather than silently recording something it shouldn't.

## 1. Types

Added to `shared/types.ts`:

- `AuditOp` — string-literal union of the eight `op` values above, mirrored as the SQL `CHECK` constraint.
- `AuditOutcome` — `'ok' | 'error' | 'partial'`.
- `AuditEntry` — `id`, `connectionId`, `dbName`, `collection` (null for `databaseDrop`), `op`, `summary` (parsed `AuditSummary`), `outcome`, `errorCode?`, `ranAt`, `durationMs`, `reversible`, `undoneAt?`.
- `AuditSummary` — a discriminated union on `op`, carrying only what the modal renders: the filter for the `doc*` ops, `matchedCount`/`modifiedCount`/`deletedCount`/`insertedCount` as applicable, and `fromName`/`toName` for `collectionRename`.
- `UndoResult` — `{ restored: number; skipped: number }`.

New `AppErrorCode` members, thrown via `SystemError` so the renderer can `switch` on them:

- `AUDIT_NOT_REVERSIBLE` — no Pre-image was captured.
- `AUDIT_UNDO_EXPIRED` — the Pre-image has been swept.
- `AUDIT_ALREADY_UNDONE` — `undone_at` is set.
- `AUDIT_TARGET_CHANGED` — the document has changed since the Operation.

## 2. Database — migration `010-audit-log.sql`

```sql
CREATE TABLE audit_log (
  id             TEXT PRIMARY KEY,
  connection_id  TEXT NOT NULL,
  db_name        TEXT NOT NULL,
  collection     TEXT,
  op             TEXT NOT NULL CHECK(op IN (
                   'insertMany','replace','updateOne','deleteOne','deleteMany',
                   'collectionDrop','collectionRename','databaseDrop')),
  summary_json   TEXT NOT NULL,
  outcome        TEXT NOT NULL CHECK(outcome IN ('ok','error','partial')),
  error_code     TEXT,
  ran_at         TEXT NOT NULL,
  duration_ms    INTEGER NOT NULL,
  reversible     INTEGER NOT NULL DEFAULT 0,
  undo_json      TEXT,
  undone_at      TEXT,
  FOREIGN KEY (connection_id) REFERENCES connections(id) ON DELETE CASCADE
);

CREATE INDEX idx_audit_by_conn_time ON audit_log(connection_id, ran_at DESC);
```

`summary_json` and `undo_json` are separate columns on purpose: the summary is the durable record and stays for the row's life; `undo_json` holds the Pre-image and is nulled long before the row is deleted. The retention split is structural, not a convention someone has to remember.

`collection` is nullable only for `databaseDrop`. `ON DELETE CASCADE` matches `recent_queries` — deleting a Connection takes its trail with it.

## 3. IPC contract

| Channel | Input | Output |
| --- | --- | --- |
| `audit:list` | `{ connectionId, dbName?, collection?, limit?, before? }` | `AuditEntry[]` |
| `audit:undo` | `{ entryId }` | `UndoResult` |

Neither carries a secret; neither goes on the secret allowlist. Both follow the standard envelope and are registered through `registerAuditChannels(router, svc)` from `electron/main.ts`.

`audit:list` returns newest-first, `limit` defaulting to 100, `before` being a `ran_at` cursor. It never returns `undo_json` — the Pre-image is not sent to the renderer, which only needs to know `reversible`.

## 4. Recording

Recording taps `createRouter`. A **static per-channel table** in main maps an audited channel to: its `op`, how to derive `dbName`/`collection` from the validated input, and how to build the `AuditSummary` from the input plus the handler's result.

**A channel absent from that table is not audited.** This is the mechanism by which a channel added later fails closed.

Recording rules:

- The row is written **after** the handler returns, from a capture held in memory. Writing before would leave a phantom entry claiming an Operation that a crash prevented.
- Failures are recorded, with `outcome = 'error'` and the `IpcError` code in `error_code`. A failed Operation is never reversible.
- `insertMany` runs `ordered: true`, so a mid-batch failure leaves documents inserted. `classifyInsertManyError` already recovers `insertedCount` from the driver error; that case records `outcome = 'partial'` with the count, and `reversible = 0` — the error path yields the count but never the ids.
- **A failed audit write never blocks, fails, or delays the Operation.** It is logged via `electron/log.ts` and the entry is lost.

## 5. Capture

Pre-image capture lives in the services, because only they run before the write.

| `op` | Captured | `undo_json` |
| --- | --- | --- |
| `insertMany` | nothing | the returned `insertedIds` |
| `deleteOne`, `replace`, `updateOne` | exactly 1 document | the Pre-image |
| `deleteMany` | ≤1000 docs **and** ≤1 MB | the Pre-images |
| `collectionRename` | nothing | `fromName` |
| `collectionDrop`, `databaseDrop` | never | none — `reversible = 0` |

Four of the eight capture nothing or exactly one document, so no ceiling applies. `deleteMany` is bounded twice:

1. `find(filter).limit(1001)` — 1001 results means the doc ceiling is breached. This never reads 100,000 documents to discover the set is too big.
2. `ejsonEncodeArrayJson(docs, { maxBytes: 1_048_576 })` — which throws rather than truncating, so a half-captured Pre-image can never be stored.

Either ceiling breached: **the Operation still runs**, the entry records `reversible = 0`, and nothing partial is stored.

`replace` and `updateOne` additionally record what the Operation *left behind*, so §6 can detect a later change. `updateOne` returns only counts, so this is a second read after the write.

## 6. Undo

`audit:undo` refuses before it writes anything:

| Condition | Error |
| --- | --- |
| `reversible = 0` | `AUDIT_NOT_REVERSIBLE` |
| `undo_json` is null (swept) | `AUDIT_UNDO_EXPIRED` |
| `undone_at` is set | `AUDIT_ALREADY_UNDONE` |
| target no longer matches what the Operation left | `AUDIT_TARGET_CHANGED` |

Otherwise:

- `insertMany` → `deleteMany({ _id: { $in: insertedIds } })`.
- `deleteOne` → insert the Pre-image back. A reused `_id` is rejected by Mongo's unique index and surfaces as the existing `ConflictError`; no extra guard is needed.
- `deleteMany` → `insertMany(preImages, { ordered: false })`, reporting `{ restored, skipped }` honestly — *"restored 47 of 50, 3 already exist"*.
- `replace`, `updateOne` → replace the Pre-image back, after the `AUDIT_TARGET_CHANGED` check.
- `collectionRename` → rename back; a collection already at the old name fails through the existing error path.

On success the entry's `undone_at` is set. **No new entry is written for the Undo itself** — one column, no undo-of-undo, and the trail reads true.

Because Undo refuses on a changed target, Operations against the same document unwind in reverse order. If the intervening change came from outside MongoLab there is nothing to unwind first, and Undo stays refused; the message must say so rather than implying the user can fix it from here.

## 7. Retention

Two calls added to `MaintenanceService.vacuum()`, which already runs at most once per 24h:

- Pre-images: null `undo_json` and clear `reversible` past **7 days**, or beyond the most recent **200** revertible entries per Connection — whichever bites first.
- Rows: delete past **90 days**.

The record outlives the Pre-image because they have different value curves. Undo happens within minutes; the record is worth reading months later.

## 8. Renderer

**Undo on the success toast.** The audited write ops return their audit entry id; the success notification carries an **Undo** action that calls `audit:undo` and reports the outcome. This is the case that actually happens — the mistake is noticed seconds after it is made, not next Tuesday. It ships first.

**The audit modal**, opened from the command palette (X07), scoped to the Active Connection. Newest-first list of entries — time, op, target, outcome, and a Revert control where `reversible` is true — filterable by database and collection. `SettingsModal` is the pattern.

Not a workspace tab: `workspace_tabs.kind` is a SQL `CHECK` constraint, so a new tab kind would mean a migration plus tab-state persistence, position, pinning and resize handles, to house a list the user opens, scans and closes.

**Confirm dialogs.** `DeleteConfirm`, `DropCollectionConfirm` and `DropDatabaseConfirm` each gain one line stating whether the action can be undone. `confirmDeleteMany` already counts matches, so the delete dialog can say *"250,000 documents — above the 1,000-document undo limit, this cannot be undone"* with no new query. The drops always say they cannot be undone.

## 9. Acceptance criteria

- [ ] Each of the eight channels writes exactly one `audit_log` row per invocation; no other channel writes any.
- [ ] A channel absent from the per-channel table produces no row.
- [ ] A failed Operation is recorded with `outcome = 'error'` and its `IpcError` code, and is not reversible.
- [ ] A partial `insertMany` is recorded with `outcome = 'partial'`, its `insertedCount`, and `reversible = 0`.
- [ ] An `audit_log` insert that throws is logged and does not fail, alter, or delay the Operation's envelope.
- [ ] `deleteMany` over 1000 matches, or over 1 MB of encoded documents, still deletes and records `reversible = 0` with `undo_json` null.
- [ ] `deleteMany` under both ceilings records a Pre-image and undoes to the original document set.
- [ ] Undo of `insertMany` removes exactly the inserted ids and no other document.
- [ ] Undo of `updateOne` after the document changed again fails `AUDIT_TARGET_CHANGED` and leaves the document untouched.
- [ ] Undo of an already-undone entry fails `AUDIT_ALREADY_UNDONE`.
- [ ] Undo of `deleteMany` where some ids exist again restores the rest and reports `{ restored, skipped }`.
- [ ] A successful Undo sets `undone_at` and writes no second entry.
- [ ] `audit:list` never returns `undo_json`.
- [ ] Deleting a Connection deletes its `audit_log` rows.
- [ ] The maintenance sweep nulls Pre-images past 7 days / 200 entries and deletes rows past 90 days, leaving newer rows untouched.
- [ ] No audited channel accepts a plaintext secret; `npm run audit:ipc` stays green with no allowlist change.
- [ ] The delete confirm dialog states whether the pending delete is within the undo limit; the two drop dialogs state that they cannot be undone.
- [ ] The success toast for an audited write offers Undo, and restores the documents when used.

## 10. Testing decisions

A good test here asserts **externally observable behavior through the IPC handler boundary** — what landed in `audit_log`, what came back from `audit:undo`, and what the collection contains afterwards. It never reaches into the per-channel table or the router wrapper.

**Primary seam: the IPC handler boundary**, integration tier, real SQLite temp file + `mongodb-memory-server`. Everything in §4–§7 composes at the router, so this is the only seam that can catch the failure that actually matters — a channel wired to Mongo but missing from the audit table. Prior art: `doc-handlers.spec.ts`, `collection-admin-handlers.spec.ts`.

Explicitly **not** tested:

- `createRouter` in isolation. A unit test there asserts a wrapper calls a sink, and passes while a channel is unaudited.
- `DocumentService` audit behavior at the service level. The behavior doesn't exist at that layer; `document-service.spec.ts` stays as it is.

| Behavior | Seam | Prior art |
| --- | --- | --- |
| Recording, capture, ceilings, failures, undo, refusals | IPC handlers | `doc-handlers.spec.ts` |
| Retention sweep | `MaintenanceService.runIfNeeded` | `maintenance-service.spec.ts` |
| Cascade on Connection delete | FK, via repo | `cascade.spec.ts` |
| Migration `010` applies cleanly | migration runner | `migration-007-collection-subtabs.spec.ts` |
| Channel registration across the 5-file contract | — | `ipc-channel-registration.spec.ts` |
| Toast Undo, audit modal, confirm-dialog copy | component, `atelierMock` | `tests/component/` |
| Delete → toast → Undo → documents back | e2e | `tests/e2e/` |

## 11. Test cases

1. Each audited channel writes one row with the right `op`, namespace, `outcome` and `duration_ms`.
2. `queryFind`, `docInsert`, `indexDrop`, `userCreate`, `scriptRun` write no rows.
3. A `docDeleteOne` against an unauthorized connection records `outcome = 'error'` with the error code and `reversible = 0`.
4. `insertMany` with a duplicate key at document 4 of 10 records `outcome = 'partial'`, `insertedCount: 3`, `reversible = 0`.
5. An `AuditRepo` insert that throws leaves the `docDeleteOne` envelope `{ ok: true }` and the documents deleted.
6. `deleteMany` matching 1001 documents deletes all of them, records `reversible = 0`, stores no `undo_json`.
7. `deleteMany` matching documents totalling over 1 MB behaves the same way.
8. `deleteMany` matching 3 documents, undone, restores all 3 byte-identically including `ObjectId` and `Date` fields.
9. `deleteMany` undone after one `_id` was re-created restores 2, skips 1, reports `{ restored: 2, skipped: 1 }`.
10. `insertMany` undone deletes exactly the inserted ids, leaving a pre-existing document with a similar shape in place.
11. `updateOne`, then a second `updateOne` on the same document, then undo of the first → `AUDIT_TARGET_CHANGED`, document unchanged.
12. `updateOne` then immediate undo → document matches its Pre-image exactly.
13. Undo twice → second call fails `AUDIT_ALREADY_UNDONE`; the document is not written twice.
14. Undo of a `collectionDrop` entry fails `AUDIT_NOT_REVERSIBLE`.
15. Undo after the sweep nulled `undo_json` fails `AUDIT_UNDO_EXPIRED`.
16. `collectionRename` undone restores the original name; undone when a collection already holds the old name surfaces the driver error.
17. `audit:list` filters by `dbName` and `collection`, orders newest-first, honours `limit` and `before`, and omits `undo_json` from every entry.
18. Deleting a Connection removes its `audit_log` rows and no other Connection's.
19. The sweep nulls `undo_json` on an 8-day-old entry, leaves a 6-day-old one intact, deletes a 91-day-old row, and keeps an 89-day-old one.
20. The sweep keeps the newest 200 revertible entries per Connection and nulls the 201st.
21. Migration `010` applies to a database at `009` and is idempotent under the runner.
22. Component: the success toast for `docDeleteMany` renders an Undo action; activating it calls `audit:undo` with the entry id and reports the restored count.
23. Component: the toast surfaces `AUDIT_TARGET_CHANGED` as an explanation the user can act on, not a raw code.
24. Component: the audit modal lists entries for the Active Connection only, and offers Revert only where `reversible` is true.
25. Component: `DeleteConfirm` states the pending delete is within the undo limit at 999 matches and beyond it at 1001; both drop dialogs state the action cannot be undone.
26. e2e: delete documents from the result view, use Undo on the toast, confirm the rows return to the table.

## 12. Further notes

Three known ceilings, recorded so nobody mistakes them for oversights:

- **Scripts and the shell are invisible.** A `scriptRun` that deletes 400 documents leaves no entry. Instrumenting `dbProxy` is the upgrade path if this ever stings.
- **Partial `insertMany` can't be undone.** Making it undoable means pre-generating `_id`s before the call — a change to how insert works, and its own ticket.
- **`updateOne` costs a second read** when audited, to record what it left behind for the `AUDIT_TARGET_CHANGED` check. If that shows up in profiling, the alternative is comparing structurally against the Pre-image plus the update document rather than re-reading.
