# The tab-state reducer covers 5 of 13 callbacks, not all of them

## Status

accepted

## Context

This ticket asserts of the `Workspace.tsx` callback block:

> These callbacks are all transitions on **one** `CollectionTabState`. That is a
> reducer, not a hook extraction.

Read against the code at `ae603b6`, that holds for at most 5 of the 13. Taking it
at face value produces either a reducer padded with callbacks that do not belong
in one, or a ticket reported PARTIAL against a scope that was never achievable.

**The actual sort.**

| Callback | Routes through | Reducer-eligible |
| --- | --- | --- |
| `handleColumnResize` | `patchCollectionStateWith` → `columns` merge | **yes** |
| `handleRowExpand` | `patchCollectionStateWith` → `expandedRows` add/delete | **yes** |
| `patchSchema` | `patchCollectionStateWith` → `schema` defaults-merge | **yes** |
| `clearActiveFilter` | `patchCollectionState({queryRaw:'{}'})` | **yes** (a constant) |
| `handleSortField` | `sortFieldPatch(prev, field)` + `run(patch)` | **patch half only** |
| `patchActiveScript` | `tabs.patchScriptState` — `ScriptTabState` | no — different state |
| `patchAggregation` | `tabs.patchAggregationState` — `AggregationTabState` | no — different state |
| `selectActiveView` | `tabs.setActiveView` | no — not a state patch |
| `runActiveCollection` | `run(override)` | no — pure effect |
| `updateField` | `api.doc.updateOne` + `run` + `notify` | no — IPC write |
| `patchActiveCollection` | forwards an arbitrary patch | no — nothing to model |
| `patchActiveCollectionWith` | forwards an arbitrary updater | no — nothing to model |

## Decision

1. The pure module models **only** the four eligible transitions. Three real
   branches (`columns`, `expandedRows`, `schema`) plus one constant. That is the
   honest yield, and it is much smaller than "~370 lines become a reducer".
2. **`sortFieldPatch` is not absorbed — it is called.** It already lives in
   `builder.ts`, which is already in `stryker.config.json`'s `mutate` array with
   fast unit coverage in `builder-compile.spec.ts`. Moving it relocates
   mutation-scored code between two scored files for no gain and churns
   `builder.ts`'s score.
3. The impure half — the `activeCollectionRef` read, the `tabs.*` call, `run`,
   the IPC write — stays in a hook. The ineligible callbacks move into that hook
   unchanged, as pass-throughs. They are not forced into the reducer.
4. **`updateField` stays out of this ticket entirely.** It is the only write path in the
   app that reaches for the global `notify` toast, and it crosses IPC. Not a
   state transition, not in scope.

## Consequences

**The invariant a reducer refactor is most likely to break.** The comment above
`handleColumnResize` is load-bearing:

> Going through the functional-updater variant lets the merge run against the
> latest pending patch rather than `activeCollectionRef.current.state`, which lags
> the most recent `setTabs` by one render. Without this, two patches firing in the
> same tick would both base their merge on the same stale snapshot and clobber
> each other.

A reducer that takes `prev` from the ref instead of from the functional updater
reintroduces that bug, and a single-patch test cannot see it. **Two patches in one
tick, both surviving, is a required test.**

**Gate 4 is stronger than "combined stays green."** The new module goes into
`mutate` and owes **≥90% on its own score**, with the survivor list reported line
by line — per CLAUDE.md, each survivor is either killed by a tightened test or
proved equivalent with a real check. `expandedRows` delete-vs-set-false and
`schema` spread-order are the mutants that survive a happy-path test.

**`tests/component/workspace-actions-identity.spec.tsx` must keep passing
untouched.** An earlier ticket added it precisely as the guardrail for this ticket. This ticket
reshapes `workspaceActions`' dependency array, so it is the most likely casualty.
Needing to edit it is a signal to report, not a chore to absorb.
