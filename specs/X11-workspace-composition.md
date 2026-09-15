# X11 — Workspace composition refactor

> **Status: Shipped.** The phased migration below landed — `src/pages/Workspace/context.ts` (`CollectionWorkspaceContext`/`Provider`/`useCollectionWorkspace`), the `<ResultViewer>` compound component replacing the old `ResultArea` monolith, and `ScriptTab` as the second-consumer reuse case are all in the codebase (phases tagged in source comments as "X11 phase N"). The acceptance-criteria checkboxes below were not individually re-audited against final code — treat this spec as historical design record for the target shape, and prefer reading the current source under `src/pages/Workspace/` for the ground truth of what shipped.

## Purpose

Break the Workspace page (`src/pages/Workspace.tsx`, ~1500 LoC) into composable building blocks so:

1. **The Workspace itself** is a composition of reusable pieces rather than a tightly-coupled tree.
2. **Those same pieces** can be dropped into other views — saved-query preview, aggregation result reuse, future schema explorer — without forking or duplicating logic.

The seams already exist in part: `TreeView` / `JsonView` / `TableView` are reused by `ScriptTab`, and `AggregationTab` is nearly self-contained. The work below tightens contracts and extracts headless state so the rest of the Workspace reaches the same bar.

## Scope

### In
- New context provider scoping the active-collection slice for the Workspace subtree.
- Extraction of `run()` from `WorkspaceInner` into a `useQueryRunner` hook.
- Narrowed contracts on `ResultBar`, `TreeView`, `TableView` (no more fat `state: CollectionTabState` prop).
- Compound-component restructure for `<ResultViewer>`, `<QueryEditor>`, `<QueryBuilder>`.
- Collapse of the 3-level edit/delete/insert/save callback chain into provider-exposed actions.
- One concrete second-consumer demonstration to validate the seams.

### Out
- Any change to the `useWorkspaceTabs` contract — it stays a single call site at the page per CLAUDE.md.
- IPC envelope shape, channel names, `Envelope<T>` contract — untouched.
- EJSON parse boundary in `electron/preload.ts` — untouched.
- `shared/types.ts` remains types-only.
- Keyboard-shortcut extraction (`useWorkspaceShortcuts`) — possible follow-up; not load-bearing for reuse.
- `AggregationTab` internals (already portable). Only one cleanup: `darkMode` prop → `useT()`.
- Renaming `CollectionTabState` or restructuring tab persistence (`api.tabs.update`).

## Diagnosis (why this is needed)

Fat-prop coupling. `CollectionTabState` flows whole-cloth into `QueryBar`, `ResultBar`, `ResultArea`, `BuilderPane`, `TreeView`, `TableView`. Any new consumer would have to fabricate a full `CollectionTabState` or fork the components. Secondary symptoms:

- 3-level prop-drilling chains for `onEditDoc` / `onDeleteDoc` (page → `ResultArea` → `TreeView`/`TableView`).
- `run()` is a ~100-line closure inside `WorkspaceInner`; not unit-testable.
- Modal open state lives at the page level; triggers are 2-3 levels deep with no clean trigger surface.
- View switching uses a `view` discriminator inside `ResultArea` rather than explicit variants — adding a fourth view means editing the switch.

## 1. Target architecture

Three layers, additive on top of the existing hook:

```
useWorkspaceTabs()                            (unchanged, one call site in Workspace.tsx)
       │
       ▼
<CollectionWorkspaceProvider> ────────────── Layer 1: scoped context
       │   exposes { state, actions, meta }
       ▼
useQueryRunner / useCollectionStats / ... ── Layer 2: headless hooks
       │
       ▼
<ResultViewer> <QueryEditor> <QueryBuilder>   Layer 3: compound presentational
```

### Layer 1 — Scoped context (`CollectionWorkspaceProvider`)

A thin context that takes the active-tab slice + patcher as inputs from the page and exposes a generic interface to the subtree. The page (which owns `useWorkspaceTabs`) is the provider's input boundary; children don't know there's a tab system at all.

This satisfies both the **one-call-site** rule (no second `useWorkspaceTabs` call) and the Vercel `state-decouple-implementation` rule (provider is the only thing that knows how state is managed).

### Layer 2 — Headless hooks

