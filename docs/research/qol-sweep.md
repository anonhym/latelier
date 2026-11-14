# Atelier v0.20.0 — QoL and behaviour sweep

Date: 2026-11-13. Method: the built app (`dist/`, `dist-electron/` at HEAD `94f0ce85`) driven by Playwright against `mongodb-memory-server` 8.0.5, window 1440×900, one scenario per `test()`.

- Design boards: the "Quality of life" page of https://claude.ai/artifact/P4BFeRX6N2PWDnwB1XUgSD (companion to `ux-audit-one-spine.md`).
- Measurements, screenshots and the throwaway spec were kept outside the repo; file names cited below (`qol-results.jsonl`, `shots3/`, `zz-qol.e2e.ts.txt`) refer to that scratch set.
- Measurements: `qol-results.jsonl`. Each line is one scenario run; **the last line per `scenario` is authoritative** (earlier lines are runs with broken selectors). Citations below are `scenario › key`.
- The throwaway spec is archived as `zz-qol.e2e.ts.txt` in this folder (deleted from the repo).
- Screenshots: `shots3/`.
- Not repeated here: layout/hierarchy findings F1–F30 of `docs/research/ux-audit-one-spine.md`. Where a behaviour finding touches one, it is named under "Overlap".

## What already works (measured, so it is not re-proposed)

- The whole task (connect → open collection → filter → run → open document → edit → save) is possible **keyboard-only in 72 keystrokes with no forced mouse** (`s1_keyboard › f_editSave.totalKeys`). `E` on a row opens the editor with focus in the first field; `⌘↵` saves; focus returns to the result tree.
- Dirty editor + Escape asks "Discard changes?" (`s3_safety › editor_dirty_escape`). Save and single delete show a toast with **Undo**. Bulk delete, drop collection and drop database require typing the name, with focus already in that input.
- Tab switch keeps filter, sort, projection, view and column width. Relaunch keeps tabs, focused tab, filter, sort, view, column width (160→252 px survived), expanded navigator nodes, and an unsaved script typed immediately before quit (`s4_memory › e0…e3`).
- Server stop: the next Run fails within 1 s with the filter preserved, a "Run again" button that reconnects by itself, and a "Reconnect" toast (`s6_errors › server_down, reconnect`).
- 508 icon-only buttons on a populated Documents view, 1 without an accessible name (`s7_details › icon_buttons_audit`).
- Tabs reorder by drag; `⌘W` closes the tab; empty collection, no-match filter and no-match navigator filter each offer a next action.

## Findings

Priority: P1 = wrong or lossy behaviour in an everyday path; P2 = daily friction; P3 = polish. Effort: S ≤ 1 day, M = a few days, L = a week or more.

### Q1 — Integer `_id`s show as `{"$numberInt` in the Tree view and in every row-action label
- **Category:** scale & display. **Observed** (`s2_copy › tree_idClick.idText`, `tree_rowButtons`; visible in `shots3/shell-pane.png` and `editor-modal.png`).
- **What happens:** with `_id: 1` (Int32), each Tree row's id reads `{"$numberInt`, identical for all 40 rows. The same string is in the accessible names: "Edit document {"$numberInt", "Delete document {"$numberInt", "Select document {"$numberInt". Table view shows `1` correctly. Cause: `getDocId` slices the canonical-EJSON wrapper to 12 characters (`src/pages/Workspace/views/docId.ts:27`). Applies to Int32, Int64, Decimal128 and Date ids alike.
- **Why it hurts:** rows are indistinguishable by id; a screen-reader user hears the same label on every button; it looks like a rendering bug on first open of any collection with numeric keys.
- **Fix:** run the id through the same `toDisplayValue` used by table cells before truncating; truncate from the display string, not from JSON.
- **Effort:** S. **Priority:** P1. **Overlap:** F16 covers the truncated ObjectId look only. **Evidence:** `shots3/shell-pane.png`.

