# Plan — Inspector polish (Filter builder and Plan tab)

**Status:** approved design, nothing implemented. No branch, no issues filed, no spec amended yet.
**Evidence:** [`docs/research/inspector-sweep.md`](../docs/research/inspector-sweep.md) (findings D1–D7, F1–F11, P1–P5, S1–S2, measured against v0.21.0).
**Design:** the Claude Design canvas "Inspector sweep", reviewed and approved by the maintainer on 2026-11-17. Board names below refer to it.

This plan sequences the work. It does not restate the findings; read the sweep first.

## 1. What was decided

Decided in the review threads:

- A condition that cannot be applied keeps its error: red border on the value box, one sentence under it, the field named in the status line. Never passed over quietly.
- Line 1 of a condition is include box, field, operator, row menu. The value gets its own full-width line under it. From a 560px panel the value sits beside the operator.
- Kinds with nothing to type (boolean, null, `$exists`) stay on one line, as a toggle on the field's line.
- The layout follows the kind, never the length of the value.
- The operator box keeps the symbol (`=`, `!=`, `>`, `>=`, `<`, `<=`). Operators with no symbol keep their name. The stored operator, the filter bar text, saved queries and copied code do not change.
- The value box adapts to the kind (board "a value editor per kind"), under the nine cohesion rules in the note beside it. No quotes drawn around text, no slashes around a pattern, ObjectId shown whole with the date it carries under it.
- Large values are capped (board "long lists and big objects"): a resting height, an editing height, then scroll inside the box, with a footer giving the count and "Show all".

Taken from the approved canvas without a separate thread. Confirm before the slice that implements each, since the maintainer approved the canvas as a whole and did not answer these one by one:

| # | Choice drawn on the canvas | Slice |
|---|---|---|
| Q1 | Logic control reads `Match all / any / none`, operator name in the tooltip | B4 |
| Q2 | The footer goes; Reset query, Copy as code, Open as pipeline move to a `⋯` menu | C1 |
| Q3 | Type is a chip inside the value box, not a separate select (confirmed 2026-11-17) | B1 |
| Q4 | An empty `string` row gets the same red error as an empty `date` row (confirmed 2026-11-17) | A1 |
| Q5 | ObjectId date shown in UTC | B3 |
| Q6 | Caps: lists 3 lines at rest and 8 while editing; objects 6 lines at rest; long text 4 lines | B3 |

Out of this plan until separately specified, because each changes meaning and not only display:

- Relative dates that stay relative ("7 days ago" stored as such). Changes what a saved query holds.
- Distribution bars in value suggestions. Needs a sampling cost decision.
- Grouped digits in numbers. Locale risk; ship plain digits.

Not drawn, to be drawn and reviewed before B3 starts: a field switching kind, and a field whose sample holds two types.

## 2. Ground rules for the run

- One branch, one final PR into `main`. Slices are commits, not PRs.
- Every slice past wave A changes visible structure that the canvas already covers. Anything the canvas does not show goes back to the canvas before code.
- `BuilderPane.tsx` is 2143 lines and every wave-B slice touches it. One writer at a time on it; never two agents in parallel on this file.
- Per slice: `npx tsc -b`, `npm run lint`, the affected specs. The full Definition of done chain runs once, before the push.
- Defects in wave A are pre-existing. Each is filed as its own issue at the start of the run, with `priority:` and `effort:` labels, and closed by the PR.
- Specs amended in the same PR as the code: W04, W13, W05 §9.7, A06, and the symbolic-operators section of ADR 0004. Run the `spec-compliance-reviewer` agent against each amended spec.

## 3. Where the code is

| Area | File |
|---|---|
| Panel frame, tabs, Escape handling, Plan pane host | `src/pages/Workspace/Inspector.tsx` |
| Toolbar, status line, footer, `CondRow`, `RawRow`, `GroupView`, `RowMenu`, `LogicPicker`, `RootAddControls`, `FilterDrawer` | `src/pages/Workspace/BuilderPane.tsx` |
| Value input per type | `src/pages/Workspace/CondValueEditor.tsx` |
| Value parsing and validation | `src/pages/Workspace/condValue.ts` |
| Tree model and filter compile | `src/pages/Workspace/builder.ts` |
| Operator symbols and labels (`QUERY_SYMBOLS`, `resolveOperatorSymbol`) | `src/features/fieldSuggestions/operators.ts` |
| Explain rendering | `src/pages/Workspace/Aggregation/ExplainDrawer.tsx` (find `ExplainBody` from `Inspector.tsx`) |

Existing tests to extend rather than duplicate: `tests/unit/condValue.spec.ts`, `condValue.property.spec.ts`, `builder-compile.spec.ts`, `field-suggestions-operators.spec.ts`; `tests/component/inspector.spec.tsx`, `query-builder-defects.spec.tsx`, `builder-operator-symbols.spec.tsx`, `explain-drawer.spec.tsx`; `tests/e2e/w03-builder-conditions.e2e.ts`, `builder-cond-row-width.e2e.ts`, `x14-builder-symbols.e2e.ts`, `a06-explain-plan.e2e.ts`.

