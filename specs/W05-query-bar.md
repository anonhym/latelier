# W05 — Query bar + bidirectional MQL sync

> **Status: Implemented.** §1–§10 shipped; the sync machine (§1) and sync pill (§2) are superseded by [W13](./W13-filter-tree-editor.md). Where §9 names a part of §2 or §6, §9 is what ships.

> **Partly superseded by [W13](./W13-filter-tree-editor.md).** W13 makes the
> filter text canonical and the drawer a view of it, which removes the sync
> problem rather than solving it: **§1** (the whole SYNCED/DIRTY machine) and
> the sync-pill bullets of **§2** are frozen as the shipped pre-W13 behavior.
> §3–§6 (run flow, keyboard, cancellation, error handling) are unaffected.

## Purpose

The single-line editor above the result area that shows the compiled MQL, accepts hand edits, and either stays in lockstep with the builder pane (W04) or goes "freeform" when the user types something the builder can't represent. Run is triggered here; syncing status is visible here.

## Scope

- **In**: Query bar UI, bidirectional sync state machine, Run button, hydration on builder change, hand-edit detection, "Re-sync builder" action, the notice beside Run, duration pill, document-count pill. A failed run replaces the results (W06 §5).
- **Out**: The runner (W03), result rendering (W06), pagination (W07).

## Dependencies

- W03, W04, W06, W10 (recent capture triggers on run), F04.

## 1. Sync state machine

State lives on the collection tab and persists.

```
              ┌──────────────────┐
              │  SYNCED          │   queryRaw === compile(builder)
              │  builder ↔ raw   │   queryDirty = false
              └─────┬────────────┘
                    │ user types in query bar
                    ▼
              ┌──────────────────┐
              │  DIRTY (parseOk) │   queryRaw !== compile(builder)
              │  parse succeeds  │   queryDirty = true
              │  → offer Accept  │
              └─────┬────────────┘
                    │  user clicks "Re-sync builder"
                    │  → hydrate builder from parse, queryDirty=false
                    ▼
              ┌──────────────────┐
              │  SYNCED          │
              └──────────────────┘

              ┌──────────────────┐
              │  DIRTY (parseNo) │   parse fails
              │  freeform        │   builder is frozen (read-only badge)
              └──────────────────┘
```

- From **SYNCED**: any change to the builder recompiles `queryRaw` and stays SYNCED.
- From **SYNCED**: any keystroke in the bar that results in a different string than `compile(builder)` transitions to **DIRTY** + runs `parseMqlToBuilder` (W04 §3).
- In **DIRTY**, the builder pane does NOT auto-recompile into the bar. Changing the builder while dirty silently keeps the current `queryRaw` but shows an overlay "Builder changes aren't applied. Re-sync or accept builder." with two actions: **Re-sync builder** (keep bar, parse into builder) and **Accept builder** (overwrite bar with builder-compiled MQL).
- Run works in every state, on the current `queryRaw`.

## 2. UI

Above the result area; matches mock.

```
┌─ Sub-tab row ───────────────────────────────────────────────────────────┐
│ [Documents][Aggregation][Structure]  shop / orders  180 docs  [References]│
└─────────────────────────────────────────────────────────────────────────┘
┌─ Query bar ─────────────────────────────────────────────────────────────┐
│ [▸ query][ { posted: { $eq: true }, … }      ][Save][History] | [Run ▾] │
└─────────────────────────────────────────────────────────────────────────┘
┌─ Result bar ────────────────────────────────────────────────────────────┐
│ [▲ N docs] · [▲ 42 ms]                        [pagination — W07]        │
└─────────────────────────────────────────────────────────────────────────┘
```

- Three bars sit above the rows: the sub-tab row, the query row, the result
  bar. The breadcrumb and References sit on the sub-tab row, beside the
  Documents / Aggregation / Structure tabs, so they show in all three views.
  Save, History and the Run split end the query row itself; any notice sits
  before them, so Run never moves. Below ~640px of query bar, Save and History
  shrink to icon buttons that keep their names.
- Input: monospace, grows to a max of ~12 lines (shift+enter newline).
- **Autocomplete** (X02): field-name suggestions appear at the caret in
  key positions (`{ sta`, `{ user.na`, `{ $or: [{ na| }] }`, etc.) and
  field-ref suggestions inside value-side `"$…"` strings. Wired via
  `useTextareaAutocomplete`. Replaces tokens in-place; caret is
  restored past the insertion via `requestAnimationFrame` +
  `setSelectionRange`.