### Q2 — The command palette lists no collections while no tab is open
- **Category:** keyboard flow. **Observed** (`s1_keyboard › a4_palette_orders_before_expand`, `a6_palette_orders_after_expand`).
- **What happens:** `⌘K` → type connection name → Enter connects in 5 keystrokes. Then `⌘K orders` and `⌘P orders` both answer `No matches for "orders"` (Collections 0). After expanding `shop` in the navigator the same query returns `shop.orders` twice. Getting there by keyboard took 8 Tabs + 6 arrows + Enter (`a5_openViaTree`), 20 keystrokes in total instead of ~13.
- **Why it hurts:** "⌘P Find a collection" is the advertised fast path and it fails exactly when a session starts.
- **Cause (checked in code):** the palette already sweeps collections in the background, but only for the *focused* connection, which `src/pages/Workspace.tsx` derives from the active tab (`focusedConnection = active ? … : null`). Right after a palette connect there is no tab, so nothing is swept until the navigator lists a database by hand.
- **Fix:** with no active tab, sweep the most recently connected connection (or every open one); show "Loading collections…" instead of "No matches" while the sweep runs.
- **Effort:** S. **Priority:** P1. **Overlap:** F22 (palette empty state) is a different problem.

### Q3 — Three copy paths, three formats
- **Category:** copy & reuse. **Observed** (`s2_copy › selection_copy.clip`, `json_view.clip`, `table_ctx_date`).
- **What happens:** for the same document —
  - selection bar **Copy** → canonical EJSON: `"_id": {"$numberInt": "5"}`, `"createdAt": {"$date": {"$numberLong": "1767693900000"}}` (407 chars);
  - JSON view **Copy JSON** → relaxed EJSON: `"_id": 1`, `"createdAt": {"$date": "2026-01-02T10:01:00.000Z"}`;
  - context menu **Copy value** on a date → `2026-01-02T10:01:00.000Z`.
- **Why it hurts:** the most reachable path (select rows → Copy) gives the least readable output; a date as epoch milliseconds in a string cannot be pasted into a ticket, a shell or a test fixture.
- **Fix:** one default (relaxed EJSON, which round-trips everything except number width) for every "copy document" path, plus a split-button "Copy as ▾ — Relaxed JSON / Canonical EJSON / mongosh" that remembers the last choice.
- **Effort:** S. **Priority:** P1. **Overlap:** F17 (JSON view shows canonical) is display, not clipboard.

### Q4 — Missing fields render the literal word `undefined` in Table view
- **Category:** scale & display. **Observed** (`s5_scale › odd_table.allRow3`; `shots3/qol-Q4.png`).
- **What happens:** in a collection with four differently shaped documents, every cell for a field the document does not have shows `undefined` (`displayValue.ts:70`), in the same monospace as real values, slightly muted.
- **Why it hurts:** BSON has a deprecated `undefined` type; "field absent" and "field holds undefined/null" look the same. In sparse collections most of the grid is the word "undefined".
- **Fix:** render absent as an empty cell with a faint centred "—" and a hover title "field not present"; keep `null` as `null`.
- **Effort:** S. **Priority:** P2. **Overlap:** none. **Evidence:** `shots3/qol-Q4.png`.

### Q5 — Closing a Script tab discards its content with no prompt and no way back
- **Category:** undo & safety. **Observed** (`s3_safety › script_dirty_close`; `s7_details › tab_reorder_drag.afterReopen, cmdShiftTOpened`).
- **What happens:** a Script tab holding typed code closes on × or `⌘W` immediately — no dialog, no toast. `⌘⇧T` does not reopen it (it opens the "Open collection" dialog). Middle-click on a tab does nothing. The tab menu has Pin / Close / Close others / Close to the right / Reveal in sidebar — no "Reopen closed tab". By contrast, quitting the app keeps the script.
- **Why it hurts:** scripts are the only free-form authored content in the app and there is no script library, so a mis-click on × is permanent loss.
- **Fix:** keep the last ~10 closed tabs (state_json is already serialised) and add "Reopen closed tab" on `⌘⇧T` and in the tab menu; show a 8 s "Script tab closed — Undo" toast for tabs with non-empty content.
- **Effort:** M. **Priority:** P1. **Overlap:** tracked #46 (script library) would make this less severe but does not cover undo-close.

