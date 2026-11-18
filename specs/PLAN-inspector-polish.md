# Plan — Inspector polish (Filter builder and Plan tab)

**Status:** wave A, B1, B2 shipped in the first PR. B3 built on its own branch, B3e included (the model change and the toggles drawn on the canvas). B4, B5, waves C and D not started.
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
| Q5 | ObjectId date shown in the local time zone, not UTC (answered 2026-11-18). A setting will later let the user pick any time zone or the current one, so the date goes through one formatter that takes the zone as an argument | B3 |
| Q6 | Caps: lists 3 lines at rest and 8 while editing; objects 6 lines at rest; long text 4 lines (confirmed 2026-11-18) | B3 |

Out of this plan until separately specified, because each changes meaning and not only display:

- Relative dates that stay relative ("7 days ago" stored as such). Changes what a saved query holds.
- Distribution bars in value suggestions. Needs a sampling cost decision.
- Grouped digits in numbers. Locale risk; ship plain digits.

Drawn after the first cut, for B3: "a condition changing kind" and "a field with two types". Their note asks two more questions:

| # | Question | Recommendation | Slice |
|---|---|---|---|
| Q7 | A new field whose sample type the value reads as: convert on the spot with Undo, or only offer it? | Confirmed 2026-11-18: convert with Undo, as drawn. To become a setting later, so the behaviour hangs off one option with this as its default. | B3g |
| Q8 | "Match either" on a mixed field: keep it? | Confirmed 2026-11-18: keep it as a shortcut that turns the row into `$in` with one chip per type (`"75001"`, `75001`), an existing shape that round-trips. To become a setting later, so the offer hangs off one option with this as its default. | B3h |

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

B3 is the largest slice and is split in §7.

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

## 7. B3 — value editors, kind changes, mixed types

Second PR, on a fresh branch from `main`. Boards: "a value editor per kind", "long lists and big objects", "a condition changing kind", "a field with two types". Q5–Q8 answered before the slice that needs each.

### 7.1 What it builds on

No IPC channel, no main-process change. Everything reads the sample the builder already loads:

- `sampleSchemaSource.ts` fetches one blended sample per collection (up to 100 recent plus 100 random documents, deduplicated), cached 5 minutes, shared in-flight, invalidated after a write.
- `useStructureEntries` gives a `Map<path, SchemaSampleEntry>`; each entry has `types` (a count per type: `string`, `number` for int and double, `long`, `decimal`, `date`, `objectid`, `binary`, …), `frequency` and `distinct`.
- `checkFieldType` (`schemaSummary.ts`) only answers when one type holds 90% or more. Board "two types" needs the whole split, so B3h adds a pure helper beside it.
- `sampleValuesSource` lists a field's sampled values when it has 20 distinct or fewer; recent, last-run and validator-enum sources add to it.
- The tree's undo history (`filterHistory.ts`) is the Undo behind every inline "· Undo" link: the link calls the same `undo`, so it is one step, never a separate store.

### 7.2 Shared rules every sub-slice follows

- **One helper line.** At most one line under the box. When several apply, the most urgent wins: the error, then an Undo notice, then a type hint (mixed split, sample disagrees), then information (ObjectId date, parsed date). A pure `pickHelperLine` decides, so the order is tested once.
- **Nothing typed is lost.** A kind change converts when the text reads as the new kind and otherwise keeps the text, with the error (chip asked for it) or a hint (sample disagrees). Anything removed gets Undo.
- **Kinds stay `ValType`.** No new `ValType`: a sampled type with no editor (`binary`, `timestamp`, unknown) uses the `string` editor and the chip names the sampled type. Persisted tab state is unchanged.

### 7.3 Sub-slices

Commits on one branch, in this order. `BuilderPane.tsx` and `CondValueEditor.tsx` have one writer at a time.

| Slice | Change | Done when |
|---|---|---|
| B3a | Frame: `ValueBox` gets the helper slot and `pickHelperLine`; text grows to 4 lines, then scrolls (Q6). | Table test over every `ValType`: same frame, same error, chip at the right end. Unit test for `pickHelperLine` order. |
| B3b | Number and date. Date parts with the parsed preview as the helper line. | Component per kind. |
| B3c | ObjectId whole, with its date as the helper line, in the local time zone (Q5). Pure `objectIdTimestamp`, and a date formatter that takes the time zone as an argument (the local zone for now), ready for the time-zone setting. | Unit and property tests (round trip with `bson`'s `ObjectId.createFromTime`); added to Stryker `mutate`. |
| B3d | `$in`/`$nin` chips; paste splits on comma, newline and tab; caps 3 lines at rest, 8 while editing, footer with the count and "Show all" (Q6). Pure `splitPastedList`. | Unit and property tests for the splitter (no empty chips; join then split is a fixpoint); Stryker. Component: footer count. |
| B3e | Pattern with option toggles (`i`, `m`, `x`, `s`), no slashes drawn. Check first how `$regex`/`$options` are modelled today; if only a raw clause can carry options, stop and bring it back to the canvas. | Component; round trip through the filter bar keeps the options. |
| B3f | Object values: today a raw clause. Cap its editor at 6 lines at rest (Q6). No new object kind in this PR. | Component. |
| B3g | Kind changes (board "changing kind"). Pure `convertValue(text, from, to)` → converted text or "keep". Field change: empty box adopts the type and the chip flashes once; a readable value converts with "Changed to … · Undo" (Q7); an unreadable one keeps and shows "… is a number in every sampled document · Use number" ("every" only at 100%). Chip change: converts or keeps with the error. Operator `=` ↔ `$in`: first chip kept, the rest removed with Undo. | Unit and property tests for `convertValue` (a value converted to a kind and back is unchanged when both read it); Stryker. Component per case, with a stateful wrapper so the patch round-trips. |
| B3h | Mixed types (board "two types"). Pure `fieldTypeSplit(entry)` → types sorted by share. Chip shows the commoner type with a two-colour dot when the top share is under 90%; chip menu lists the sampled types first with "N% of sample"; hint "Skips the N% that store zip as a number · Match either"; "Match either" makes the row `$in` with one chip per type that can hold the value (Q8). Field not in the sample: plain string box, no hint. | Unit and property tests for `fieldTypeSplit` (shares sum to 100, order stable on ties via `localeCompare`); Stryker. Component per case. |

**B3e is built.** The model could not hold `$options` outside a raw clause, so a `$regex` with `$options` is now one condition that carries the letters (W13 §2a). The row shows four toggles under the pattern box (`i`, `m`, `s`, `x`); leaving `$regex` drops them with Undo; the Contains text starter is an empty pattern with `i` lit.

B3a comes first. B3b–B3f are independent of each other but share files, so they run one after another. B3g and B3h come last: they use the helper line and the chips the earlier ones build.

### 7.4 Specs and gates

Amend W04 (value editors, kind changes), W13 (`$in` round trip from "Match either") and the W17 note on `checkFieldType` if its doc moves. Run `spec-compliance-reviewer` on each. Full Definition of done chain once before the push; e2e adds a 400px check that a 3-line list stays under its cap and a row with a mixed field shows one helper line.
