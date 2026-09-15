# Plan — Workspace component decomposition

**Branch:** `refactor/workspace-decomposition`
**Base:** `main` @ `8441b79`
**Status:** complete, unpushed. Phase 1 landed 24 characterization tests
(`aab3aaf`), plus one more for guardrail 3 (`604691f`). Phase 2 landed R1
(`5eeda76`), R2 (`c01f1f6`), R3 (`9326a25`), R4 (`a051ae7`) and R5a
(`fa4ec87`). **R5b was dropped mid-branch** — see §6/R5 for the dependency
count and §9.4 for what replaces it. The maintainer confirmed the de-scope on
2026-08-23; it has since shipped, as
*`DbCollectionNavigator` cache and tree-state decomposition* (P2, L).

Gates run on `fa4ec87`: `tsc -b` clean; `lint` 0 errors / 10 pre-existing
warnings; `npm test` 1482 + 603 + 1135; `test:mutation` 93.42 vs the 90
threshold; `audit:ipc` OK over 64 files plus a hand-run of the
`ipc-channel-auditor` checklist (that agent type is not registered in this
session) returning PASS; `test:e2e` 66/66. Reviewer bot still owed — it needs
the branch pushed.

One environmental note from the E2E run: `conn-test-probe.e2e.ts` boots a
`mongodb-memory-server` and timed out at 60s when the suite ran alongside
another busy process (8.1 min wall clock). Alone it passes in 6.6s, and the
clean full run took 1.8 min. Not a defect on this branch, but that file is
fragile under CPU contention.

Derived from [`REACT-ELECTRON-ARCHITECTURE-REPORT-2026-08-13.md`](../docs/REACT-ELECTRON-ARCHITECTURE-REPORT-2026-08-13.md)
P2 items 8–9, and from the Vercel composition rules that report already
validated. This plan is the concrete sequencing of P2 #8: *"Make `Workspace` a
thin screen coordinator."*

---

## 1. Goal — and the honest size of it

Move **19 of `WorkspaceInner`'s 25 `useState` calls** into four named hooks,
plus one pure module, each extraction behind an existing or newly added test.

What that leaves behind, stated up front so nobody reads "thin coordinator"
into this plan:

| Block | Approx. lines | Status after R1–R5 |
| --- | --- | --- |
| Dialog state (12 hooks) + callbacks | ~350 | extracted (R3, R4) |
| Layout/prefs state (7 hooks) + load effect + writers | ~200 | extracted (R2) |
| Delete-mode decision | ~65 | extracted and made pure (R1) |
| Collection callbacks + `workspaceActions` / `workspaceMeta` / `collectionCommands` (`~963–1330`) | ~370 | **untouched** — see §9 |
| The JSX body (`~1900–2795`) | ~900 | **untouched** — see §9 |

`src/pages/Workspace.tsx` is 2797 lines today. This branch takes it to roughly
1600–1800, not to a thin screen. Getting the rest is a second branch, and
pretending otherwise here would make this one unreviewable.

**Measured after R4: 2797 → 2387, not 1600–1800.** The estimate above was
wrong, and the table's fault is that it counted each block as *removed* when
the extraction leaves a destructure and a set of named call sites behind. The
seven inline JSX lambdas R4 moved, for instance, became seven named callbacks
referenced from the same seven places — the decision left the file, the
reference did not. Corrected here rather than argued in the PR. The four
extractions are worth what they are worth: `Workspace.tsx` no longer owns any
`ui.workspace.` pref key, any connection-dialog transition, or the delete-mode
decision. It is still a long file, because §9's two big blocks are still in
it.

## 2. Non-goals — and why

The architecture report lists these under **Deliberately not recommended**.
This plan honours that list; each item below was a candidate and was rejected.