- `useQueryRunner({ connectionId, dbName, collection, onResult, onError })` — extracts the current `run()` closure. Provider wires it once; consumers receive `actions.run()` from context.
- `useCollectionStats({ connectionId, dbName, collection })` — extracts the inline `api.meta.listCollections` call from `CollectionHeader`.
- `usePreviewFields`, `useReferenceRules` — already portable; unchanged.
- `useReferenceDrawer` — currently tab-aware; rewire to take `state` + `actions` from `useCollectionWorkspace()`.

### Layer 3 — Compound components

Three compounds replace today's monolithic shapes. Each exposes named subcomponents that read from `useCollectionWorkspace()`. No boolean configuration props — slots are either rendered or omitted (Vercel `architecture-avoid-boolean-props`, `patterns-children-over-render-props`).

## 2. Types

```ts
// src/pages/Workspace/context.ts (new)

export type CollectionWorkspaceActions = {
  patch: (p: Partial<CollectionTabState>) => void;
  patchWith: (fn: (s: CollectionTabState) => Partial<CollectionTabState>) => void;
  run: (override?: Partial<CollectionTabState>) => void;
  openEdit: (doc: unknown) => void;
  openDelete: (doc: unknown) => void;
  openInsert: () => void;
  openSave: (initial?: { name?: string; description?: string }) => void;
};

export type CollectionWorkspaceMeta = {
  connectionId: string;
  dbName: string;
  collection: string;
  tabId: string;            // 'preview' / synthetic ids allowed for non-tab consumers
  isLoading: boolean;
  isReadOnly?: boolean;     // for preview / read-only consumers; defaults to false
};

export type CollectionWorkspaceContextValue = {
  state: CollectionTabState;
  actions: CollectionWorkspaceActions;
  meta: CollectionWorkspaceMeta;
};

export const CollectionWorkspaceContext =
  createContext<CollectionWorkspaceContextValue | null>(null);

export function useCollectionWorkspace(): CollectionWorkspaceContextValue {
  const v = useContext(CollectionWorkspaceContext);
  if (!v) throw new Error('useCollectionWorkspace called outside <CollectionWorkspaceProvider>');
  return v;
}
```

The `state`, `actions`, `meta` triad matches the Vercel `state-context-interface` shape so a second consumer can supply a synthetic provider (e.g., `actions.patch = () => {}` for read-only views) without code changes downstream.

## 3. Compound shapes

```tsx
// <ResultViewer> replaces <ResultArea>
<ResultViewer>
  <ResultViewer.Pagination />
  <ResultViewer.Body>
    {view === 'tree' && <ResultViewer.Tree />}
    {view === 'table' && <ResultViewer.Table />}
    {view === 'json' && <ResultViewer.Json />}
  </ResultViewer.Body>
  <ResultViewer.EmptyState />
</ResultViewer>

// <QueryEditor> replaces today's <QueryBar>
<QueryEditor>
  <QueryEditor.Filter />
  <QueryEditor.SyncPill />
  <QueryEditor.Advanced />     {/* projection / sort / limit row */}
  <QueryEditor.RunButton />
  <QueryEditor.SaveButton />
  <QueryEditor.HistoryButton />
</QueryEditor>

// <QueryBuilder> replaces today's <BuilderPane>
<QueryBuilder>
  <QueryBuilder.Tabs />        {/* Builder / Saved / Recent */}
  <QueryBuilder.Conditions />
  <QueryBuilder.Projection />
  <QueryBuilder.Sort />
  <QueryBuilder.SavedStrip />
</QueryBuilder>
```

Read-only consumers omit slots they don't need or pass `readOnly` on individual leaves (e.g., `<QueryEditor.Filter readOnly />`). `readOnly` is a leaf-level affordance, not a top-level mode switch — Vercel `patterns-explicit-variants`.

## 4. Behavior changes

- **Edit / delete / insert / save** stop prop-drilling. `TreeView` / `TableView` / `CollectionHeader` / `QueryEditor.SaveButton` call `actions.openEdit(doc)` etc. directly from context. The page still owns the modal state (`InsertDrawer`, `EditDrawer`, `DeleteConfirm`, `SaveModal` render at root) but wires those state setters into `actions` once.
- **Run** invocation stays one stable reference (`actions.run`), wired by the provider via `useQueryRunner`. Page no longer needs `runRef.current` workaround.
- **View switching** moves out of `ResultArea`'s internal switch into explicit JSX in the parent (or a thin `<ResultViewer.ActiveView />` slot that reads `state.view` from context and renders the matching child). Either is fine; lean on the latter so consumers can default-render with one line.
- **Stats fetching** moves out of `CollectionHeader` into `useCollectionStats`. Header receives `docCount` / `indexCount` as optional props or pulls from `actions`/`meta` if added there.