### Q6 — Bulk-delete confirmation is the same for 3 picked rows and for the whole collection
- **Category:** undo & safety. **Observed** (`s3_safety › delete_selected_3`, `delete_all_empty_filter`, `delete_one`).
- **What happens:** 3 ⌘-clicked rows → "Delete 3 matching documents? … Type orders to confirm". Empty filter `{}` → "Delete 39 matching documents? … Type orders to confirm". Same title pattern, same ceremony. The selection case says "matching" although nothing was matched; the empty-filter case never says "this is every document in the collection". Neither names the database or connection. A single delete says only "Delete document? This can be undone."
- **Why it hurts:** the guard costs the same for the trivial case and the catastrophic one, so it stops carrying information; with two connections open the dialog does not say which server is about to lose data.
- **Fix:** three tiers. Selected ≤ 20 and undoable: plain confirm "Delete 3 selected documents from shop.orders?" with Delete focused off. Filtered: current type-to-confirm, with the filter shown. Empty filter: red banner "No filter — this deletes all 39 documents in shop.orders on Local dev", type-to-confirm.
- **Effort:** S. **Priority:** P2. **Overlap:** F13 (naming of the Documents menu) only.

### Q7 — A running query shows no progress, no elapsed time, and leaves the old results looking current
- **Category:** waiting & scale. **Observed** (`s5_scale › slow_query.samples`, `slow_query_uncancelled`).
- **What happens:** with a 3.5 s query, at 0.3 s, 1.2 s and 2.2 s the only change on screen is Run → a 65 px red "Cancel" button. No spinner or progress bar (`bars: 0`), no `aria-busy`, the result bar still reads "1–50 of 10,000" from the previous query, and the previous rows stay at opacity 1. There is a "Running…" status for screen readers only. Cancel at 2.3 s returns to the old rows with no "cancelled" notice. After completion the bar reads "1–50 of 10,000 · no index" — no duration; duration is only rendered in the widest count form (`ResultBar.tsx:292-298`).
- **Why it hurts:** for anything slower than a blink the user cannot tell whether Run registered, how long it has been, or whether the rows on screen answer the new filter.
- **Fix:** while running, put a thin indeterminate bar under the query bar, dim the stale rows (the existing stale treatment), and show "Running · 2.3 s" next to Cancel. After completion always show "· 3.5 s"; after cancel show "Cancelled after 2.3 s — showing previous results".
- **Effort:** S. **Priority:** P2. **Overlap:** F11 (stale state styling); tracked #674 covers the time *limit*, not feedback.

### Q8 — Shell syntax is called "invalid" while typing, then silently rewritten to verbose EJSON
- **Category:** error recovery. **Observed** (`s6_errors › shell_syntax_accepted`).
- **What happens:** typing `{status: 'shipped'}`, `{_id: ObjectId("…")}`, `{createdAt: {$gt: ISODate("2026-02-01")}}` or `{status: /ship/i}` disables Run and shows "Invalid text. Showing last valid filter. Filter text isn't valid JSON…". Pressing `⌘↵` (or clicking the disabled-looking Run) nevertheless runs it — and replaces the text with `{"status": {"$regularExpression":{"pattern":"ship","options":"i"}}}`, `{"_id": {"$oid":"…"}}`, etc.
- **Why it hurts:** the app supports mongosh syntax but tells the user it does not; then it replaces what they typed with a form nobody writes by hand, which they must read back to edit.
- **Fix:** validate with the shell-syntax parser while typing (it already exists, `src/utils/shellSyntax.ts`), keep Run enabled, and keep the user's text as typed — send the repaired EJSON on the wire only. If the rewrite must stay, change the banner to "mongosh syntax — will be normalised on Run".
- **Effort:** M. **Priority:** P2. **Overlap:** F10 (error clipping) is the layout side.

### Q9 — `⌘C` does nothing on a focused row or cell; there is no "Copy document" or "Copy _id"
- **Category:** copy & reuse. **Observed** (`s2_copy › table_cmdC`, `table_ctx_cell.items`, `tree_ctx_row`, `table_header_ctx`).
- **What happens:** click a cell, press `⌘C` → clipboard unchanged. Double-click copies the cell (only announced by a `title` that reads "Drag to add … · double-click to copy"). The cell menu is Copy value / Copy field path / Add to filter / Edit / Duplicate document / Delete; the row "⋮" menu is Edit / Duplicate / Delete. Right-click on a collapsed Tree row or a table column header opens nothing.
- **Why it hurts:** the universal copy gesture is dead on the app's main surface; copying an `_id` to look it up elsewhere takes a right-click on exactly the `_id` cell.
- **Fix:** `⌘C` copies the active cell (Table) or the active document (Tree/JSON), `⌘⇧C` copies the document; add "Copy document" and "Copy _id" to both menus; give column headers a menu (Copy field path, Sort, Hide, Add to filter…).
- **Effort:** S. **Priority:** P2. **Overlap:** F18 notes the missing "Copy document" item.