| Rejected | Reason |
| --- | --- |
| Split `StageAccordion.tsx` (1104 lines) into sibling files | Mechanical file splitting. `StageRowProps`' booleans (`active`, `dragging`, `dragOver`, `stale`, `previewLoading`) are transient interaction state, not mode flags, so the explicit-variant rule gives no win. `gitnexus impact StageAccordion` also reports **HIGH** risk against 2 processes for zero behaviour gain. |
| Move `NavRow` / `DbRow` / `CollRow` / `HoverBarButton` to their own files | Same reason. If a file move falls out of a state extraction below, it ships as a byproduct — never as its own step. |
| Replace `useWorkspaceTabs()` props with a context | CLAUDE.md makes the single call site load-bearing. The report calls the current hook-plus-props shape "the current-doctrine shape". |
| Split the `{state, actions, meta}` context into read/action contexts | The report permits this **only after profiling finds a hot path**. No profiling has been done. |
| Add a store (Zustand/Redux), TanStack Query, or a renderer service layer | Report §"Deliberately not recommended". |
| Remove existing manual memoisation | React 19 official guidance: leave it in place. |

**The filter applied to every step below:** does it move a *state seam*, or
does it move *lines*? Only the first qualifies.

## 3. Guardrails — invariants no step may break

1. Exactly one `useWorkspaceTabs()` call site (`src/pages/Workspace.tsx`).
   Children keep receiving tab state and `patchCollectionState` as props.
2. No renderer import of `electron`, `mongodb`, `better-sqlite3`, `ssh2`, or a
   Node built-in. The `check-renderer-purity.mjs` PreToolUse hook enforces
   this at edit time.
3. The `key={prefsReady}` remount of the `PanelGroup` stays. Panels render at
   default size, then remount once with persisted sizes. Losing that remount
   ships a layout-shift regression that no current test catches.
4. The three delete modes (single doc / delete-all-matching / delete-selected)
   stay **mutually exclusive**, and both documented refusals hold: an
   unresolvable `$in` filter (T0.4) and an invalid `queryRaw` must keep
   the dialog shut rather than falling through to `filter ?? '{}'`, which
   deletes the whole collection.
5. No new IPC channel. This refactor is renderer-only; `shared/ipc.ts`,
   `electron/preload.ts`, and `electron/**` are untouched.
6. Every extracted hook keeps its `api.*` calls where they are today —
   fire-and-forget `prefs.set`, `void`-ed and `.catch(() => {})` — so failure
   behaviour is unchanged.

## 4. Existing coverage — the audit that shapes the order

| Seam | Existing coverage | New tests needed |
| --- | --- | --- |
| Navigator caches, refresh, dedup, reconnect refetch | `navigator-cache.spec.tsx` — 20 tests, incl. dedup, residual windows, stale closures, cross-connection | **none** |
| Navigator connect failure / cancel | `navigator-cancel-and-failure.spec.tsx` — 12 tests | **none** |
| Navigator admin dialogs (create/rename/drop coll/drop db) | `navigator-admin-actions.spec.tsx` — 11 tests, incl. wrong-connection guards | **none** |
| Navigator disconnect / edit connection | `navigator-disconnect.spec.tsx`, `navigator-edit-connection.spec.tsx` | **none** |
| Delete modes wiring in `WorkspaceInner` | `DeleteConfirm` tested in isolation only; wiring is **e2e-only** (`w09-doc-edit-delete`, `w09b-doc-delete-all`) | **yes — T1** |
| Insert / duplicate / edit-doc wiring | drawers tested in isolation only; wiring is **e2e-only** (`w09c-insert-many`) | **yes — T2** |
| Add-connection, delete-connection, expanded connection table | `connection-switcher.spec.tsx` already mounts the full page and covers create-and-connect plus the switcher wiring. Not e2e-only, as an earlier draft of this table claimed. What it does **not** cover: the open-time snapshot and focus return from a table row | **yes — T3, narrowed to those two** |
| Panel widths / splits / collapse prefs | `panel-sizes.spec.ts` covers the pure maths; `resize-handle-edges.spec.tsx` covers the handle. The `WorkspaceInner` wiring has **no coverage** | **yes — T4** |

E2E is not a substitute here: per CLAUDE.md, `npm run test:e2e` is
`workflow_dispatch`-only and a PR into a feature base triggers no CI at all.

---

## 5. Phase 1 — tests first

Four new component test files. Every one mounts `render(<Workspace />)` and
drives the real DOM with a mocked `window.atelier`, following the shape of
`navigator-disconnect.spec.tsx`. **No test may reach into `WorkspaceInner`'s
internals** — a test that asserts on internal props locks in the structure
Phase 2 changes and has to be rewritten by step R2, which defeats the point.