- Sync pill:
  - **SYNCED** → green dot "⇅ synced".
  - **DIRTY (parseOk)** → amber "Re-sync builder" action button.
  - **DIRTY (parseNo)** → red "Builder disabled" badge with a tooltip reason.
  - Both DIRTY states also offer **Accept builder**, which overwrites
    `queryRaw` from the builder and returns to SYNCED. It is the deliberate
    counterpart to the builder no longer clobbering a hand edit (§1) —
    discarding the raw text has to stay possible, just never implicit.
- Run button primary. Disabled during in-flight runs; shows a spinner.
  Also disabled — with W04's tooltip — when the builder holds a condition
  the compiler can't encode and the tab is not dirty (W04 §7a).
  Checking `isValidEjson(queryRaw)` alone is insufficient: the mangled
  clause `compileMql` emits for those ops is valid EJSON.
- Result bar shows, in order:
  - `N documents` (or `—` if not yet run).
  - Duration `Xms`.
  - When the last run failed and left no rows, "Query failed" in the count's place; the error itself fills the results pane (W06 §5).
  - Pagination controls (W07).

## 3. Run flow

1. Compile args:
   - `filter = state.queryRaw` (tab's latest string).
   - `sort = state.builder.sort || undefined`.
   - `projection = buildProjection(state.builder.projection)` if any.
   - `limit = state.builder.limit ? Number(state.builder.limit) : pageSize`.
   - `skip = page * pageSize`.
2. Validate `filter` is EJSON. If not, abort: the rows stay, dimmed, and the reason shows beside Run.
3. `setPending(true);`
4. `const res = await api.query.find(FindInput)`.
5. Display: result bar updates with `documents.length` and `durationMs`. Pass `documents` to W06 result views via context.
6. `await api.query.count({...})` in parallel for the `totalCount` — separate spinner inside the doc-count pill.
7. Record ran into recent (W10) — handled server-side by the runner automatically; no additional client call.
8. `setPending(false)`.

## 4. Keyboard

- `⌘↵` / `Ctrl+Enter`: Run.
- `⌘L`: focus query bar and select all.
- `⌘⇧⌫`: clear query bar (reset to `{}` in SYNCED state).
- `Esc` while focused in bar: cancel in-flight run via `query:cancel`.

## 5. Cancellation

Each run generates a UUID `cancelToken`, stored in a ref. If a new Run starts, the previous token is cancelled first. `Esc` cancels the current token. Cancelled runs resolve to a `CANCELLED` code in the envelope error which the UI silences (no banner).

## 6. Validation & errors

| Error                         | UX |
| ----------------------------- | -- |
| Client-side invalid EJSON     | The reason, in a line beside Run that moves nothing; Run disabled until fixed. Rows stay, dimmed. |
| `NETWORK`/`UNAUTHORIZED`      | Results pane: the error, with Run again (W06 §5). |
| Anything else the server refuses (`VALIDATION`, `MONGO_ERROR`, `TIMEOUT`) | Results pane: the whole error, with Revert to last valid query (W06 §5). |

## 7. Acceptance criteria

- Edits in the builder pane update the query bar instantly in SYNCED.
- Typing in the bar flips to DIRTY and stops auto-recompile.
- "Re-sync builder" successfully parses and updates the builder (W04 §3 contract).
- "Accept builder" overwrites the bar.
- ** Builder edits while DIRTY — including click-to-sort on a
  result column (`sortFieldPatch`) — leave `queryRaw` and `queryDirty`
  untouched.
- Run honors the current `queryRaw` regardless of sync state.
- `⌘↵` runs; `Esc` cancels.
- A run the client refuses keeps the rows, dimmed. A run the server refuses replaces them with the error (W06 §5).
- The result bar reflects `documents.length`, count (when available), duration, and error state correctly.

## 8. Test cases

### Component
- **sync-happy.spec.tsx**: change a builder condition → bar updates; sync pill stays SYNCED.
- **dirty-parseable.spec.tsx**: hand-edit to `{ amount: { $gt: 10 } }` → DIRTY pill offers Re-sync. Click it → builder reflects the new condition; SYNCED again.
- **dirty-freeform.spec.tsx**: hand-edit to `{ $expr: { … } }` → DIRTY (parseNo); builder pane is disabled.
- **run-uses-queryRaw.spec.tsx**: set DIRTY, click Run → mock `api.query.find` receives the raw bar text, not the builder-compiled MQL.
- **invalid-ejson.spec.tsx**: bar contains `{ not json` → Run disabled; the reason shows beside Run.
- **cancel-esc.spec.tsx**: start a run (mock resolves after 2s); press Esc → `api.query.cancel` called; no banner shown.

### Integration
Cross-covered with W03 (query runner).

### E2E
- **workspace-run.e2e.ts**: open a seeded coll → builder has one condition → Run → result appears; hand-edit to freeform → builder disabled; Re-sync bar into builder → builder repopulates.

## 9. Amendment — the Filter Bar row

> **Implemented.** It supersedes §2's layout and §6's inline notice, and with [W14 §10](./W14-query-bar-advanced-row.md) the `QUERY` disclosure. The run flow (§3), cancellation (§5) and the Run gate are unchanged.

### 9.1 The row

One row, 44px, the full width of the main area:

```
[Filter]  [ { status: "shipped" }                 ]  [Sort] [Project] [Limit] [⋯ More]   [Builder]  [History ▾] [☆]   [▶ Run ⌘↵ |▾]
```

- **`Filter`** is a visible label naming the editor. The editor had no label and a placeholder of `{}`; nothing said what it was for. Placeholder: `{ field: value } — press ⌘↵ to run`. `⌘L` focuses it.
- **Run** is the row's, and the view's, only filled button.

### 9.2 Option pills

- Each query option is a 24px pill. Unset, it is a ghost label (`Sort`). Set, it is soft-filled and states its value: `Sort: _id ↓`, `Project: 3 fields`, `Limit: 100`.
- A pill opens a small popover holding that option's existing editor: the same input, the same Shell Syntax handling, the same validation.
- **Projection is a pill** (`Project`), beside the options it belongs with. It was a `Fields` button one band lower, next to References, so one query's parameters sat in two bands.
- `⋯ More` holds Skip, Collation, Hint, Max time and Read preference. One that is set is promoted to a pill of its own. Skip stays read-only, driven by the pager.
- A pill whose value cannot run is drawn in the error colour; the reason is in the error strip (§9.3).
- **Keep options expanded.** A checkable item in `⋯ More`, stored per tab. While on, the options show as today's always-open grid under the row, and the pills are not drawn. It exists for the user who sets sort, limit and hint on every query and would rather not open three popovers. A tab that loads a saved query with options set does not turn it on; the set options show as pills.

### 9.3 Error strip

- When the query cannot run, a full-width strip sits directly under the row, `role="alert"`: `⚠ Line 1, column 3 — unexpected text after the filter`. It is never truncated and wraps to two lines. When the parser gives a position, that range is underlined in the editor.
- It reports the first problem in clause order (filter, sort, projection, options) and names the option when it is not the filter.
- It appears at the points a refusal appears today (blur, a Run attempt), not on every keystroke, so rows do not jump while the user types.
- Run, when the gate is closed, carries the reason as its label: `Fix filter to run`, `Fix sort to run`. The reason used to be clipped to about twenty characters in the gap beside Run, with the rest in a tooltip.

### 9.4 Shell Syntax while typing

See [X14 §11](./X14-shell-syntax-input.md): text that is valid Shell Syntax is never reported as invalid, and Run stays enabled for it.

### 9.5 Run and its feedback

- The split menu lists `Explain plan`, `Explain with execution stats`, `Explain all plans` (the verbosity names were shown raw), then `Copy query as…` with mongosh, Node.js and Python. mongosh output uses unquoted keys and `ObjectId()` / `ISODate()` literals; the Python snippet imports only what it uses.
- **While a query runs**: Run becomes Cancel; a 2px indeterminate bar runs under the row; the results region is `aria-busy`; the result bar's count slot reads `Running · {elapsed}`, updated each second; the previous rows are marked as previous results ([W06 §8.2](./W06-result-views.md)).
- **After it completes**, the result bar's count always shows the duration.
- **After a cancel**, a one-line notice reads `Cancelled after {elapsed} — showing previous results` for a few seconds.

A 3.5-second query used to change nothing on screen but the Run button's label, and the finished run showed no duration at most widths.

### 9.6 Saved and History

- `History ▾` and `☆` (Save) in the row are the only entry points. Each opens a 360px popover with a search box; ↑↓ move through the list and show the highlighted entry's query text beside it, Enter loads it.
- The Query Builder's **Saved** and **Recent** tabs are removed ([W09 §12](./W09-saved-queries.md), [W10 §6](./W10-recent-preview.md)). Every feature had two homes; this one keeps the one beside Run.

### 9.7 The Builder toggle and the Inspector

- **`Builder`** is a labelled button in the row, pressed while the builder is open, bound to `⌘⇧B`. It replaces an 8px notch on the panel's edge as the way to open it.
- The right-hand panel is the **Inspector**: resizable from 320 to 640px (400 by default), with a 36px header holding its title, a tab switch and close (Esc).
  - **Filter**: the Query Builder, without the Saved and Recent tabs. Its footer keeps Reset, Copy code ▾ and Open as pipeline.
  - **Plan**: the explain view, opened from the result bar's plan badge or from the Run menu. It was a drawer over the results.
- The Inspector is **closed by default**: a profile with no stored choice starts with it closed; a stored choice wins. Open, it used to take a fifth of the width to show an empty state.
- It does not host document editing, which stays in the Document Editor's modal ([W18](./W18-document-editor.md)). A row click does not open it.
- The result list stays visible and usable while it is open.

### 9.8 Acceptance criteria

- The editor has a visible `Filter` label; ⌘L focuses it from anywhere in the Documents view outside a dialog.
- Sort, Project and Limit are pills; setting one changes its label to state the value; clearing it returns the ghost label.
- A set Skip, Collation, Hint, Max time or Read preference shows as its own pill.
- No `Fields` button is in the canvas header; projection edits through the `Project` pill and runs as before.
- "Keep options expanded" shows the grid for that tab only, survives a tab switch and a relaunch, and is off for a new tab.
- An unparseable filter shows the whole message in the strip under the row, and Run reads `Fix filter to run`.
- The strip does not appear or change while the user is typing; it appears on blur or a Run attempt.
- The Run menu's explain items read as sentences, and `Copy query as…` copies a mongosh call with unquoted keys.
- During a run the indeterminate bar and `Running · {elapsed}` are present and the region is `aria-busy`; the completed run shows its duration; a cancel shows the cancelled notice.
- Saved and History open from the row; the builder has no Saved or Recent tab.
- The Inspector is closed for a fresh profile; `Builder` and ⌘⇧B open it on Filter; the plan badge opens it on Plan; Esc closes it.

### 9.9 Test cases

- **Unit**: the pill label for each option (unset, set, invalid); which options are promoted out of `⋯ More`; the Run label for each closed-gate reason; mongosh code output with unquoted keys and constructor literals, and the Python output's imports.
- **Component**: pills open their editors and commit through the same paths as the grid; "Keep options expanded" per tab (with a stateful wrapper, since the effect appears only after the patch round-trips); the error strip's text, wrapping and commit-point timing; the running state (bar, `aria-busy`, elapsed text with fake timers), the duration after completion and the cancelled notice; History and Saved popovers with keyboard preview; the Inspector's tabs, default-closed state and Esc.
- **E2E**: set a sort through its pill and run; type an unparseable filter, read the whole reason, fix it and run; run a slow query and cancel it; open the plan from the result bar.

## 10. Amendment — room for the filter

> **Implemented.** It amends §9.1's row, §9.2's pill group and §9.6's two buttons. The run flow, the Run gate, the error strip and the pills' editors are unchanged. Reviewed and agreed in Claude Design, on the canvas "Filter Bar row" (direction A and its collapse ladder).

### 10.1 Why

At a 1000px results pane the filter field got about 265px and the row's controls about 735px. A filter with a single condition (`{"name":{"$eq":"…"}}`) already wrapped inside the one-line textarea: its second line was clipped and a scrollbar appeared. Nothing gave way until 800px (the page-reset sentence) and 640px (Builder, History and Save as icons), so at 1000px every control still had its full label. The field had no border and no fill, so its edge was only where the text was cut.

### 10.2 The row

```
[Filter] [ { name: "x" }                                ⤢ ]  [Sort|Project|Limit|⋯]  |  [⧩] [☆ Save|Queries ▾]  |  [⇤] [▶ Run ⌘↵|▾]
```

- **The field is a box**: a 28px input with a 1px `--atelier-border-med` border, the `--atelier-bg` fill and the 6px radius, holding the textarea and Expand. Its edge is visible empty or full.
- **The field keeps at least 480px** while a control can still collapse (§10.3). Once every control has collapsed, the row stays on one line until the field would go under its 320px floor, then wraps. The field takes whatever is left over.
- **The option pills are one attached group**: Sort, Project, Limit and `⋯` in a 24px segment with a 1px border, 2px between pills. `⋯` keeps its menu (§9.2) and its accessible name `More options`; the menu also lists the row's own pills by their values, above the options to add. A set option is promoted as before. Each pill's label is capped with an ellipsis (its whole label is its tooltip). When set options outrun the group's room, the pills scroll inside the group rather than clip or push the field: `⋯` stays outside the scroll, and a pill opened from it or reached by Tab scrolls into view.
- **Builder is an icon toggle** (the filter icon), `aria-pressed` while the Inspector is open on Filter, its name and `⌘⇧B` in the tooltip and accessible name. It replaces the labelled button of §9.7.
- **Save and History are one split control**: `☆ Save` saves the current query (it keeps the `saved.create` hint anchor); `Queries ▾` opens one 360px popover with two tabs, **Saved** and **History**, and one search box, with §9.6's keyboard preview in both. The popover opens on the tab last used in this tab, Saved the first time. §9.6's rule holds: this control is the only entry point to saved queries and history.
- **The page-reset sentence ("Will jump to page 1 on run") is always its icon form**: `⇤` beside Run, the sentence as tooltip and as visually hidden text. It no longer takes about 170px of the field's room at any width.
- Run is unchanged and is still the row's only filled button. Two 1px dividers group the row: options | tools | Run.

### 10.3 Collapse steps

A pure `filterBarLayout(width)` in `toolbarLayout.ts`, in the shape of `canvasHeaderLayout`: ordered forms, the first whose fixed width leaves the field its minimum, else the last. Width is its only input. A set pill, a promoted option, a run in flight or a refusing Run never change the form; the Run slot is budgeted at its widest label (`Fix projection to run`).

| Form | Step taken | About from |
|---|---|---|
| 0 | Every label: `☆ Save`, `Queries ▾`, `Run ⌘↵` | 1178px |
| 1 | `queriesIcon`: Save and Queries as icons, `☆ \| ◷ ▾`, names in tooltips and accessible names | 1078px |
| 2 | `optionsFolded`: the pill group becomes one pill, `Options` or `Options · n` with n set options; its menu lists every option with its value and opens that option's popover anchored to the folded pill | 964px |
| 3 | `runCompact`: Run without `⌘↵`, no dividers; the field may shrink from 480px to its 320px floor | 786px |
| 4 | `wrap`: the field takes the first line whole; the controls move to a 36px second line, Run at its right end | below that |

The widths are the exact edges of `filterBarLayout`, from constants measured in the app at the theme's sizes, as `toolbarLayout.ts`'s other constants are. Run is budgeted at its widest label. "Keep options expanded" (§9.2) is unaffected: with it on, form 2 has no pills to fold.

### 10.4 Acceptance criteria

- At a 1000px results pane, a one-condition filter of about 45 characters shows on one line, with no scrollbar in the field.
- The field has a visible border and fill, empty and full, in both themes.
- At every width from 964px the field box is at least 480px wide; below that, at least 320px. The row stays 44px tall above form 4.
- The form depends on width only: setting Sort, Limit and Hint, or starting a run, at a fixed width leaves every control's form unchanged.
- Sort, Project, Limit and `⋯` read as one group; from form 2 they are one `Options` pill whose menu edits each option.
- Builder is an icon toggle with `aria-pressed` and `⌘⇧B` in its accessible name.
- `☆ Save` saves; `Queries ▾` opens one popover with Saved and History tabs; the Saved list's rename from the palette (X07 §13.12) lands in the Saved tab.
- The page-reset hint is the `⇤` icon at every width, its sentence readable by tooltip and screen reader.

### 10.5 Test cases

- **Unit**: `filterBarLayout` picks each form at its boundary and the last form below it; the form is identical for a row with no options set and one with every option set (it has no such input).
- **Component**: the Options pill's count and menu; opening an option from the folded menu anchors its popover and commits through §9.2's path; the Queries popover's two tabs, the last-used tab per workspace tab, and the palette's rename opening it on Saved; Builder's `aria-pressed`; the page-reset icon's hidden text.
- **E2E**: a geometry check beside `results-toolbar-no-clip.e2e.ts`: at each width in its size list, the field box meets its minimum, no control in `filter-bar-row` is clipped, the row is 44px tall above form 4, and a one-condition filter does not overflow its field at 1000px.