### Q10 — Copy confirmations pile up
- **Category:** small details. **Observed** (`s2_copy › table_ctx_date."toast:Copy value"`).
- **What happens:** each menu copy raises its own toast ("Value copied to the clipboard.", "Field name copied…", "Namespace copied…"); six were on screen at once after six copies. Double-click copy instead flashes "✓ Copied" inside the cell.
- **Why it hurts:** a stack of toasts covers the bottom-right of the result area for something that needs a 1-second acknowledgement; two feedback styles for one action.
- **Fix:** one reusable "copied" toast id (replace, do not stack) with a 1.5 s lifetime, or use the in-cell flash everywhere.
- **Effort:** S. **Priority:** P3. **Overlap:** none.

### Q11 — Focus falls to `<body>` after connecting from the palette and after relaunch
- **Category:** keyboard flow. **Observed** (`s1_keyboard › a3_enterConn.active`; `s4_memory › e_afterRelaunch.active`).
- **What happens:** after `⌘K` → Enter on a connection, `document.activeElement` is BODY; the navigator is 8 Tabs away. After relaunch with a restored tab it is BODY again.
- **Why it hurts:** the keyboard user's next keystroke goes nowhere.
- **Fix:** after a palette connect, focus the navigator tree (first database active). After restore, focus the query filter of the focused tab.
- **Effort:** S. **Priority:** P2. **Overlap:** F29 (shortcuts in general).

### Q12 — Filter and results are far apart by keyboard, and no key jumps to either
- **Category:** keyboard flow. **Observed** (`s1_keyboard › b0_focusProbes`, `b1_tabOrderFromBody`, `d_tabToResults`).
- **What happens:** `⌘L`, `⌘F` and `/` do nothing. From the filter to the first result row is 13 Tabs (Expand, Save, History, Run, Run options, Rows per page, Query plan, Fields, References, Insert, Documents, view switch, tree). After `⌘↵` focus stays in the filter (good), but the way down is those 13 stops.
- **Why it hurts:** the core loop "edit filter → look at rows → edit filter" needs 13 keystrokes each way.
- **Fix:** `⌘L` or `/` focuses the filter; `↓` from the filter (when the suggestion popup is closed) or `⌘↓` moves to the first row; `Esc` from the results returns to the filter.
- **Effort:** S. **Priority:** P2. **Overlap:** F29 lists the missing shortcuts; the measurements are new.

### Q13 — Scroll position is lost on every tab switch
- **Category:** memory. **Observed** (`s4_memory › a4_scroll.scrollTop` = 744, `b_tabSwitch.back.scrollTop` = 0).
- **What happens:** scroll the table to 744 px, visit another tab, come back: 0.
- **Why it hurts:** comparing two collections means re-finding your place each time.
- **Fix:** store `scrollTop` (or the first visible row index) per tab in memory and restore it on activation; no need to persist across relaunch.
- **Effort:** S. **Priority:** P2. **Overlap:** none.

### Q14 — Nothing is remembered per collection once its tab is closed
- **Category:** memory. **Observed** (`s4_memory › c_closeReopenCollection.reopened`).
- **What happens:** set JSON view and a filter on `customers`, close the tab, open `customers` again: Tree view, `{}`. New tabs always start in Tree, even after the user switched to Table in the previous one.
- **Why it hurts:** people who prefer Table switch on every single open.
- **Fix:** make the last-chosen result view the default for new tabs (one pref); optionally remember view + column widths per namespace. Leave the filter out — Recent already covers it.
- **Effort:** S (view default) / M (per-namespace). **Priority:** P3. **Overlap:** none.

### Q15 — Restored tabs come back empty and each needs a manual Run
- **Category:** memory. **Observed** (`s4_memory › e2_afterRelaunch_text`, `e3_runAfterRelaunch`).
- **What happens:** after relaunch the tab shows its filter and sort and the text "Run the query to see results"; one click per tab brings the data back.
- **Why it hurts:** minor, but the first thing after every launch is a Run on each tab.
- **Fix:** auto-run the focused tab on restore when the connection is up (the same auto-run a fresh open performs); leave background tabs lazy.
- **Effort:** S. **Priority:** P3. **Overlap:** none.