These are characterization tests. They are written against **current**
behaviour and must pass on the unmodified tree before any refactor starts.
A test that needs an edit to `src/` to go green is a bug in the test.

**One carved exception, decided now rather than mid-phase.** Both existing
selection tests — `result-bar-delete-all.spec.tsx` and
`selection-action-bar.spec.tsx` — mount `ResultBar` / `ResultViewer` in
isolation under `CollectionWorkspaceProvider`. Nothing anywhere drives result-row
selection from a full `<Workspace />` mount through the virtualized view in
jsdom. So the two delete-selected cases (T1.4, T1.5) do **not** get a component
test; they land as unit tests on `resolveDeleteDialog` in R1, where Stryker also
holds them. Same protection, honest ordering. The rule above still binds
T1.1–T1.3, T1.6, T1.7 and all of T2–T4.

**Measured, not assumed.** Mutating `deleteSelectedActive` at
`Workspace.tsx:2648` down to `deleteSelected !== null` leaves all 1134
component tests green. The T0.4 guard is therefore genuinely naked going into
R1, and this carve-out is a real gap rather than a formality. It is not
circular to close it in R1: `buildDeleteSelectedFilterJson`'s `null` return is
already pinned independently by `tests/unit/selection.spec.ts:76,80`, so R1's
resolver test proves the resolver *honours* that null instead of re-deriving
the guard it is testing.

### T1 — `tests/component/workspace-delete-modes.spec.tsx`

Highest value in the plan: guardrail 4 protects two documented
delete-the-whole-collection hazards, and today nothing but E2E holds them.

1. Row "Delete" opens `DeleteConfirm` with `docs=[doc]` and no `filter`.
2. Result-bar "Delete all matching" with a valid filter passes that filter.
3. Delete-all with blank `queryRaw` → dialog does **not** open.
   Same for invalid EJSON.
3b. An **already-open** delete-all dialog closes itself when the filter text
   goes invalid underneath it. This is the second, separate guard —
   `openDeleteAllModal` refuses at open time, the render block re-checks every
   commit. Testing only the first leaves the second naked: a mutation of
   `deleteAllActive` at `Workspace.tsx:2658` survived the whole suite until
   this case existed. R1 moves exactly that guard into `resolveDeleteMode`, so
   the case has to be written before R1 or the proof is circular.
4. *(unit, in R1)* "Delete selected" builds the `$in` filter from the revived
   `_id` values.
5. *(unit, in R1)* Delete-selected where no selected doc carries `_id` →
   mode resolves to `none`, so the dialog stays shut (T0.4).
6. `onClose` clears all three states; `onDeleted` clears them and re-runs the
   query.
7. `readOnly` reads off the **Focused Tab's** connection, not the active one.

### T2 — `tests/component/workspace-doc-dialogs.spec.tsx`

1. Toolbar "Insert" opens `InsertDrawer` with the default `{}`.
2. "Duplicate document" opens it pre-filled with the source EJSON minus `_id`
   (T2.6).
3. Closing after a duplicate clears `duplicateDocJson`, so the next plain
   Insert is empty again.
4. `onInserted` closes the drawer and re-runs the query;
   `onPartialInsert` re-runs without closing.
5. Row "Edit" opens `EditDrawer` with that document; `onSaved` closes and
   re-runs.

### T3 — `tests/component/workspace-connection-dialogs.spec.tsx`

Covers what `navigator-disconnect` / `navigator-edit-connection` do not.

1. "Add connection" opens the form in create mode; a save closes it and
   refreshes the connection list.
2. Per-row delete opens the confirm with the name and tab count **snapshotted
   at open time** — they must not change when `connections` / `tabs` refresh
   while the dialog is open.
3. Confirming a delete closes that connection's tabs and removes it locally.
4. Opening the expanded connection table, then a dialog from a table row,
   returns focus to the Switcher control that opened the table, not to the
   detached row button.

### T4 — `tests/component/workspace-panel-prefs.spec.tsx`

Must `await` past the prefs load. Asserting before it resolves reads the
defaults and passes vacuously.

1. With `api.prefs.get` returning a stored **boolean** pref
   (`sidebarCollapsed`), the panel reflects it once the `prefsReady` gate
   clears.
