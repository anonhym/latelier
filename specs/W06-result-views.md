# W06 — Result views (Tree / JSON / Table)

> **Status: Accepted.** §1–§7 shipped; the preview-fields picker in §2 was removed and the Fields control replaced it. §8, the canvas (its header, the stale banner, row identity, absent cells, copy formats, menus, deep documents, error copy), is agreed and not built yet; where it names a part of §2–§5, §8 is what ships.

## Purpose

Render the current result set in one of three views. Tree shows collapsed rows with a preview and expands to a typed field grid. JSON shows syntax-highlighted EJSON. Table shows tabular rows with column overflow. All three share a single data source (the tab's last successful run) and a single selection concept.

## Scope

- **In**: The three view components, the per-doc row expansion state, the column set derivation for Table, the preview-field picker integration, the document-selection concept (for W08 edit/delete), empty and loading states.
- **Out**: Running queries (W03/W05), pagination (W07), writing docs (W08).

## Dependencies

- W03 (EJSON shape), W05 (produces the docs), W07 (page controls), W08 (selection drives edit/delete), W10 (preview fields).

## 1. Data source

Held on the active collection tab as `state.lastRun`, in renderer memory only: main strips it before every `state_json` write (results can be production documents), so a restored tab has no `lastRun` until it runs — default-query tabs auto-run, custom-query tabs show "Run the query to see results":

```ts
interface LastRun {
  documents: unknown[];      // EJSON canonical
  totalCount?: number;
  durationMs: number;
  ranAt: string;             // ISO
  error?: IpcError;
}
```

Documents are always EJSON objects. A helper `toDisplayValue(v): { type, display, raw }` classifies each leaf:

| EJSON shape                      | `type`       | `display` |
| -------------------------------- | ------------ | --------- |
| `{ $oid: "…" }`                  | `objectid`   | `ObjectId("ffff…")` |
| `{ $date: "…" }`                 | `date`       | ISO string |
| `{ $numberLong: "…" }`           | `long`       | the number |
| `{ $numberDecimal: "…" }`        | `decimal`    | the number |
| `{ $regex: …, $options: … }`     | `regex`      | `/r/opts`  |
| `{ $binary: { … } }`             | `binary`     | `Binary(len=…)` |
| plain `string`/`number`/`boolean`| accordingly  |            |
| `null`                           | `null`       | `null`     |
| `Array`                          | `array`      | `[N items]` |
| plain object                     | `object`     | `{N fields}` |

## 2. Tree view (default)

Row layout (matches existing mock):
- Collapsed: `[▸] [📄] [shortId]   [key: value · key: value · …]   [✏ pick preview]`.
- Expanded: a field grid with three columns (field, value, type), nested objects/arrays expand on click.
- A collapsed row is compact (about 33px) and the preview sits beside the id, left-aligned, with the row actions pinned to the right.

### Expansion state
- `expanded: Set<string>` per tab (persisted in tab state).
- Clicking the ▸/▾ toggles.
- Deep field expansion uses a path like `_id.$oid` for persistence is overkill — iteration 1 does NOT persist deep expansion, only top-level row expansion.

### Preview fields
- Driven by the per-collection preview fields (W10). Shown in the collapsed row header, up to 4 fields.
- Each row has a ✏ button that opens `PreviewPicker` (already in mock): a popover listing all known field names from the current result set (union of keys across the first 50 docs). Selecting checkboxes updates preview fields via W10 IPC.

### Short id
- For `_id` of type `ObjectId`, show last 8 hex chars. For non-Object-id `_id`, show up to 12 chars of the EJSON stringification, prefixed with the type badge.

### Selection
- An unselected select toggle is an empty box; the check appears only once the row is selected.
- A plain click on the collapsed row header does not select: it expands or collapses the row (the chevron button does the same). Selecting is Cmd/Ctrl-click on the row, or the per-row select toggle (checkbox) at the row's left; both toggle that row into or out of the multi-selection (blue left border and tinted background on selected rows). There is no single-select-by-click mode.
- Selection is a set of row indices shared by Table, Tree and JSON, so it survives a view switch and is cleared whenever the result set changes (new run, page change, tab switch).
- Selection is consumed by W08 for `Edit document` / `Delete document(s)` actions; Edit and Delete also have their own buttons on each row.

### Full value of a leaf
- The expanded field grid truncates a value to its column. A leaf (non-object, non-array) row carries the same `⤢` affordance as a Table cell (`FullValuePopover`): revealed on hover, on focus and while the row is the field tree's active row, it opens a read-only popover with the untruncated value (strings quoted). The trigger is out of Tab order (`tabIndex={-1}`), so Tab does not walk every leaf; the keyboard path is Enter below.
- Keyboard: Enter or Space on an active leaf opens it (on an expandable row they still toggle), and focus moves into the dropdown (`role="dialog"`, `tabIndex=-1`, named "Full value"), so a screen reader lands on the value. Escape closes it, does not bubble to the outer Table/Tree grid, and focus returns to the field tree, whose arrow keys and `aria-activedescendant` carry on from the same row.
- The popover belongs to the active leaf: making another row active, collapsing the leaf's parent, or a different document closes it, and a closed popover never swallows the next Escape.
- The same field grid is the Table view's expanded-row panel, so both get it.

## 3. JSON view

- Each doc in its own card (matches mock).
- Rendered through `ejsonStringifyReadable` (lossless relaxations only — see `utils/ejson.ts`: plain numbers for `$numberInt`/fractional doubles, ISO text for `$date`; `$numberLong`, `$numberDecimal` and `$oid` stay wrapped); Copy uses the same text. Light syntax highlighting (keys bold; strings green; numbers blue; booleans orange; null grey — colors from tokens).
- Syntax highlighting is computed at render time by a tiny tokenizer in `utils/jsonHighlight.ts` — do NOT bring in `prismjs` or `highlight.js` for iteration 1.
- Active card: the card list is one tab stop (`role="tree"`, cards are `treeitem`s) with `aria-activedescendant` naming the active card, outlined while the list has focus — the same model as Tree and Table rows.
  - A plain click makes the card active; Cmd/Ctrl-click toggles it into the multi-selection; the per-card select toggle is the other way in.
  - Arrows, Home and End move the active card. `E` edits it (on the list, or on one of the card's own buttons). Shift+F10 or the ContextMenu key opens its document menu.
  - Enter and Space only keep the active card: a card has nothing to expand.

## 4. Table view

- Derive columns:
  - Take the union of top-level keys across the first 50 docs.
  - Ensure `_id` is first, then the current preview fields in order, then the remaining keys in the order they first appear across the sampled documents. Date columns default to a width that fits a full ISO timestamp.
- Column widths: default auto with `max-width: 200px` + ellipsis overflow. User can drag column separators to resize (persisted in tab state as `state.columns.{field}.width`).
- Nested objects/arrays show as `{N}` / `[N]` badges that expand into a small popover showing the nested JSON.
- Any cell with a value has a hover/focus-revealed `⤢` that opens the full, untruncated value in a popover (`FullValuePopover`, shared with Tree leaves).
- Double-click copies a cell's value. The cell's native title says so next to the drag hint ("Drag to add … to builder · double-click to copy"); no per-cell tooltip component, which would mount one floating instance per cell of a virtualized grid.
- Right-click on a row → context menu: `Edit`, `Delete`, `Copy`, `Copy as JSON`. On a view, Edit becomes View document and Delete is gone.

## 5. Common

### Loading & empty
- Loading (between Run click and response):
  - first load (no run has landed in the tab yet): eight skeleton rows stand in for the body, inside a `role="status"` region labelled "Loading results";
  - any re-run, including one after an empty or errored result: keep the body as it is, with "Running…" and Cancel in the fixed band above the rows, itself `role="status"`, so nothing moves or is covered. Only one of the two status regions shows at a time.
- With nothing to say (no selection, not running, connection fine), the fixed band holds a one-line hint naming how to select: "Select rows with the checkbox or ⌘/Ctrl-click to copy or delete them" ("… to copy them" on a view). Its height never changes.
- One pane state stands in for rows whenever there are none, each with a next action:
  - not run yet: "Run the query to see results", with Run;
  - empty collection: "This collection is empty", with Import documents (Run again on a view);
  - no match: "No matching documents", with Clear filter, which also runs;
  - query error: pressing Run on a query the server refuses replaces the results with the whole error and offers "Revert to last valid query", which restores the last query that succeeded in this tab and runs it. With no such query it offers Clear filter, or Run again;
  - failed (the network, not the query): the error, with Run again.
- A query that cannot parse never runs: the rows stay, dimmed, the count says "not current", and the reason sits beside Run.

### Keyboard
Each view is one tab stop (`role="tree"` for Tree and JSON, the grid for Table) with `aria-activedescendant` naming the active row, outlined while the view has focus. Keys act on the active row and only when the view itself has focus (a key typed on a button inside the row is that button's).
- `ArrowDown` / `ArrowUp` move the active row; `Home` / `End` jump to the first / last. There is no `j` / `k`.
- `Enter` or `Space`: in Tree, expands or collapses the active row; in Table, selects only the active row (or clears it if it was already the sole selection); in JSON, only keeps the card active (a card has nothing to expand). `Cmd/Ctrl+Enter` is Run, never a row action.
- `E` edits the active document in all three views (unmodified key only).
- `Shift+F10` or the ContextMenu key opens the document menu for the active row in Table and JSON.
- `D` deletes the active document in all three views, through the same confirmation as the row's Delete button (unmodified key only). On a view or a read-only snapshot, which offer no delete, the key does nothing. On a read-only connection it opens the confirmation with Delete disabled and the reason, as the row's button does.

### Performance
- Table, Tree and JSON rows are always virtualized with `react-window` (no row-count threshold).

## 6. Acceptance criteria

- All three views render the same underlying `documents` array without re-running the query.
- Changing preview fields updates Tree and Table header order without a new run.
- Selection state persists while switching view modes.
- Expanding a row in Tree persists across tab switches (top-level only).
- EJSON values (ObjectId, Date, Long, Decimal) render with correct type badges.
- Column resize in Table persists across relaunches.
- Switching view modes is instant (no extra fetch).
- A truncated leaf value in Tree or an expanded Table row can be read in full by mouse (`⤢`) and keyboard (Enter on the active leaf); Escape closes it without bubbling.
- The JSON view has an active card driven by click and arrow keys, and `E` edits it.
- A first load shows skeleton rows; a re-run keeps the previous rows.

## 7. Test cases

### Component
- **tree-collapsed.spec.tsx**: renders short id + preview fields; click ▸ expands.
- **tree-expanded.spec.tsx**: type badges rendered (objectid/date/number/...); nested object expands.
- **preview-picker.spec.tsx**: picker lists all field names; selecting updates preview fields via W10 mock.
- **json-highlight.spec.tsx**: keys are bold; strings are green; numbers are blue; null is grey.
- **table-columns.spec.tsx**: column order: _id first, then preview, then alpha remainder.
- **table-resize.spec.tsx**: drag a column separator → `api.tabs.update` called with new width.
- **selection.spec.tsx**: click selects; cmd-click toggles additional; switching view keeps selection.
- **empty-state.spec.tsx**: zero docs → placeholder with Clear filter link.
- **virtualize.spec.tsx**: with 500 docs, DOM contains ≤ 60 row nodes.

### E2E
- **view-swap.e2e.ts**: run query → Tree, click rows → switch to JSON → same docs → switch to Table → resize a column → reload app → width persisted.

## 8. Amendment — the canvas

> **Accepted, not built.** It supersedes the parts of §2–§5 it names and leaves the rest standing. Opening a document is unchanged: `E`, the row's Edit control and the menus open the Document Editor's modal ([W18](./W18-document-editor.md)); a row click does not open a side panel.

### 8.1 Canvas header

A 28px header replaces the result toolbar.

- **Left**: the view switch, in the order `Table | Tree | JSON`. A new tab still opens on the stored default view; choosing a view makes it the default for tabs opened afterwards (the existing `ui.workspace.defaultView` preference, which Settings also shows). People who prefer Table used to switch on every open.
- **Right**: `References` (icon and count; drawn when the collection has rules, or on hover and focus), a `⋯` menu, then `+ Insert`.
- **`⋯`** (accessible name `More actions`) replaces the `Documents ▾` menu, whose name was also the name of the view. Two labelled groups: **Bulk actions** — `Update matching…`, `Delete matching…`; **Data** — `Export…`, `Import…`. A third item, `Undo last change`, appears while an undo is still valid ([X13 §13](./X13-operation-audit-log.md)).
- **`+ Insert`** is a default (outline) button. Filled, it was the most prominent control in a read-mostly view, twenty pixels under Run.
- The pager is in the status bar ([W07 §7](./W07-pagination.md)); projection is a pill in the Filter Bar row ([W05 §9.2](./W05-query-bar.md)).
- The permanent selection hint row of §5 is removed.

### 8.2 Results that are not current

Supersedes §5's "the rows stay, dimmed, the count says not current".

- A 28px warning strip at the top of the canvas: `These results are from the previous filter.` with a `Run ⌘↵` text button. When the query cannot run as written, the button is absent and the Filter Bar's error strip gives the reason.
- While a query is running over earlier rows, the strip reads `Previous results`.
- The rows stay at **full contrast**. At 45% opacity a stale table read as a disabled or broken one, and in the dark theme dimmed text over a dark surface fell below a readable contrast.
- The status bar's count carries a warning dot.

### 8.3 Selection

- The checkbox column is drawn on row hover and focus, and stays for every row once anything is selected. ⌘/Ctrl-click still toggles a row.
- With one or more rows selected, the selection bar is a floating pill at the bottom centre of the canvas: `{n} selected · Copy ▾ · Delete · ✕`. `Delete` is absent on a view.

### 8.4 Row identity

Supersedes §2's `shortId`.

- A row's visible id is built from the `_id`'s **display value**, the text a table cell shows, never from its EJSON wrapper: an ObjectId as `…` and its last eight hex digits; a number, string or date as its display text, cut to twelve characters with an ellipsis; `(no _id)` when absent. An Int32 `_id: 1` used to read `{"$numberInt` on every row.
- It is plain monospace in the neutral text colour. In the accent colour it read as a link.
- The full id is the id's tooltip, with a copy control on hover.
- The accessible names of the row's actions use the same readable id: `Edit document 1`, not `Edit document {"$numberInt`.

### 8.5 Absent fields

In Table, a field the document does not have is an empty cell with a faint centred `—` and the title `Field not present`. `null` stays `null`, and a BSON `undefined` value still reads `undefined`. Rendering absence as the word `undefined` made a sparse collection a grid of that word and hid the difference between "no such field" and a stored value.

### 8.6 Copy

- **One default for every "copy document" path** — the selection bar, a JSON card, `Copy document` in a menu, ⌘⇧C: **Readable EJSON** (`ejsonStringifyReadable`). It unwraps only what re-parses to the identical BSON, so what is pasted back means what was copied. The three paths used to give Canonical EJSON, a relaxed form and plain text for the same document.
- **Copy as ▾** offers `EJSON (readable)`, `Canonical EJSON` and `mongosh`. The last choice becomes the default (a stored preference) and the menu always names the formats, so the clipboard never holds a form the UI did not name. bson's own relaxed mode is not offered: it rounds a 64-bit integer.
- `Copy value` on a cell keeps copying the display text (an ISO date, the hex of an ObjectId).
- **`⌘C`** copies the active cell's value in Table and the active document in Tree and JSON. **`⌘⇧C`** copies the active document in all three. A text selection, or focus in a text field, keeps the native copy.
- Cell and document menus gain `Copy document` and `Copy _id`. A column header has a menu: `Copy field path`, `Sort ascending`, `Sort descending`, `Hide column`, `Add to filter`.
- Menu copies share **one** toast (`Copied`, 1.5 seconds, replaced rather than stacked). The in-cell flash stays for the double-click copy.

### 8.7 Menus

- The cell, field, document and column-header menus render through the shared `ContextMenu`, as the navigator's do: `role="menu"`, `menuitem`s, arrow keys, Escape. They were groups of plain buttons under three implementations.
- A right-click on a collapsed Tree row and on a column header opens that row's or column's menu.
- A document's menu reads: `Copy document`, `Copy _id`, `Edit document` (`View document` on a view), `Duplicate document`, `Expand all`, `Collapse all`, `Delete`.
- A row's hover controls are Edit and `⋯`. Delete is in the `⋯` menu and on `D`.

### 8.8 Deep documents

- `⌥`-click on a chevron, or `⌥→` on the active row or field, expands the whole subtree; `⌥←` collapses it.
- `Expand all` and `Collapse all` are in the document's menu.
- `→` on an expanded row moves to its first field; `←` on a field moves to its parent. Arrow keys used to expand a document and never enter it.

### 8.9 Full value and Fields popovers

- Opening either by mouse or keyboard moves focus into it, so Escape closes it and returns focus to its trigger, without bubbling. Opened by click, both used to ignore Escape.
- The Full value viewer grows to 60vh and has a header (field path, type, length) with `Copy` and `Open in editor`, which opens the Document Editor on that field.

### 8.10 Wide documents

- The column picker has a filter box; choosing a field scrolls its column into view.
- The `_id` column is sticky at the left.
- Rendering only the visible columns is added if a profile of a wide collection shows it is needed; it is not assumed.

### 8.11 JSON view

- Cards render documents in **shell form** by default: `ObjectId("…")`, `ISODate("…")`, `NumberLong("…")`, plain numbers. A `Canonical EJSON` item in the view's `⋯` switches the display, per tab. This is display only; copying goes through §8.6 and names its format.
- A card's actions show on hover, on focus within the card, and on the active card, not on every card at once.

### 8.12 Tree and Table rows

- Table rows are 30px; nested values are `{n}` / `[n]` chips.
- A collapsed Tree row shows its first fields as aligned `key value` pairs.

### 8.13 Scroll position

Each tab remembers the scroll offset of each view for the session and restores it when the tab is shown again. It is not persisted across a relaunch.

### 8.14 Empty collection

The empty-collection state offers `Insert document` and `Import…`. It offered only Import, the heavier of the two.

### 8.15 Error copy

Supersedes the wording of §5's query-error and failed states; their actions stand.

- The message is shown without the internal code prefix (`VALIDATION:`, `MONGO_ERROR:`, `NETWORK:`). The code and the raw message are under a `Details` disclosure.
- One hint line follows, chosen by what failed: an unknown operator suggests the nearest real one (`Did you mean $gt?`, within an edit distance of two over the operator catalog); a refused connection reads `The server is not reachable.`; a socket timeout reads `Raise Socket timeout in the connection's Advanced tab.`

### 8.16 Acceptance criteria

- The view switch reads Table, Tree, JSON; choosing JSON in one tab makes the next new tab open on JSON.
- The canvas header has no pager, no Fields button and no `Documents` menu; `⋯` holds the Bulk actions and Data groups.
- `Insert` is not a filled button.
- No hint row is drawn with nothing selected.
- Results that are not current show the strip, at full row opacity, with Run in it when the query can run.
- The checkbox column appears on hover and stays while a selection exists; the selection pill floats at the bottom centre.
- A document with `_id: 1` shows `1` as its row id in every view, and its Edit control is named `Edit document 1`.
- A field missing from a document shows `—` in Table; a `null` shows `null`.
- The selection bar, a JSON card and `Copy document` put the same text on the clipboard for the same document, and that text parses back to the same BSON.
- Choosing `Canonical EJSON` in Copy as makes it the default for the next copy and after a relaunch.
- ⌘C on a focused cell copies its value; ⌘⇧C copies the document; with text selected the native copy runs.
- Six menu copies leave one toast on screen.
- The cell, field, document and header menus expose `role="menu"` and move with the arrow keys.
- ⌥-click on a chevron expands every level below it; `→` on an expanded row enters its fields.
- Escape closes a mouse-opened Full value or Fields popover; Full value has Copy and Open in editor.
- The column picker finds a field by typing and scrolls to it; `_id` stays visible while scrolling sideways.
- JSON cards show `ObjectId("…")` by default and Canonical EJSON after the switch.
- Returning to a tab restores its scroll position.
- An empty collection offers Insert document and Import.
- A failed query shows no code prefix, shows a hint, and keeps the code under Details.

### 8.17 Test cases

- **Unit**: the row id for ObjectId, Int32, Int64, Decimal128, Double, Date, string, nested-object and missing `_id`s; the copy formatter in each format; the nearest-operator hint; the error-hint choice by code.
- **Property** (`*.property.spec.ts`, real `bson` constructors): for a generated document, the readable and canonical copy texts each parse back to a document whose Canonical EJSON equals the original's; the mongosh text repairs through the Shell Syntax transform to the same Canonical EJSON, for the types that transform covers; the row id of a scalar `_id` never begins with `{"$`.
- **Component**: the canvas header; the stale strip (with a stateful wrapper) and the unchanged row opacity; hover checkboxes and the floating pill; row ids and action names in Tree, Table and JSON; `—` cells; Copy as and its remembered choice; ⌘C / ⌘⇧C and the native-copy exception; the single toast; the four menus as `ContextMenu`; subtree expansion and entering fields; popover focus and Escape (render under a parent with its own key spy to prove the stop); the column picker's find; shell and canonical JSON display; scroll restore; empty-collection actions; error copy and Details.
- **E2E**: copy a selected document and a JSON card and compare the clipboard; expand a six-level document with one ⌥-click; open a collection with integer ids and read distinct row ids.