### Q16 — Every navigator click leaves a permanent tab
- **Category:** small details. **Observed** (`s7_details › nav_dblclick_and_single`).
- **What happens:** clicking orders, customers, empty_coll produces three tabs; single and double click behave the same; `⌘`-click opens a duplicate of an already-open collection.
- **Why it hurts:** browsing a database to find the right collection fills the strip.
- **Fix:** preview tab (italic title, replaced by the next single click; double-click or any edit pins it), as in VS Code.
- **Effort:** M. **Priority:** P3. **Overlap:** F5 (tab strip affordances).

### Q17 — Deep documents: one click per level, no expand-all, arrow keys never enter the fields
- **Category:** scale & display. **Observed** (`s5_scale › odd_tree_expand_deep`; `shots3/qol-Q17.png`).
- **What happens:** reaching a value 6 levels down took 7 clicks on individual chevrons. There is no "Expand all / Collapse all" control. With the row focused, 16 presses of `→` expanded the document but never moved into its fields.
- **Why it hurts:** nested documents are the normal case in MongoDB.
- **Fix:** `⌥`-click (and `⌥→`) on a chevron expands the whole subtree; add "Expand all / Collapse all" to the row menu; let `→` on an expanded row move to its first field.
- **Effort:** M. **Priority:** P2. **Overlap:** none. **Evidence:** `shots3/qol-Q17.png`.

### Q18 — "Full value" and "Fields" popovers ignore Escape after a mouse open; Full value has no Copy
- **Category:** small details. **Observed** (`s5_scale › odd_long_fullValueDialog, odd_long_fullValueEscCloses`; `s7_details › escape_stack.cmdSlash`).
- **What happens:** opening the 5,000-character value with the ⤢ button shows a 240 px-high popover with no buttons; Escape left it open. The Fields popover, opened by click, also stayed open through Escape and was still open underneath the Keyboard shortcuts dialog. Settings closes on Escape and returns focus correctly.
- **Why it hurts:** Escape is the reflex for "get this out of my way"; a long value that cannot be copied from its own viewer sends the user back to the context menu.
- **Fix:** move focus into the popover on open (or listen for Escape on the trigger); add Copy and "Open in editor" to Full value and let it grow to ~60 vh.
- **Effort:** S. **Priority:** P2. **Overlap:** none.

### Q19 — Wide documents render every column
- **Category:** scale & display. **Observed** (`s5_scale › odd_table.headers` = 86, `gridScrollW` = 13,938 px; `odd_wide_hscroll.colTools`).
- **What happens:** an 80-field document produces 86 mounted header cells and a 13.9 k px scroll width; the only column tool is the Fields popover.
- **Why it hurts:** finding one field means horizontal scrolling; with 50 rows × 86 columns of hover buttons the DOM gets heavy.
- **Fix:** type-to-find in Fields that scrolls the column into view; pin `_id` (sticky first column); virtualise columns past ~30.
- **Effort:** M. **Priority:** P3. **Overlap:** none.

### Q20 — Error text leaks internal codes and does not suggest the fix
- **Category:** error recovery. **Observed** (`s6_errors › unknown_operator.afterRun`, `server_error_bad_regex`, `server_down.state`).
- **What happens:** "This query failed — VALIDATION: unknown operator: $greaterThan", "MONGO_ERROR: Regular expression is invalid…", "The query could not finish — NETWORK: connect ECONNREFUSED 127.0.0.1:54981". With a 3 s socket timeout and a slower query: "NETWORK: connection 5 to 127.0.0.1:… timed out" (first `s5_scale` line).
- **Why it hurts:** the prefix is the app's `IpcError.code`, not user language; none of the messages says what to do.
- **Fix:** drop the code prefix from the body (keep it in a "Details" disclosure); add one hint line per code — unknown operator → "Did you mean $gt?" (edit distance over the operator catalog), ECONNREFUSED → "The server is not reachable", socket timeout → "Raise Socket timeout in the connection's Advanced tab".
- **Effort:** S. **Priority:** P2. **Overlap:** tracked #675 (operator ranking) shares the catalog only.

### Q21 — Authentication failure offers only "Retry"
- **Category:** error recovery. **Observed** (`s6_errors › wrong_credentials`; `shots3/qol-Q21.png`).
- **What happens:** the navigator shows "QoL BadAuth failed — Could not connect — Authentication failed. Retry".
- **Why it hurts:** retrying wrong credentials fails again; the fix is in the connection form, which is two menus away.
- **Fix:** for auth errors make the primary action "Edit credentials…" (opens the form on the Auth tab) with Retry secondary.
- **Effort:** S. **Priority:** P2. **Overlap:** none. **Evidence:** `shots3/qol-Q21.png`.