2. `api.prefs.get` rejecting still clears the gate — no hang — and leaves the
   defaults.

**Correction to an earlier draft.** T4.1 and T4.2 originally asked for
assertions on the numeric panel sizes and on the `PanelGroup` remount count.
Neither is observable in jsdom: `tests/helpers/jsdomSetup.ts` installs a no-op
`ResizeObserver`, so `react-resizable-panels` never serializes a percentage
size to any DOM attribute, and the remount leaves no trace to count. Both
cases were redirected to the one observable pref and to the
`prefsReady`-dependent "Loading workspace…" gate, each verified by breaking
the source and watching the test go red.

**Guardrail 3 is covered after all** — through DOM node identity rather than
sizes. A remount replaces the group's subtree, so the `v-main` panel element
captured before `prefsReady` flips is a different object afterwards. The test
holds `prefs.get` open, captures it, releases, compares, and pairs that with a
control assertion on the navigator's resize handle — which lives outside the
`PanelGroup` and must keep its identity across the same flip, so a whole-page
remount cannot pass. Verified by deleting the key: exactly that one test
fails.

The **horizontal** group's `h-${prefsReady}` key can never flip.
`initialLoadPending` (`!prefsReady || connectionsLoading`,
`Workspace.tsx:667`) gates the subtree containing it, so it first mounts with
`prefsReady` already true. Inert today, load-bearing again if that gate
changes — left in place and documented rather than asserted on or deleted.
3. Dragging the navigator handle writes `ui.workspace.leftWidth`.
4. Dragging the reference-drawer handle writes `ui.workspace.refDrawerWidth`.
5. Committing the builder split writes `ui.workspace.innerHSplit`; the shell
   split writes `ui.workspace.shellSplit`.
6. The sidebar toggle writes `ui.workspace.sidebarCollapsed`; the builder
   toggle writes `ui.workspace.builderCollapsed`.
7. A rejected `prefs.set` does not throw into the render.

**Phase 1 exit:** `npx tsc -b`, `npm run lint`, `npm test` all green with
zero `src/` changes. Commit the tests on their own.

---

## 6. Phase 2 — the refactor

One commit per step. Run `gitnexus impact <symbol> --repo mongo-lab` before
editing each symbol and report the blast radius; run `gitnexus detect-changes`
before each commit. Recorded so far:
`WorkspaceInner` LOW (1 caller), `DbCollectionNavigator` LOW (1 caller),
`StageAccordion` HIGH (which is one reason it is out of scope).

### R1 — extract the delete-mode resolver (pure)

`src/pages/Workspace/deleteMode.ts`

The delete block at `Workspace.tsx:2637–2700` is an IIFE inside JSX that
computes three mutually-exclusive modes and two refusals. Lift the decision
into a pure function:

```ts
export type DeleteDialogState =
  | { open: false }
  | { open: true; docs: unknown[]; filter: string | undefined };

export function resolveDeleteDialog(input: {
  deleteDoc: unknown | null;
  deleteSelected: unknown[] | null;
  deleteAllFilterJson: string | null;
}): DeleteDialogState;
```

**The three-mode tagged union this section originally proposed was dropped.**
It is not isomorphic to current behaviour. When `deleteDoc` and
`deleteSelected` are both set, today's JSX yields `docs=[deleteDoc]` *with*
`filter=deleteSelectedFilterJson` — `docs` prefers one mode, `filter` prefers
another. `DeleteConfirm.tsx:49` computes `isMulti = docs.length > 1 || !!filter`,
so that pair takes the deleteMany path against the `$in` set while displaying a
single document. Shipping an exclusive union would silently change that, which
makes R1 a behaviour change wearing a refactor commit message. The resolver
returns the prop pair the JSX passes today, the interleave is preserved
verbatim behind a `ponytail:` comment, and a unit test pins it as a documented
quirk. It is unreachable in practice — `DeleteConfirm` is modal and no setter
clears its siblings — so it is **not** filed as a discovered issue: filing
would make a pre-existing hazard a blocker on the refactor that merely made it
visible. Raised in the PR body instead.

