# Implementation plan — Workspace (W01 → W10, plus X01 + X06)

> **Status: SHIPPED.** All ten steps merged. Open items resolved as built: canonical EJSON on the wire; no per-query cancellation (button disabled in-flight); page sizes `{10,25,50,100,250,500}` default 50; virtualization threshold 200 rows; W08 ships insert/replace/delete-single/delete-many; recent dedup deferred (every run a row); X01 landed as Step 9, X06 as Step 10. Migration `006-workspace-tab-pinned.sql` was added later to back the tab-pin feature surfaced by hint `tabs.pin`.

Phase W turns the mocked Workspace page into a real MongoDB IDE: session-restored tabs, live collections, real find/count/explain, a bidirectional query builder, three result views, pagination, document CRUD, saved queries, and recent-query history. X01 (theme + window state migration) rolls in next so renderer state joins the rest of the main-process-owned stack. X06 (contextual feature hints) closes the phase as a discoverability polish pass — it depends on the result-area, references, saved-queries, and tab-strip surfaces all being live.

## Guiding principles

- **Backend first, then UI.** Every step lands a typed IPC surface + integration tests before the renderer touches it. Component tests mock the bridge; E2E exercises real `mongodb-memory-server` instances.
- **EJSON canonical on the wire.** All Mongo-typed values travel as Extended JSON v2 canonical strings. Parse once at the receive boundary (renderer) and cache the parsed shape in tab state.
- **No more `src/data.ts`.** Phase W is the last consumer; by the end of the phase, the file is deleted (Aggregation still references it until phase A; that's the only thing left).
- **Session restore must be real.** Every step that touches tab state persists through `workspace_tabs` and survives relaunch. This is the testable contract, not a nice-to-have.
- **Migrations append-only.** Step 6 adds `003-saved-queries-unique-name.sql`; any future schema moves to 004+.

## Prerequisites

- Phases F + C merged. `npm test && npm run test:e2e` green.
- `mongodb-memory-server` fixture available via `tests/helpers/mongo.ts` (seeded via `MongoMemoryServer` today; phase W will add a thin replica-set helper in one step).
- Zero mocks remaining in `ConnectionManager` / `NewConnection` renderers (verified in Phase C §7).

## Open items to confirm before starting

1. **EJSON wire format**: canonical (BSON types preserved via `$oid`, `$date`, etc.) is what C01/W03 spec — confirm. Renderer displays via a small `ejsonToDisplay` helper; editing round-trips back through the canonical form.
2. **Query cancellation**: spec W03 §5 documents a two-channel token pattern but says "simpler alternative kept for this spec: no cancellation, button disabled during in-flight". Keep the simple version for iteration 1 — confirm?
3. **Page size options**: `{10, 25, 50, 100, 250, 500}` with default 50 (W07). OK?
4. **Virtualization threshold**: switch to `react-window` at >200 rows in Tree + Table views (W06). OK?
5. **Doc write scope**: W08 ships Insert, Edit (= findOneAndReplace), Delete single, Delete many (typing-collection-name gate). `updateOne` is exposed on IPC but not surfaced as a button — use cases arrive with CmdK/Recent re-run. OK?
6. **Recent-query dedup**: W10 says no dedup in iteration 1 (every run is a row). OK?
7. **X01 timing**: land it as Step 9 — trailing. Moving `localStorage['ml-theme']` to `app_state` and wiring `nativeTheme`-followed 'system' mode only happens after Workspace is stable so renderer changes don't accumulate two sources of truth. OK?

Once you sign off on the plan and those seven items, I'll start with Step 1.

---

## Step 1 — Workspace shell + tab management (W01)

**Goal**: real tabbed workspace backed by `workspace_tabs`. Session restore works across relaunches. Every other step stays trivial because tab state is authoritative from the start.

### Changes

1. Shared types: promote `CollectionTabState`, `AggregationTabState`, `WorkspaceTab` (C/A), `WorkspaceTabBase` from W01 §2 into `shared/types.ts`.
2. `electron/db/repositories/WorkspaceTabRepo.ts` — CRUD + ordered list + active flag transactions.
3. `electron/services/WorkspaceStateService.ts` — orchestrates repo + assigns `activeTab` semantics per W01 §5–§6. Per-window mutex not needed (single window today); add a TODO for multi-window.
4. `tabs:*` IPC channels (W01 §4): `list`, `openCollection`, `openAggregation`, `openDefault`, `update`, `close`, `setActive`, `reorder`. Schemas via Zod.
5. Replace `tabs:openDefault` stub from Phase C §7 with the real implementation (picks the first non-system DB + first collection via `meta:listDatabases/listCollections`).
6. Renderer: gut `src/pages/Workspace.tsx`. Keep the visual shell (title bar, tab strip, three-column frame) but drop `DOCS`/`COLLS`/`DB_TREE` imports. Everything inside the three columns becomes a placeholder until Step 2+.
7. Add `src/state/workspaceTabs.ts` React hook: loads on mount via `tabs:list`, exposes `open(kind, coords)`, `close(id)`, `setActive(id)`, `reorder(ids)`, `patchState(id, patch)`. Debounced (250ms) write-through on `patchState`.
8. Tab strip: drag-to-reorder, close (×), overflow scroll, "+▾" menu with "New collection tab", "New aggregation on current coll" (disabled if no active collection tab), recent connections submenu.
9. Keyboard: `⌘T`, `⌘W`, `⌘1`–`⌘9`, `⌘⌥→/←`.

### Tests

- **Integration (main)**
  - `tests/integration/workspace-tab-repo.spec.ts` — insert / update / close / reorder; position stays contiguous; active flag is exclusive.
  - `tests/integration/tabs-handlers.spec.ts` — open → list → close; `openCollection` with `reuseExisting:true` activates existing; with `false` creates duplicate; `setActive` flips the exclusive flag.
  - `tests/integration/tabs-debounce.spec.ts` — rapid `update` calls collapse to at most one write per 250ms.
- **Component**
  - `tests/component/workspace-shell.spec.tsx` — renders N tabs, drag reorder dispatches `tabs:reorder`, close propagates, empty state CTA, keyboard `⌘1/⌘2`.
- **E2E**
  - `tests/e2e/workspace-restore.e2e.ts` — open two tabs → quit → relaunch → tabs present, active tab unchanged.

### Done when

- Relaunching restores every tab including view mode and builder conditions (even though builder is still a stub at this step).
- Closing the last tab shows an empty state with "Open a collection" CTA.
- No more `src/data.ts` imports in `Workspace.tsx`.

**Effort**: ~1 day.

---

## Step 2 — DB / collection navigator (W02)

**Goal**: left sidebar lists real databases and collections from the active tab's connection. Click semantics match C07 + W02 spec.

### Changes

1. Renderer component `src/pages/Workspace/DbCollectionNavigator.tsx`, wired to `api.meta.*`. Caches per `connectionId`.
2. Auto-expand the active tab's DB on mount; scroll to the active collection.
3. Click modifiers: plain → activate existing tab (reuse), `⌘/Ctrl` → force new tab, `⌥` → aggregation tab.
4. Filter input narrows within each DB group; hides empty groups.
5. Refresh button invalidates the cache for the current connection.

### Tests

- **Component** (mocked `api.meta`):
  - `navigator-render.spec.tsx` — expansion, filter, refresh.
  - `navigator-click-modifiers.spec.tsx` — plain / cmd / alt produce the right `tabs:*` calls.
- **Integration** already covered in Phase C (`meta-service.spec.ts`); no new integration tests needed.

### Done when

- Switching the active tab auto-expands its DB.
- Filter and refresh behave per W02 §4.

**Effort**: ~0.5 day.

---

## Step 3 — Query runner + result views (W03 + W05 + W06)

**Goal**: Run button does real `find` + `count`; documents render in Tree / JSON / Table with EJSON type badges. Query bar is a single editable string that syncs either direction (builder sync itself lands in Step 4).

### Changes

1. `electron/mongo/QueryService.ts` per W03 §4. Depends on `MongoPool.getDb`.
2. `electron/ipc/handlers/query.ts` — registers `query:find`, `query:count`, `query:findOne`, `query:explain`. No `query:cancel` (per open item #2).
3. Extend shared types: `FindInput`, `FindResult`, `ExplainInput`.
4. EJSON helpers on the renderer side: `src/utils/ejson.ts` re-exports a browser-safe subset from `bson` (already bundled).
5. Display helpers (W06 §1): `toDisplayValue(value)` → `{ type, display, raw }`. Unit-tested.
6. Result view components:
   - `src/pages/Workspace/views/TreeView.tsx` — collapsed row with preview-field summary; expanded field grid; `ExpandableFieldRow` with type badges.
   - `JsonView.tsx` — pretty-printed EJSON per card; tiny `utils/jsonHighlight.ts` tokenizer (no external dep).
   - `TableView.tsx` — column derivation from first 50 docs; `_id` first, then preview fields, then alphabetic; draggable column widths persisted in tab state.
   - `ResultArea.tsx` glues the three and shares selection state.
7. Virtualization via `react-window` when `documents.length > 200`.
8. Query bar (W05) with the bidirectional sync **state machine SYNCED / DIRTY** but the compile side (`compileMql`) is a placeholder identity function until Step 4 — parse direction works now (see §3 of W04). The user can hand-edit → Run; the builder pane stays unwired through this step.
9. Selection state: single click selects; `⌘`-click toggles multi-select. Drives future W08 edit/delete.
10. Pagination integration left as a no-op ("Page 1" shown) — Step 5 fills it in.

### Tests

- **Unit**
  - `display-value.spec.ts` — every EJSON type → correct `{type, display}`.
  - `json-highlight.spec.ts` — tokenizer outputs expected spans.
- **Integration** (memory Mongo)
  - `query-service.spec.ts` — happy find; EJSON round-trip for `ObjectId`/`Date`/`Long`/`Decimal128`; sort + projection; skip; `hasMore: true` when `documents.length === limit`; `query:count` with `maxTimeMS` cap.
  - `query-validation.spec.ts` — malformed EJSON filter → `VALIDATION`; limit 0 → `VALIDATION`; limit > 1000 → clamped silently.
- **Component**
  - `tree-collapsed.spec.tsx` / `tree-expanded.spec.tsx` / `json-highlight.spec.tsx` / `table-columns.spec.tsx` per W06 §7.
  - `query-bar-run.spec.tsx` — click Run fires `api.query.find`; result populates views; error shows as pill.
  - `virtualize.spec.tsx` — 500 docs → DOM contains ≤ ~60 row nodes.

### Done when

- Running a query against a seeded memory Mongo shows documents in all three views.
- EJSON types render with badges and round-trip identically.
- Hand-editing the query bar → Run works even with the builder pane still inert.
- Error states (malformed filter, unauthorized, timeout) render the pill correctly.

**Effort**: ~2 days.

---

## Step 4 — Query builder pane + bidirectional sync (W04 + W05 finish)

**Goal**: builder ↔ query bar round-trips. Conditions, AND/OR, projection chips, sort, limit. The full state machine from W05 §1 kicks in (SYNCED / DIRTY-parseable / DIRTY-freeform).

### Changes

1. `src/pages/Workspace/builder.ts` — `compileMql(state)` + `parseMqlToBuilder(mql)` pure helpers per W04 §2–§3.
2. Reducer + `useBuilder(tabId)` hook. Debounced persistence through `tabs:update`.
3. Builder pane component: conditions list (`CondRow`), AND/OR pills, projection chips, sort/limit inputs, "Saved for this collection" placeholder (wired in Step 7), Reset / Copy code / Run footer.
4. Query bar state machine completed: DIRTY-parseable offers "Re-sync builder"; DIRTY-freeform disables the builder with a badge.
5. Unit tests lock down compile/parse for every supported `ValType`.

### Tests

- **Unit**
  - `reducer.spec.ts` — every action type.
  - `compileMql.spec.ts` — fixture table for every ValType + logic + empty state.
  - `parseMqlToBuilder.spec.ts` — round-trip for supported shapes; fail gracefully for free-form filters.
- **Component**
  - `builder-cond-row.spec.tsx` — field/op/type select interactions.
  - `builder-sync-happy.spec.tsx` / `builder-sync-dirty-parseable.spec.tsx` / `builder-sync-dirty-freeform.spec.tsx` per W05 §8.

### Done when

- Builder edits update the query bar instantly (SYNCED).
- Hand-editing to `{ amount: { $gt: 10 } }` flips to DIRTY, "Re-sync builder" hydrates the builder.
- Hand-editing to `{ $expr: … }` flips to DIRTY-freeform and disables the builder.
- Reset clears the tab's builder state and `queryRaw`.

**Effort**: ~1 day.

---

## Step 5 — Pagination (W07)

**Goal**: next/prev + page-size selector, `totalCount` from `query:count`, proper disabled states.

### Changes

1. Extend `CollectionTabState` with `page`, `pageSize`, `totalCount`, `lastRunHasMore` (W07 §1). Persisted via `tabs:update`.
2. Pagination control component in the result bar. Next disables at last page; Prev at page 0; size selector resets page to 0 and re-runs.
3. Reset-to-page-1 hint when the user edits the builder/bar while on page > 0.

### Tests

- **Component** — the six scenarios from W07 §6.

### Done when

- Paging backward/forward re-runs with the right skip/limit.
- Page size persists across tab switches and relaunches.

**Effort**: ~0.25 day.

---

## Step 6 — Document write ops (W08)

**Goal**: insert, edit (replace), delete single, delete many.

### Changes

1. `electron/mongo/DocumentService.ts` (`insert`, `replace`, `updateOne`, `deleteOne`, `confirmDeleteMany`, `deleteMany`) + EJSON validation.
2. Nonce-based confirm token for `deleteMany` (W08 §4). In-memory `Map<token, expiry>` on the service.
3. `doc:*` IPC handlers (W08 §1).
4. Error classifier extensions: `DuplicateKey (E11000)` → `CONFLICT` with index name; `DocumentValidationFailure` → `VALIDATION` with `details.schemaErrors`.
5. Renderer:
   - `InsertDrawer`, `EditDrawer`, `DeleteConfirm` components per W08 §5.
   - Right-click context menu on rows (Tree + Table).
   - Keyboard: `e` edit, `d` / `Backspace` delete, `⌘N` insert.
   - Refresh result after every successful write (re-run current query preserving page/builder).

### Tests

- **Integration** (memory Mongo)
  - `doc-insert.spec.ts` — happy + duplicate-key CONFLICT + schema-validation failure.
  - `doc-replace.spec.ts` — `_id` preserved even if user strips it.
  - `doc-delete-single.spec.ts`, `doc-delete-many-gate.spec.ts`.
  - `doc-unauthorized.spec.ts`.
- **Component**
  - Drawer open / validate / submit flows.
  - Delete-many typing-collection-name gate.
  - Refresh-after-write fires `api.query.find` again with the same args.
- **E2E**
  - `workspace-crud.e2e.ts` — insert → row appears → edit → row updates → delete → row gone.

### Done when

- The full CRUD triangle works end-to-end against memory Mongo.
- Refresh keeps the user on the same page where possible (clamps when count shrinks).
- Every W08 §8 acceptance criterion ticks.

**Effort**: ~1.5 days.

---

## Step 7 — Saved queries (W09)

**Goal**: persist named find builders (and aggregation pipelines once phase A ships).

### Changes

1. Migration `003-saved-queries-unique-name.sql` — `UNIQUE(connection_id, db_name, collection, kind, name)`.
2. `SavedQueryRepo` + `SavedQueryService` + `saved:*` IPC per W09 §2.
3. Save modal (triggered by a new Save button next to Reset/Copy/Run in the builder footer). Fields: Name, Scope, Description.
4. Saved tab body lists summaries for the active tab's collection (or `connectionId` scope).
5. `Run here` hydrates builder + fires Run; `Open in new tab` creates a new tab with hydrated state.
6. Rename inline; delete with confirm.
7. "Saved for this collection" section in the Builder tab's footer (W04 §6) — up to 5 most recent.

### Tests

- **Integration**
  - CRUD happy / unique-name CONFLICT / duplicate / cascade on connection delete.
- **Component**
  - Save modal validates name; submit calls `saved:create` with compiled payload.
  - Run here hydrates state and triggers run.
  - Rename inline validates uniqueness error inline.
- **E2E**
  - `save-relaunch.e2e.ts` — save a find → quit → relaunch → Saved tab lists it → Run here works.

### Done when

- Duplicate name in the same scope returns CONFLICT with a readable message.
- Saved state survives relaunch bit-for-bit (same builder conditions, same raw override if DIRTY when saved).
- Aggregation saved-payload shape defined now so phase A can slot in.

**Effort**: ~1 day.

---

## Step 8 — Recent queries + preview fields (W10)

**Goal**: capture every run, surface history in the builder's Recent tab; persist per-collection preview-field prefs via `prefs:*` (already live).

### Changes

1. `RecentQueryRepo` + `RecentQueryService` with:
   - 200-row per-connection cap (oldest evicted).
   - 30-day retention via `MaintenanceService` tick at startup.
2. Capture hook in `QueryService.find` (this step extends Step 3's hook) and, in a future phase, `AggregationService.run`.
3. `recent:list` / `recent:get` / `recent:clear` IPC.
4. Recent tab body in the builder pane; Run here / Open in new tab / Copy MQL actions.
5. `PreviewFieldsRepo` + `PreviewFieldsService` + `prefs:getPreviewFields` / `prefs:setPreviewFields` dedicated channels (reuses the `preview_fields` table; promoted from the generic `prefs:*` KV store so the type signature can be specific).
6. W06 `PreviewPicker` wired for real: init from `prefs:getPreviewFields`, persist on change; default derivation from first 50 docs when no pref exists.
7. Tiny `MaintenanceService` — runs at startup, logs `info maintenance`.

### Tests

- **Integration**
  - `recent-record.spec.ts` — successful and errored runs both captured.
  - `recent-cap.spec.ts` — 205 inserts → 200 remain.
  - `recent-retention.spec.ts` — 31-day-old row evicted by maintenance.
  - `preview-roundtrip.spec.ts` — set → get → same fields.
- **Component**
  - Recent row renders summary; Run here hydrates and fires.
  - Preview picker default derivation + persist.
- **E2E**
  - `recent-restore.e2e.ts` — run → quit → relaunch → Recent tab lists the run with the right payload.

### Done when

- Every run writes exactly one recent row within ~100ms of completion.
- Picker changes persist across relaunches.
- Default preview fields derive to the first 4 top-level scalar fields on first render.

**Effort**: ~0.75 day.

---

## Step 9 — X01 theme + window state migration (trailing)

**Goal**: finish the "all state in main" rule. Remove the last `localStorage` usage in the renderer (`ml-theme` + `ml-preview-fields`).

### Changes

1. `AppStateService` (already has `get`/`set` via `AppStateRepo`) — add `onChange(key, cb)` observer, backed by an `EventEmitter`.
2. Promote the generic `prefs:get/set` to typed helpers for theme + window state, keyed `theme.mode`, `window.bounds`, `window.maximized`.
3. `ThemeContext`: replace `localStorage['ml-theme']` with `api.prefs.getTheme()` + `api.prefs.onThemeChanged(cb)` (push via `prefs:watch` event channel — implement it as part of this step).
4. Main-process auto-theme: when `theme.mode === 'system'`, subscribe to Electron's `nativeTheme.on('updated', …)` and re-broadcast.
5. One-time migration: on startup, if `app_state['theme.mode']` absent AND `localStorage['ml-theme']` is present (the renderer cooperates by calling a `prefs:migrateLegacy` handler once after boot), copy the value and clear local storage.
6. Window bounds persistence: implemented in F06 §5 already; just prove via a new E2E that relaunch restores position + maximized state.
7. Delete remaining `localStorage` references in renderer.

### Tests

- **Integration**
  - Theme CRUD round-trip; `'system'` mode flipping tracks the mocked `nativeTheme`.
  - Migration clears localStorage after copy.
- **Component**
  - `ThemeContext` re-renders on `onThemeChanged` callback.
- **E2E**
  - `theme-persist.e2e.ts` — toggle dark → quit → relaunch → dark sticks.
  - `window-bounds.e2e.ts` — move/resize → relaunch → same.

### Done when

- No `localStorage` usage remains in `src/`.
- Theme toggle in either ConnectionManager or Workspace persists and propagates to both pages instantly.
- Starting the app with `theme.mode = 'system'` tracks the OS theme in real time.

**Effort**: ~0.5 day.

---

---

## Step 10 — Contextual feature hints (X06, trailing)

**Goal**: surface non-obvious features (configure references, pin a tab, save a recurring query) at the moment the user would want them. Diagnostic that prompted the spec: the developer himself couldn't find references without reading the source. Same "all state in main" pattern as X01 — dismissals live in `app_state` via the existing `prefs:*` IPC.

### Changes

1. Shared types: `FeatureHintId` union and `FeatureHintDismissalState` in `shared/types.ts`.
2. Renderer hint registry (`src/hints/registry.ts`) with v1 catalog: `refs.configure`, `tabs.pin`, `saved.create`. Copy lives here; trigger conditions live at the call site.
3. Typed prefs helpers on the bridge: `prefs.getDismissedHints`, `prefs.dismissHint(id)`, `prefs.resetHints()`. Backed by existing `prefs:get` / `prefs:set` against the `ui.hints.dismissed` key — no new channels.
4. `HintsProvider` (mounted in `src/pages/App.tsx`): loads dismissal state once, exposes `{ isDismissed, dismiss, reset }`, gates "one hint visible at a time" via an in-memory `currentlyVisibleId` ref. Holds session-scoped trigger counters for `tabs.pin` (tab-switch count) and `saved.create` (per-`queryHash` run count).
5. `useFeatureHint(id, when)` hook returning `{ visible, anchorRef, dismiss }`. Reactive `when` — no polling.
6. `<FeatureHint>` popover component: title, body, optional CTA, "Got it" + `×`. Click-outside does **not** dismiss. Suppressed for the first 1.5 s after renderer mount so layout settles.
7. Anchor wiring at the three call sites:
   - `ResultArea` "References" button → `refs.configure` hint when results contain `_id`/`Id`-suffixed fields and the collection has zero enabled rules.
   - Tab strip active tab → `tabs.pin` after 3 tab switches with zero pinned tabs.
   - Builder/query toolbar Save button → `saved.create` after the same `queryHash` runs 3 times in a session.
8. Settings: add a "Hints — `[Reset hints]`" row that calls `prefs.resetHints()` and shows a 2-second toast.

### Tests

- **Unit**
  - `hints-registry.spec.ts` — every `FeatureHintId` present; copy lengths within bounds; placements valid.
- **Integration**
  - `hints-prefs-roundtrip.spec.ts` — `prefs.dismissHint` then `getDismissedHints` returns it; `resetHints` clears + bumps `resetAt`.
- **Component**
  - `feature-hint.spec.tsx` — render contract; "Got it" / `×` dismiss; click-outside does not dismiss.
  - `hints-provider.spec.tsx` — only one hint renders when two request visibility; dismissing the first reveals the second.
  - `refs-configure-hint.spec.tsx` — visible when ObjectId-bearing rows + no rules; hidden when rules exist; hidden after dismiss.
- **E2E**
  - `hints-persist.e2e.ts` — trigger `refs.configure`, dismiss, relaunch, reproduce trigger → no hint. Settings → Reset hints → next trigger reshows it.

### Done when

- Each of the three v1 hints fires exactly once per app install, anchored to the correct UI surface.
- Dismissal survives relaunch.
- Reset hints brings them all back.
- No hint blocks input, moves focus, or animates underlying UI.
- No new IPC channels; only typed wrappers on `api.prefs`.

**Effort**: ~0.75 day.

---

## Total phase W effort

~9.25 engineer-days including tests. End-state:

- Connecting to a real Mongo, opening a collection tab, running builder-compiled or hand-written queries, viewing results in three modes, paginating, inserting / editing / deleting docs, saving queries, and pulling history up — all backed by SQLite + Mongo + secrets.
- Session restore fully works for tab list + builder state + view mode + page + preview fields + theme + window bounds.
- `src/data.ts` deleted (Aggregation is the last holdout; phase A removes it).
- Phase A can start with a stable Workspace underneath — aggregation becomes another tab kind.

## Commit layout

One commit per step:

1. `feat(w): workspace shell + tabs persistence`
2. `feat(w): db/collection navigator sidebar`
3. `feat(w): query runner + result views (Tree/JSON/Table)`
4. `feat(w): query builder + bidirectional sync`
5. `feat(w): pagination`
6. `feat(w): document write ops (insert/edit/delete)`
7. `feat(w): saved queries + migration 003`
8. `feat(w): recent queries + preview fields + maintenance`
9. `feat(x): theme + window state migrated to app_state`
10. `feat(x): contextual feature hints (X06)`

## Risks and mitigations

- **Tab-state thrash on debounce** — mitigated by 250ms flush + integration test that proves collapsing.
- **`$collStats` perf on large deployments** — already handled with fallback from phase C; still applies for `listCollections` in this phase.
- **Virtualization layout glitches with variable-height rows** — Tree view's expanded rows break fixed-size virtualization. Fall back to `react-window`'s `VariableSizeList` (or skip virtualization for Tree entirely and rely on the 200-row threshold). Decide on implementation.
- **EJSON size blow-up** — `canonical: true` is verbose. 1000 docs × large fields can push IPC payloads past 10 MB. Add a soft guard in `QueryService.find` (refuse results with total EJSON size > 50 MB; surface as `INTERNAL`). Same guard pattern as aggregation in A04.
- **`react-hooks/set-state-in-effect`** keeps biting us — workspaces need a lot of derived state. Plan: isolate most state transitions into reducer actions triggered from event handlers, not effects. Use `useEffectEvent` once React 19 ships it stable.

## When you're ready

Answer the seven open items at the top. Say "go" and I'll start with Step 1.