### Q22 — A dead server still reads "Connected" until the next action
- **Category:** error recovery. **Observed** (`s6_errors › server_down.idleAfterStop.statusDots`).
- **What happens:** 2.5 s after the server stopped, the title bar and navigator both still say "Connected"; the state changes only when a query fails.
- **Why it hurts:** the green dot is trusted; the user finds out by losing a Run.
- **Fix:** surface the driver's heartbeat failure (`serverHeartbeatFailed` / topology change) through the existing `mongo.onStatus` channel so the dot turns amber within a heartbeat.
- **Effort:** M. **Priority:** P3. **Overlap:** none.

### Q23 — Shell pane small behaviours
- **Category:** small details. **Observed** (`cap_shell`).
- **What happens:** after clicking Shell and the prompt appearing, focus is still on the Shell button, not the input (`focusOnOpen`; the code tries at `MongoShellPane.tsx:175`). Escape in the input does nothing; `Ctrl+L` does not clear (output length unchanged); there is no Clear button (Restart / Stop / Close only); each echoed command shows a doubled prompt `shop> > …`. Up-arrow history works; a bare `db.orders.countDocuments({})` without `await` works.
- **Fix:** focus the input once the session is ready; `Ctrl+L`/`⌘K`-in-pane clears; echo as `shop> cmd`; Escape returns focus to where it was.
- **Effort:** S. **Priority:** P3. **Overlap:** F27 (Shell vs Script) is about the two surfaces.

### Q24 — A script's `deleteMany({})` runs unguarded while the UI path needs a typed confirmation
- **Category:** undo & safety. **Observed** (`s3_safety › script_run_deleteMany_empty`: `deletedCount: 2`, 3 ms, `customersLeftAfterRun: 0`).
- **What happens:** by design scripts run what they say. But the same operation from the Documents menu needs the collection name typed.
- **Why it hurts:** the two paths disagree about how dangerous the operation is; nothing marks a connection as "careful here".
- **Fix:** a per-connection "Confirm destructive scripts" flag (default on for connections the user marks production): before running, a static scan for `deleteMany({})`, `drop(`, `dropDatabase(` raises one confirm naming the connection.
- **Effort:** M. **Priority:** P3. **Overlap:** none.

### Q25 — Undo exists only as an 8-second toast button
- **Category:** undo & safety. **Observed** (`s3_safety › save_then_undo.cmdZRevertedDoc` = false, `delete_one`) + code (`src/theme/notifications.tsx:62`, 8000 ms).
- **What happens:** "Document updated · Undo" and "Document deleted · Undo" appear; `⌘Z` outside a text field does nothing; once the toast leaves, undo is in the audit log.
- **Fix:** `⌘Z` in the result area triggers the newest still-valid undo; keep an "Undo last change" item in the Documents menu.
- **Effort:** S. **Priority:** P3. **Overlap:** none.

### Q26 — Result-view menus are not menus to assistive tech, and there are three implementations
- **Category:** small details. **Code-only** (`TableView.tsx:1887-1890` `role="group" aria-label="Cell actions"`; `TreeView.tsx:781-783` "Field actions"; `RowActionsMenu.tsx:101-103` "Document actions"; items are plain `<button>`s in `FieldActionsMenu.tsx:37-90`; the navigator uses Mantine `Menu` via `components/ContextMenu.tsx:73`).
- **What happens:** navigator menus expose `role="menu"`/`menuitem` with arrow-key navigation from Mantine; the cell, field and document menus are groups of buttons. Observed side effect: probing for `[role="menuitem"]` found the navigator menu but none of the result menus.
- **Fix:** render all four through `ContextMenu` (it already takes `{label, icon, disabled, destructive}` items).
- **Effort:** M. **Priority:** P3. **Overlap:** none.

### Q27 — Icon buttons with a name but no tooltip; disabled pager gives no reason
- **Category:** small details. **Observed** (`s7_details › icon_buttons_audit.res`, `disabled_controls`).
- **What happens:** tab close ×, First/Previous/Next/Last page, Collapse navigator and Expand document have `aria-label` but showed no tooltip on a 650 ms hover; the title-bar and navigator buttons do. (The hover probe lags by one button on dense rows, so per-cell results are not relied on.)
- **Fix:** wrap these in the same `Tooltip` used elsewhere, with the shortcut where one exists ("Close tab ⌘W").
- **Effort:** S. **Priority:** P3. **Overlap:** F29 (shortcuts not shown on buttons).