`deleteAllOpen` is deliberately not a resolver parameter. The caller folds it
in (`deleteAllOpen ? currentFilterJson(...) : null`), preserving the lazy call.
Taking both would leave `deleteAllOpen && filterJson !== null` carrying a
provably-equivalent mutant Stryker can never kill, against a 90% gate.

**Stryker:** this is exactly the profile `stryker.config.json`'s `mutate`
array wants — pure, branch-heavy, fast deterministic unit coverage. Add
`deleteMode.ts` to `mutate` in this step and add
`tests/unit/deleteMode.spec.ts` alongside it, then drive its score to the 90%
break threshold before the step is done. Deciding this now, not at merge.

### R2 — extract `useWorkspacePanelPrefs()`

`src/pages/Workspace/useWorkspacePanelPrefs.ts`

Moves out of `WorkspaceInner`: `leftWidth`, `refDrawerWidth`, `innerHSplit`,
`shellSplit`, `sidebarCollapsed`, `builderCollapsed`, `prefsReady`, the
one-shot load effect, and the four fire-and-forget `prefs.set` writers.
`shellOpen` stays in the page — it is view state, not a persisted preference.

Returns `{ leftWidth, setLeftWidth, …, prefsReady, toggleSidebar, toggleBuilder }`.
`builderPanelRef` and the `expandBuilder` / `restoreBuilderWidth` focus
choreography stay in the page: they touch the `PanelImperativeHandle` and the
notch button, which are the page's DOM.

Precedent: `useResizableSplit.ts` (used by `ScriptTab`) is the existing
layout-logic-in-a-hook shape in this folder.

Guardrail 3 is the thing to watch. T4.1 is the test that catches it.

**One ordering did change, and it is verified inert.** Folding the
`prefs.set` write into `commitBuilderCollapsed` moves it from *after* the
imperative collapse/restore to *before* it:

```
main:   setBuilderCollapsed(next); collapse()/restore(); api.prefs.set(…)
branch: commitBuilderCollapsed(next) /* set + prefs.set */; collapse()/restore()
```

Not observable, and the reason is structural rather than "no test caught
it": `api.prefs.set` resolves to `ipcRenderer.invoke` through the preload
bridge, whose synchronous prefix only serialises arguments and posts a
message. It cannot re-enter React or touch `builderPanelRef`. The React
state update and the imperative call keep their original relative order in
the same tick; only the fire-and-forget IPC moved between them. The same
fold applies to `expandBuilder`, with the same reasoning.

### R3 — extract `useConnectionDialogs()`

`src/pages/Workspace/useConnectionDialogs.ts`

Moves out: `connectionFormTarget`, `deleteConnectionTarget`,
`disconnectTarget`, `disconnectReturnFocus`, `connectionTable`,
`tableReturnFocus`, and their ~15 open/close/confirm callbacks
(`openAddConnectionModal` … `handleConnectionSaved`).

Takes the collaborators it needs as arguments — `closeTabsForConnection`,
`refreshConnections`, `removeConnectionLocal`, `navigate` — rather than
reaching for them. The hook owns dialog state; it does not own connections.

Covered by T3 plus the two existing `navigator-*` connection tests.

### R4 — extract `useDocumentDialogs()`

`src/pages/Workspace/useDocumentDialogs.ts`

Moves out: `editDoc`, `deleteDoc`, `deleteAllOpen`, `deleteSelected`,
`insertOpen`, `duplicateDocJson`, and `openInsertModal`, `openDeleteAllModal`,
`openDuplicate`, plus the shared close/reset used by every mode.

Depends on R1 — the reset paths are simplest to move once the mode decision is
already a pure function. Covered by T1 and T2.

### R5 — extract `useNavigatorCaches()` and `useNavigatorDialogs()`

`src/pages/Workspace/DbCollectionNavigator/` (the component file becomes
`index.tsx`; the row components move with it as a byproduct, not as a goal).

**Split into R5a and R5b once the file was read against this text, and R5b
is dropped from the branch.** The two halves are not the same kind of change.