## 5. Migration plan

Each phase ships independently. No big-bang rewrite.

| # | Phase | Risk | Effort | Description |
|---|---|---|---|---|
| 1 | Thin view-component contracts | low | S | `TreeView`/`TableView`/`ResultBar` take narrow props (`expandedRows`, `columns`, `page`, `pageSize`, `totalCount`, `lastRunHasMore`, `documents`, `durationMs`) instead of `state: CollectionTabState`. Page passes slices. `ScriptTab` consumes the new shape to verify. |
| 2 | Introduce `CollectionWorkspaceProvider` | low | M | New context + `useCollectionWorkspace()`. Wrap children once in `WorkspaceInner`. No consumer migrated yet — provider is dormant. |
| 3 | Migrate consumers onto context | medium | M | One PR per component: `QueryBar`, `BuilderPane`, `ResultBar`, view components. Each diff is small; tests confirm behavior. |
| 4 | Extract `useQueryRunner` | medium | M | Move `run()` closure into a hook. Provider wires it. Now testable in isolation; add unit tests. |
| 5 | Compound-component restructure | medium | M | Build `<ResultViewer>` with `Pagination`/`Body`/`Tree`/`Json`/`Table`/`EmptyState` slots; page composes explicitly. Edit/delete/insert/save already migrated to `actions.*` in phase 3 — that work counts here. `<QueryEditor>` / `<QueryBuilder>` sub-slot decomposition deferred (see note below). |
| 6 | Demonstrate reuse | low | S | Pick one validation target: either refactor `ScriptTab` to use `<ResultViewer>`, or build a saved-query preview shell. Validates the seams. |

Each phase is its own PR and its own commit boundary; phases 1, 2, and 6 are de-risked by `ScriptTab` and `AggregationTab` already proving the boundaries.

## 6. React 19 note

If on React 19, apply the Vercel `react19-no-forwardref` rule in the same pass: swap `forwardRef` for plain props + `use(Context)` instead of `useContext(Context)`. Check before phase 2 (`grep forwardRef src/`). Cheap; one-line per call site.

## 7. Second-consumer story (the Lego-brick sanity check)

A read-only **saved-query preview** in a side panel demonstrates reuse:

```tsx
<CollectionWorkspaceProvider
  state={syntheticStateFromSavedQuery(saved)}
  actions={readOnlyActions}
  meta={{ connectionId, dbName, collection, tabId: 'preview', isLoading, isReadOnly: true }}
>
  <QueryEditor>
    <QueryEditor.Filter readOnly />
    <QueryEditor.Advanced readOnly />
  </QueryEditor>
  <ResultViewer>
    <ResultViewer.Body><ResultViewer.Tree /></ResultViewer.Body>
  </ResultViewer>
</CollectionWorkspaceProvider>
```

No forks. No new props on the compounds. ~10 lines for the consumer.

## Acceptance criteria

### Phase 1 — narrow view-component props
- [ ] `TreeView` props: no `state: CollectionTabState`; explicit `expandedRows`, `onRowExpand`, `documents`.
- [ ] `TableView` props: no `state`; explicit `columns`, `onColumnResize`, `documents`, `sort`, `onSortField`.
- [ ] `ResultBar` props: no `state`; explicit `page`, `pageSize`, `totalCount`, `lastRunHasMore`, `docCount`, `durationMs`, `view`, `onViewChange`, `onPage`, `isLoading`.
- [ ] `ScriptTab` still compiles and renders without code changes beyond prop-shape updates.
- [ ] `npm test` green; no behavioral regressions in workspace integration tests.

### Phase 2 — provider
- [ ] `src/pages/Workspace/context.ts` exports `CollectionWorkspaceContext`, `CollectionWorkspaceProvider`, `useCollectionWorkspace`.
- [ ] `WorkspaceInner` wraps its Documents-view subtree in the provider; no consumer reads from context yet.
- [ ] Throwing the provider outside a consumer surfaces a clear error message.
- [ ] No change to `useWorkspaceTabs`.