### Q28 — Escape does not clear the navigator filter
- **Category:** small details. **Observed** (`s7_details › nav_filter_no_match.escapeClears` = false).
- **Fix:** first Escape clears the text, second blurs. **Effort:** S. **Priority:** P3. **Overlap:** none.

### Q29 — "Copy code" lives only in the builder drawer and emits EJSON literals
- **Category:** copy & reuse. **Observed** (`s2_copy › query_copy`).
- **What happens:** the only way to copy the query is the drawer footer's Copy code ▾ (mongosh / Node.js / Python) — invisible when the drawer is collapsed; the Run options menu has Run + three explain modes only. Output: `db.getCollection("orders").find({"status":"shipped","qty":{"$gt":3}}).limit(50)`; the Python snippet starts with an unused `from bson import json_util`.
- **Fix:** add "Copy as…" to the Run options menu and the palette; emit idiomatic literals per language (unquoted keys and `ObjectId()`/`ISODate()` for mongosh); drop the unused import.
- **Effort:** S. **Priority:** P3. **Overlap:** F15 (drawer footer buttons).

### Q30 — Document editor: three tab stops per field, save shortcut not shown
- **Category:** keyboard flow. **Observed** (`s1_keyboard › f_editSave.seq`).
- **What happens:** tab order is value → type select → Remove for every field (3 Tabs to move from `sku` to `status`; 24 to pass 8 fields). `⌘↵` saves but the Save button does not say so.
- **Fix:** Tab moves value → value; reach type and Remove with `→` inside the row (roving tabindex) or `⌥T`/`⌥⌫`; label the button "Save ⌘↵".
- **Effort:** M. **Priority:** P3. **Overlap:** F19 (editor is a modal).

### Q31 — Empty collection offers "Import documents…" but not "Insert document"
- **Category:** small details. **Observed** (`s7_details › empty_collection.pane`).
- **Fix:** two actions: "Insert document" (primary) and "Import…". **Effort:** S. **Priority:** P3. **Overlap:** none.

### Q32 — The editor's type select clips "Decimal128" to "Decimal12"
- **Category:** small details. **Observed** (visible in `shots3/editor-modal.png`, `price` row).
- **Fix:** widen the type column to fit the longest BSON type name (~128 px) or show a tooltip with the full name.
- **Effort:** S. **Priority:** P3. **Overlap:** none.

## Ranked top 10

| # | Id | One line | Kind | P | Effort |
|---|---|---|---|---|---|
| 1 | Q1 | Numeric `_id`s read `{"$numberInt` in Tree rows and all row-action labels | Observed | P1 | S |
| 2 | Q2 | Palette lists no collections while no tab is open | Observed | P1 | S |
| 3 | Q5 | Closing a Script tab loses its code; no prompt, no reopen | Observed | P1 | M |
| 4 | Q3 | Copy gives canonical EJSON, relaxed EJSON or plain text depending on the button | Observed | P1 | S |
| 5 | Q7 | Running query: no progress, no elapsed time, old rows look current | Observed | P2 | S |
| 6 | Q8 | Valid mongosh syntax is flagged invalid, then rewritten to verbose EJSON | Observed | P2 | M |
| 7 | Q6 | Same delete dialog for 3 selected rows and for the whole collection | Observed | P2 | S |
| 8 | Q9 | `⌘C` is dead on rows and cells; no Copy document / Copy _id | Observed | P2 | S |
| 9 | Q12 + Q11 | 13 Tabs between filter and rows; focus lands on `<body>` after connect and relaunch | Observed | P2 | S |
| 10 | Q17 | Deep documents need one click per level; no expand-all | Observed | P2 | M |

Next in line: Q4 (`undefined` cells), Q20/Q21 (error copy and auth recovery), Q13 (scroll position), Q18 (Escape on popovers).

## Candidates for before/after design boards