- ~~`useNavigatorCaches()`~~ — **deferred to §9.4.** It would own two state
  atoms (`caches`, `connectErrors`) and five refs, and would need roughly
  twelve values injected to do it — including `setExpandedConnId` and
  `setExpanded`, setters for state this plan explicitly keeps in the
  component. The status-event effect writes the first
  (`DbCollectionNavigator.tsx:482`), the auto-expand effect writes the second
  (`:549`). A hook that mutates state it does not own is not a state seam; it
  is a file move with a long argument list, which is the exact thing §2's
  filter exists to catch — the same test that killed the `StageAccordion`
  split. Being well tested (20 + 12 cases) makes it *safe* to move, not
  *right* to move.
- **R5a — `useNavigatorDialogs()`** — `menu`, `menuTrigger`, `createCollDb`,
  `renameTarget`, `dropCollTarget`, `dropDbTarget`, and their post-action
  refresh callbacks. Six atoms, no write to state it does not own, and its
  collaborators (`refreshDb`, `loadColls`, and the three `onXDropped` /
  `onCollectionRenamed` props) inject the same way R3's did. This one is a
  seam, and it ships. Covered by `navigator-admin-actions.spec.tsx`.

`expanded`, `expandedConnId`, `focusedId`, and `filter` stay in the component:
they are the roving-focus and virtualization state the row renderer reads
directly.

If a later step wants to hand this state down without prop-threading, use the
existing `{state, actions, meta}` provider shape (`CollectionWorkspaceProvider`,
`ResultSelectionProvider`) as **scoped dependency distribution only**. It is
not a render-performance change — the report is explicit that the current
context rerenders all consumers, and that splitting it needs profiling first.

### Order and why

R1 → R2 → R3 → R4 → R5 as written, but R5 is safe to pull forward at any point
— it is the one step that needs no new tests. R2 before R3/R4 because layout
state is the smallest self-contained slice and shakes out the extraction shape
cheaply.

---

## 7. Definition of done

This is a `src/**` change, so all eight gates apply. Per-step, run the fast
three; before the PR, run every one:

- `npx tsc -b`
- `npm run lint`
- `npm test`
- `npm run test:mutation` — including `deleteMode.ts`, newly added to
  `stryker.config.json`'s `mutate` array in R1
- `npm run audit:ipc`, then the `ipc-channel-auditor` agent for the 5-file
  contract — expected to be a no-op here (no channel touched), but the gate is
  still owed and still run
- `npm run test:e2e` — `gh workflow run ci.yml --ref refactor/workspace-decomposition`,
  or locally. CI runs nothing on a PR into a feature base
- Reviewer bot on the head commit; every finding fixed, answered, or filed
- Every issue filed out of this change closed

Plus the shipping checklist: the PR closes its issue or joins the "MongoLab
Backlog" project; review threads resolved once pushed; anything scoped out
filed as an issue and linked as a blocker; no amended pushed commits.

## 8. Risks

| Risk | Mitigation |
| --- | --- |
| A delete mode falls through to `filter ?? '{}'` and deletes a collection | T1.3 and T1.5 are written **before** R1, and `deleteMode.ts` goes under Stryker |
| The `prefsReady` remount is lost → layout shift on every launch | Guardrail 3, asserted through DOM node identity plus an outside-the-group control (see T4). Kills the mutation that deleting the key introduces |
| Focus-return regressions — invisible to typecheck and lint | T3.4 plus the existing `dialog-focus-return.spec.tsx` / `dialog-return-focus-to.spec.tsx` |
| A hook extraction accidentally creates a second `useWorkspaceTabs()` call | Guardrail 1; grep for the call site in review |
| Scope creep into `StageAccordion` / row-file moves | §2 is the filter; if a step cannot name the state seam it moves, it is not a step |

## 9. What this plan does not deliver

**Superseded on 2026-08-24 — two of the four deferrals landed on this branch
after all, and this heading no longer describes them.** Kept rather than
deleted so the ordering rationale below stays readable next to the outcome.

| | Outcome |
| --- | --- |
| §9.2 collection-callback reducer seam | **done** |
| §9.1 JSX body split | **done** |
| §9.3 `BuilderPane` / `ConnectionForm` variants | **open** — the mode-vs-interaction-state filter says close both; see below |
| §9.4 navigator cache / tree state (R5b) | **out of scope** — de-scoped 2026-08-23; since shipped |