### Phase 3 — consumer migration
- [ ] `QueryBar` reads `state`, `actions`, `meta` from context (no `state` / `onPatch` / `tabId` props).
- [ ] `BuilderPane` reads from context.
- [ ] `ResultBar` reads from context.
- [ ] `TreeView` / `TableView` call `actions.openEdit` / `actions.openDelete` from context; `onEditDoc` / `onDeleteDoc` props removed from these and from `ResultArea`.
- [ ] No `CollectionTabState` import left in any presentational component under `src/pages/Workspace/views/`.

### Phase 4 — `useQueryRunner`
- [ ] `run()` removed from `WorkspaceInner`; `useQueryRunner` extracted under `src/pages/Workspace/`.
- [ ] Provider wires `actions.run` to the hook.
- [ ] Unit tests cover: success path, error path, pagination override, count side-fire, EJSON wire shape.

### Phase 5 — compound restructure (`ResultViewer` only)
- [ ] `<ResultViewer>` exposes `Pagination`, `Body`, `Tree`, `Table`, `Json`, `EmptyState` slots.
- [ ] Page composes `<ResultViewer>` explicitly; the `<ResultArea>` monolith is removed.
- [ ] `<ResultViewer>` supports being rendered without a tab context, given a manually-constructed provider value.

### Phase 5 — deferred (sub-slot decomposition for `QueryEditor` / `QueryBuilder`)
Splitting `QueryBar` (~520 LoC) and `BuilderPane` (~900 LoC) into named sub-slots is high-effort with no current behavioral change — both monoliths already render portably inside any `<CollectionWorkspaceProvider>` after phase 3. Defer the slot extraction until a real second consumer needs to compose a subset (e.g. saved-query preview wants only `Filter` + `SyncPill`). Tracked separately; revisit when the need is concrete.

### Phase 6 — reuse demonstrated
- [ ] Either: `ScriptTab` renders its result view through `<ResultViewer>` (no direct `TreeView` / `JsonView` / `TableView` imports), or a new `<SavedQueryPreview>` consumer exists and renders against a synthetic provider.
- [ ] Component test exercises the second consumer end-to-end.

## Test cases

- **Unit**: `useQueryRunner` (extracted) — success, error, EJSON wire, count side-fire, cancellation.
- **Unit**: `CollectionWorkspaceProvider` value identity (actions are stable refs across renders).
- **Component**: `<QueryEditor>` slots render in isolation given a synthetic provider; `readOnly` leaves block input and run.
- **Component**: `<ResultViewer>` view switching renders the right body slot for each `state.view`.
- **Component**: edit/delete/insert/save actions fire via context, not via prop drilling.
- **Integration**: existing workspace flows (run query, paginate, edit doc, delete doc, save query) all still work after phases 3-5.
- **Integration**: second-consumer renders against a synthetic provider and successfully shows a result preview.

## Constraints

- `useWorkspaceTabs` stays single-call-site at `WorkspaceInner`.
- Provider value's `actions` object must be a stable ref (memoised at provider level) to avoid downstream re-render storms.
- Read-only consumers set `meta.isReadOnly` and supply no-op `actions.patch` / `actions.run`; leaves use `meta.isReadOnly` to short-circuit destructive UI without needing a per-leaf `readOnly` prop (the prop stays as an override for finer control).
- No new IPC channels. All channel calls already exist.

## Resolved decisions

- **Single combined provider.** `meta` carries `connectionId` / `dbName` / `collection`. No sibling `CollectionTargetContext`; we split later only if a real consumer needs to swap target without swapping the whole provider.
- **Page owns modals.** Provider exposes `actions.openEdit(doc)` / `openDelete` / `openInsert` / `openSave`, but the modal components (`InsertDrawer`, `EditDrawer`, `DeleteConfirm`, `SaveModal`) still render at the page root. Actions are wired to page-level `useState` setters by the provider's parent. Keeps portals and z-index handling simple; revisit only if a second consumer needs different modal UX.

## See also

- CLAUDE.md — "Renderer state" section: `useWorkspaceTabs` one-call-site rule.
- `.claude/skills/vercel-composition-patterns/` — pattern reference used to inform the design (`architecture-compound-components`, `state-context-interface`, `state-decouple-implementation`, `architecture-avoid-boolean-props`, `patterns-explicit-variants`, `patterns-children-over-render-props`).
- `src/pages/Workspace/ScriptTab.tsx` — already reuses `TreeView` / `JsonView` / `TableView`; existing proof of seam.
- `src/pages/Workspace/Aggregation/AggregationTab.tsx` — already nearly self-contained; model for portable feature shape.