File and symbol names above were read on 2026-11-17. Verify before building on them.

## 4. Slices

### Wave A — defects

No design input needed. A1 first: it changes what a query returns.

| Slice | Change | Done when |
|---|---|---|
| A1 | D1 and D4. An empty `number`, `long`, `decimal` or `string` value is a not-applied error, never `0` or `""`. One treatment for every empty kind. | Unit: empty value of each type yields a validation error and is left out of the compiled filter. Property: no empty value of any type ever reaches the filter. Component: status line names the field. |
| A2 | D2. Escape in a condition's field, operator or value input does not close the Inspector. | Component test with a parent `onKeyDown` spy, per the `stopPropagation` rule in CLAUDE.md. |
| A3 | D3. The operator suggestion list stays inside the window at every panel width. | E2E at 320, 400 and 640: list right edge ≤ window width. |
| A4 | D5. The value type follows the sampled type however the field input is left (Tab, Escape, click away). | Component: each exit path. |
| A5 | D6 and D7. Operator help present on every row or none (it moves into the operator list in B2, so remove it here if B2 is in the same run); `Counting…` with the ellipsis character. | Component. |

### Wave B — condition rows and groups

Order matters: B1 is the frame the others fill.

| Slice | Change | Done when |
|---|---|---|
| B1 | Two-line condition row (F1, F2). Line 1 field, operator, `⋮`; line 2 the value box with the type chip inside. `×` moves into the row menu. One-line toggle for boolean, null, `$exists`. Value beside the operator from 560px. Preview line only for a parsed date. | Board "Conditions · proposed" and "panel at 640". E2E: row height ≤ 80px for a one-line value at 400px; no layout change while typing. |
| B2 | Operator box keeps the symbol; list shows symbol, words, `$operator`. Amend ADR 0004. | Board "operator symbols". Extends `builder-operator-symbols.spec.tsx` and `x14-builder-symbols.e2e.ts`. Round trip: bar text and saved query still hold `$gte`. |
| B3 | Value editor per kind, inside the B1 frame, under the nine cohesion rules; large-value caps. Text, number, date parts, ObjectId with its date, list chips, pattern with option toggles, object editor. | Boards "a value editor per kind" and "long lists and big objects". One component test per kind; the shared frame, error and type chip asserted once over all kinds in a table test. Pure helpers (ObjectId timestamp, paste splitting) get unit and property tests and go into Stryker's `mutate` list. |
| B4 | One header per group (F3, F4): logic select, `NOT` toggle, one `Add` menu, `⋮`. Logic control hidden under two children. | Board "Groups · proposed". Component: a negated group has exactly one header and one add control. |
| B5 | Drop zones only during a drag (F5); "Try to parse" and "Edit as text" as real buttons (F7). | Component, with the explicit `dragend` dispatch jsdom needs. |

B3 is the largest slice. Split it per kind if it does not fit one sitting: frame and text first, then number and date, then ObjectId, list, pattern, object.

### Wave C — frame and flow

| Slice | Change | Done when |
|---|---|---|
| C1 | Empty state anchored at the top, toolbar reduced until there is a tree (F6). Footer actions into the `⋯` menu, Reset renamed `Reset query…` (F8). | Boards "Empty · proposed". |
| C2 | Status line: match count promoted, `Run ⌘↵` beside it when the tree differs from the last run (F9); "Removed · Undo" after a delete (F11); `Restore this filter` when the bar text does not parse (F10). | Component with a stateful wrapper, since staleness only shows after the patch round-trips. |
| C3 | Drop the "Inspector" title; tab rail runs to the close button (S1). | Component. |
| C4 | Panel width held in pixels, clamped so the results keep a minimum; when hidden for lack of room the `Builder` button stays pressed with a tooltip (S2). Closes the open narrow-width issue. | E2E at 1440, 1280, 1100 and 1024. Check how the width is persisted before changing its unit; a stored share must migrate, not reset. |

### Wave D — Plan tab

Capture the `executionStats` view in the running app first. The numbers row on the canvas is a proposal, not a redraw of something measured.

| Slice | Change | Done when |
|---|---|---|
| D1 | Stage tree is the summary; warning and index action attach to the offending stage (P1). Raw explain keys only behind `Raw JSON` (P2). | Board "Plan · proposed". |
| D2 | `Run with stats` in the summary; examined, returned, time lead when stats exist (P3). Plain verbosity labels with the API name in the description (P4). | Component and `a06-explain-plan.e2e.ts`. |
| D3 | One alignment for controls and footer across both tabs (P5). | Component. |

## 5. Suggested cut

The four waves do not have to ship together. A natural first PR is wave A plus B1 and B2: every defect, the new row, and the symbols. B3 is the bulk of the remaining work and can follow on its own once the two missing boards are drawn.

## 6. Gates

All eight Definition of done gates apply; this is a code change. No IPC channel is added by anything above, so the `ipc-channel-auditor` run is expected to be a no-change confirmation. If C4 or D2 turns out to need a new channel, the five-file contract applies in full.