The reducer seam (§9.2) did come before the JSX split (§9.1), for the reason
given when both were still pending: the reducer feeds the memoised
`{state, actions, meta}` value the view sections consume, so splitting JSX
around callbacks about to change shape is wasted motion. That held in
practice.

**The reducer seam's premise needed correcting before it could be
implemented.** It asserted every callback in the block was a transition on one
`CollectionTabState`; against the code it was 4 of 13. The rest route through
`ScriptTabState`, `AggregationTabState`, `setActiveView`, a pure effect, or an
IPC write. See `.claude/ADR.md` ADR-003 for the full sort — the honest yield was
three pure branches plus one constant, not "~370 lines become a reducer".

**The §9.3 filter was applied: `BuilderPane` closes, `ConnectionForm` was reworked.**
`BuilderPaneProps` has zero booleans. The file is not boolean-free, though:
`GroupView`'s `isRoot: boolean` is a mode discriminator by the ticket's own
test — fixed for an instance's life, it selects a distinct style branch, a
root-only `aria-label`, a suppressed remove button, and gated empty-tree copy.
The close verdict holds anyway, on the right ground: `GroupView` is unexported
and self-recursive (it calls itself with `isRoot={false}` to render a nested
group), so an explicit-variant split would need two mutually-recursive
components for a thing with no public boolean surface — nothing this filter
can act on from outside the file. `disabled`, `canMoveUp`/`canMoveDown`, and `readOnly`
on the other internal sub-components are transient interaction state or
renderer-only view state, the same ground `StageAccordion` was rejected on in
§2. `ConnectionForm` has one boolean,
`embedded`, which drives three style expressions and no behaviour. The real mode
discriminator there is `connectionId?: string` (absent = create, present = edit),
which is not a boolean and so fell outside that filter's literal wording. It was
brought into scope by maintainer ruling and fixed, because the shortfall was
real: the "hosts must remount rather than swap" contract was enforced by a doc
comment alone, while `loading` is seeded once from the mount-time mode and the
hydrate effect merges rather than resets. `ConnectionForm` now keys itself on
`connectionId` internally, and the create/edit split is a literal-discriminant
union (`mode: 'create' | 'edit'`) — the only shape TypeScript actually
enforces, since without a literal discriminant it merges the branches instead
of picking one.

Two follow-ups were filed from this work and neither blocks the base→main
merge: one (`PanelBody` takes 31 props — the split did not collapse its
surface, see ADR-004's corrections) and another (Definition-of-Done gate 5
cannot run from a session launched outside the repo).

1. **The JSX body** (`Workspace.tsx:~1900–2795`, ~900 lines). Splitting it
   means naming view sections — the panel scaffold, the collection pane, the
   dialog stack — and each one needs its own render-level test story. It is
   the single biggest remaining block and the one most likely to produce
   review churn if folded in here.
2. **The collection-callback block** (`~963–1330`): `patchActiveCollection`,
   `handleColumnResize`, `handleRowExpand`, `handleSortField`,
   `patchAggregation`, `patchSchema`, `updateField`, plus `workspaceActions`,
   `workspaceMeta`, and `collectionCommands`. This is the report's P2 #9
   reducer seam, not a hook extraction — the callbacks are transitions on one
   `CollectionTabState`, and turning them into a reducer is a design decision
   with its own unit-test surface. It also feeds the memoised
   `{state, actions, meta}` value, so touching it while also moving dialog
   state doubles the blast radius of a single branch.
3. **`BuilderPane` and `ConnectionForm`** — the report's named candidates for
   the explicit-variant rule (composition rule #1). Separate work, different
   test story.
4. **`useNavigatorCaches()`** (R5b, dropped mid-branch — see §6/R5 for the
   dependency count). Extracting it as written would hand a hook two setters
   for state it does not own. The honest version of this work is a different
   change: decide first whether `expandedConnId` / `expanded` belong *with*
   the caches — one reducer over navigator tree state — and then move the
   whole thing. That is a design decision with its own test surface, exactly
   like §9.2's reducer seam, not a hook extraction. `DbCollectionNavigator.tsx`
   stays at 2058 lines on this branch.

   De-scoped on request, 2026-08-23. Since shipped — the navigator cache and
   tree-state decomposition landed. The `QueryEditor` / `QueryBuilder`
   sub-slot deferral it sat beside is still open.