1. **Run feedback strip (Q7, with F11).** After: pressing Run turns the button into "Cancel" with a live "2.3 s" counter beside it; a 2 px indeterminate bar runs under the query bar; the previous rows dim to the stale treatment with a chip "Previous results". On completion the result bar reads "1–50 of 10,000 · 3.5 s · no index". On cancel a one-line inline notice "Cancelled after 2.3 s — showing previous results" replaces the chip for a few seconds.
2. **Risk-sized delete confirmation (Q6).** After: three visibly different dialogs. Selection: compact, "Delete 3 selected documents from shop.orders?", lists the three `_id`s, plain Cancel / Delete, "Undo available" note. Filtered: medium, shows the filter in a code chip and the count, type-to-confirm. No filter: red header band "No filter — all 39 documents", a connection-coloured chip "Local dev · shop.orders", type-to-confirm, Delete in solid red.
3. **Table cells and row identity (Q1, Q4, Q9).** After: Tree rows lead with the readable id (`1`, `"long"`, `…a3f9c2`) in neutral text with a copy-on-hover icon; absent fields are a faint "—" instead of `undefined`; the focused cell has a visible ring and a hint bar "⌘C copy value · ⌘⇧C copy document"; the cell menu gains Copy document and Copy _id at the top, and column headers get their own menu.
4. **Copy-as and deep-document controls (Q3, Q17, Q18).** After: the selection bar's Copy is a split button — main action "Copy" (relaxed JSON), caret menu "Canonical EJSON / mongosh / CSV", last choice remembered. An expanded document shows a small toolbar on its first line: "Expand all · Collapse all · Copy". The Full value popover becomes a 60 vh panel with a header (field path, type, length) and Copy / Open in editor buttons.

## Required captures

All 1440×900 logical (2880×1800 pixels), in `shots3/`.

| File | Assertion | Result |
|---|---|---|
| `dark-documents.png` | as specified: `getComputedStyle(document.body).backgroundColor === rgb(11, 14, 16)` | **Failed as written** — body is `rgb(22, 26, 30)` (`#161a1e`, the surface token). Replaced by: `data-mantine-color-scheme="dark"` on `<html>`, `--atelier-bg` = `#0b0e10`, and at least one element painted `rgb(11, 14, 16)` (the `mantine-AppShell-root`, 1440×900). All three passed (`cap_dark › dark`). Theme set through `prefs.setTheme('dark')`, the pref behind the title-bar "Switch to dark theme" button. Viewed: correct. |
| `dark-aggregation.png` | Aggregation sub-tab `aria-selected="true"` and scheme `dark` | Passed. Viewed: correct. |
| `editor-modal.png` | "Edit document" dialog visible, `status` input has value `delivered` | Passed; the row shows the "edited" marker. Viewed: correct. |
| `shell-pane.png` | shell input visible, output contains `shop> ` and `"ok": 1` | Passed. Viewed: the mongosh pane with two commands and their output. |

Evidence shots: `qol-Q4.png` (viewed), `qol-Q17.png`, `qol-Q21.png` (not opened; their content is asserted through the DOM measurements cited). `shell-pane.png` and `editor-modal.png` double as evidence for Q1.

## Not tested, and why

- **First-run empty state** — the probe ran during the splash and captured no text; F26 already covers the screen.
- **Quit with a query or script still running** — the quit-guard dialog was not exercised; only "quit with an unsaved script" (content survives, no prompt needed).
- **Closing a tab with the document editor open and dirty**, and tab switch under an open editor — covered by existing specs (`edit-insert-drawer-tab-pin`, `delete-confirm-tab-switch`), not re-driven.
- **Update all matching** beyond opening the dialog (Filter `{}` / Update / Review); the review step and its wording were not driven.
- **Slow aggregation** — only slow `find` was run; the Aggregation tab was inspected for controls only (Run / Explain / Copy disabled at zero stages with no reason, already F20).
- **Count on a very expensive predicate** and the 30 s query limit — not reached; tracked #674 owns the limit.
- **Per-cell tooltips** — the hover probe lags by one element on dense rows, so only coarse results are reported (Q27).
- **Binary values beyond display** (`Binary(aGVsbG8g…)` in Tree and Table, `$binary` in JSON): viewing/downloading the bytes was not attempted.
- **Window size/position across relaunch** — test instances never show their window, so bounds are not meaningful.
- **Real focus behaviour of a visible window** — the test window is hidden; `document.activeElement` is reliable, OS-level focus effects (Q23's initial shell focus in particular) should be re-checked by hand.
- The clipboard used is the real system clipboard; it now holds the last test value.
