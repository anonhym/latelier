# Atelier UI/UX audit — structural rethink (post v0.20.0)

Source: 20 screenshots in `shots2/` at 1440×900 plus sampled renderer code and specs. Paths are relative to the repo root. Pixel figures are read off the screenshots and are approximate (±4px) unless a file:line is given.

**Evidence caveats (read first).** Five captures do not show what their file name says, so those surfaces are grounded in code only:

- `05-tree.png` is byte-identical to `04-table.png`; both show the **Tree** view. Table is visible in `07`–`10`, but only in the stale (dimmed) state.
- `08-builder.png` shows the builder **collapsed**. The open builder is visible in `04`/`06`/`07`.
- `09-doc-editor.png` shows a focused row with hover actions, **not** the Document Editor modal. Editor claims come from `src/pages/Workspace/DocumentEditor.tsx`.
- `17-shell.png` shows a **Script tab**, not the Mongo shell pane. Shell claims come from `TitleBar.tsx` / `MongoShellPane.tsx`.
- `19-dark-table.png` and `20-dark-agg-fail.png` are **light theme**, showing two Script tabs. There is no dark-theme evidence at all; dark notes come from the tokens in `src/index.css:94-138` and are marked unverified.
- In `07`–`10` the filter text is `{}{ status: "shipped" }` (the capture script typed after the default `{}`), so those shots show the error + stale state, not a successful filtered run.

---

## 1. Top-level diagnosis

1. **Location is repeated instead of stated once.** The connection name appears three times and the collection three times in the top-left 300×230px (title-bar switcher, tab-group chip, tab, navigator root, navigator row, breadcrumb), while the database — the one thing that disambiguates — appears only as small muted breadcrumb text. Five chrome rows carry it.
2. **Chrome is stacked in rows, each added by a feature, none owning the hierarchy.** Six horizontal bands (≈220px, 24% of the window) sit above the first document. Every band has its own buttons; three filled-violet controls (Run, Insert, AND) compete for "primary".
3. **Every feature has two homes.** Saved/History (query bar buttons *and* builder tabs), projection (toolbar "Fields") vs. the rest of the query options (advanced grid), theme (title bar *and* Settings), connection actions (switcher row icons, manager modal, navigator context menu, deep screen), JS execution (Shell pane *and* Script tab), "Save as" (pipeline *and* output). Users must learn the map, not the model.
4. **State and feedback are whispered.** Parse errors are truncated to ~20 characters, stale results are a small orange "not current" plus 45% opacity, Run silently disables, dirty/unsaved is a 6px dot, and a permanent hint row explains selection instead of the UI affording it.
5. **Onboarding shows the empty workbench instead of the first task.** First run renders the full four-band chrome around nothing, with the fastest path (paste a URI) hidden behind a small link inside a five-tab modal that defaults to SRV.

---

## 2. Findings

| id | Surface | Problem (evidence) | User impact | Sev |
|---|---|---|---|---|
| F1 | Shell — location | "Where am I" is shown in 6 places: switcher pill "Local dev" (`04`, 92–210px, y22), tab-group chip "Local dev" (y62), tab "orders", navigator root "Local dev", navigator row "orders", breadcrumb "shop / orders" (y97). DB name appears once, 11px muted. Tab label is the bare collection name (`TabStrip.tsx:283-391`). | Redundant chrome, yet two `orders` tabs from different DBs are indistinguishable without reading the breadcrumb. | high |
| F2 | Shell — vertical budget | Bands above the first row in `04`: title 46 (`TitleBar.tsx:48`) + tab strip 34 (`TabStrip.tsx:195`) + sub-tabs ~34 + query ~35 + toolbar ~42 + selection hint ~30 ≈ 220px; first document at y≈240. With advanced options open (`07`) the first row drops to y≈388. | A quarter to 43% of the window is chrome; fewer rows visible than Compass/Studio 3T at the same size. | high |
| F3 | Shell — title bar | 46px bar holds one pill and four small controls; ~1000px is empty drag area (`04`). No product name or wordmark anywhere in the workspace (`Wordmark` is only used by the splash, `src/App.tsx:94`). ⌘K is a 50px "⌘ K" button. | Wasted prime real estate; the most powerful feature (palette v2) is advertised by a two-glyph button. | med |
| F4 | Shell — no-tab state | `03`: navigator shows "Local dev" connected with `shop`, but the title bar says "Select a connection" (`ConnectionSwitcher.tsx:737`, falls back when there is no Focused Tab). Body copy says "Select a collection from the sidebar" while the button says "Open a collection" (opens a modal, `PanelBody.tsx:413`). | The app contradicts itself about whether you are connected; two different instructions for one step. | high |
| F5 | Shell — tab strip | Only affordance to create a tab is "+ Script" in 11px text (`04`, x203). No "+" for a collection tab or an aggregation. Script tabs are all titled "Script" (`19`: two identical tabs). The group chip "Local dev" is always shown even with one connection. | Tabs can't be told apart; the chip costs 90px for no information in the single-connection case (the common one). | med |
| F6 | Navigator | 205px wide (`04`). Unlabelled counts "1" and "2" beside connection and DB. Collapse control is an 8×36px notch at y≈490. When a Script tab is focused the `orders` row keeps an outlined highlight (`17`), a third selection style beside filled (`04`) and the purple dot. | Counts and dot need guessing; the sidebar toggle is hard to find and hit; selection state is ambiguous. | med |
| F7 | Collection header | Sub-tabs are UPPERCASE letterspaced ("DOCUMENTS / AGGREGATION / STRUCTURE", `04` y96), as are "QUERY/SORT/SKIP…" labels (`07`), while builder tabs, toolbar buttons and the palette use sentence case. "Structure" contains Statistics, Indexes, Validation, Schema (`12`); the palette calls them "Go to schema" / "Go to indexes" (`14`). | Three label styles read as three hierarchies; "Structure" hides the two things users look for by name. | med |
| F8 | Query bar | The word "QUERY" with a 10px chevron is the disclosure for advanced options (tooltip "Hide advanced options", `07`). The filter input itself has no label/placeholder beyond `{}`; nothing says "filter". | Sort/limit/hint — everyday needs — are behind an unlabeled toggle that looks like a caption. | high |
| F9 | Query options | Sort, Skip, Limit, Collation, Hint, MaxTimeMS, Read pref live in the advanced grid (`07`), but **projection** is the "Fields" button in the toolbar below (`04` x569), next to "References (0)". | One query's parameters are split across two bands with different interaction styles. | med |
| F10 | Query error | `07`: error text is clipped to "Line 1, column 3: There is u…" in a ~150px slot between the input and Save; with the builder closed (`08`) it is still clipped ("…unexpected text after the …"). Run goes disabled with no reason in view; the reason is only in a tooltip (`ResultBar.tsx:354`). | The user cannot read why the query won't run without resizing or hovering. | high |
| F11 | Stale results | Stale state = orange "40 · not current" (`07` y294) + body at 45% opacity (`ResultViewer.tsx:107`). No inline action. The dimmed table reads as disabled; in `07`–`10` every cell is grey. | Users misread stale data as current, or as a broken table; the fix (Run) is not offered where the problem is stated. | high |
| F12 | Toolbar hierarchy | `04` y170: pager, page size, range, Fields, References (0), **Insert (filled violet)**, Documents ▾, Tree/JSON/Table — eight controls of equal weight. Insert is styled as primary 20px below Run (also filled violet); the builder's "AND" is a third violet fill. | No single primary action; a write action (Insert) is the most prominent thing in a read-mostly view. | high |
| F13 | Naming | "Documents" is both the sub-tab (`04` y96) and the bulk-actions menu (`04` x889; items: Update all matching…, Export…, Import documents…, Delete all matching…, `ResultBar.tsx:498-528`). | Destructive bulk operations hide behind a noun that already means something else. | med |
| F14 | Selection hint | A permanent 30px row: "Select rows with the checkbox or ⌘/Ctrl-click to copy or delete them" (`04` y208). | A full band spent on instructions; signals the selection model isn't self-evident. | med |
| F15 | Builder pane | Open by default at ~320px (`04`, x1120–1440), i.e. 22% of width, showing an empty state. Its tabs "Saved"/"Recent" duplicate the query bar's "Save"/"History" buttons (`04` y131). Toggle is an 8px edge notch (`08` x1435). Footer has three more buttons (Reset, Copy code, Open as pipeline). | Results lose a fifth of the width to an empty panel; two entry points per feature; panel hard to reopen once closed. | high |
| F16 | Tree view | `04`: each row is a checkbox, chevron, 8-char truncated `_id` in accent colour (looks like a link), then an inline `key: value` run. Row height ~33px. | The truncated id is ambiguous (click? copy?); inline previews are hard to scan column-wise, so users switch to Table every time. | med |
| F17 | JSON view | `06`: canonical EJSON (`{"$oid": …}`, `{"$numberDecimal": "19.99"}`, `{"$date": …}`) — a 15-field doc takes 480px; five always-visible icon buttons per card. | Verbose, low density; types are noise for reading. (Wire format is canonical by design; display need not be.) | med |
| F18 | Row actions | Hover actions (edit, delete, ⋮) sit at the far right edge (`09` x1362–1415), 900px from the cell under the cursor; inline-edit pencils appear inside cells (`09` x910). Context menu (`10`): Copy value, Copy field path, Add to filter, Edit, Duplicate document, Delete — no "Copy document" / "View". | Three edit entry points (cell pencil, row pencil, context Edit) with unclear difference; common copy actions missing from the menu shown. | med |
| F19 | Document editor | A centered, resizable modal (`DocumentEditor.tsx:1011-1027`, `size="auto"`, 80vh cap) with Fields/JSON switch. It covers the result list; saving is a diff (ADR 0012) but the diff is never shown. Not captured in any screenshot. | Editing loses the surrounding rows (no compare, no next/previous); users can't see what will be written. | med |
| F20 | Aggregation | `11`: second toolbar with its own Save / Save as / Run / Explain / Copy; left "Pipeline" outline (200px) repeats the canvas (orders → Output shown twice); output panel has another "Save as…" and "Save as view…". Run and "Run pipeline" are disabled at zero stages with no reason shown. Empty canvas offers only a dashed "+ Add stage". | Two "Save as" with different meanings; 200px outline is pure duplication for short pipelines; blank start gives no guidance. | high |
| F21 | Structure | `12`: four stacked sections each with its own Refresh (four buttons); Statistics is a loose row of six label/value pairs; Schema starts at y≈470 and continues below the fold; Frequency is a bare "100%" text column. | Long scroll, repeated controls, the richest data (schema) is least visible and not visual. | med |
| F22 | Command palette | `14`, empty query: first group QUERY, first (highlighted) row is a disabled "Explain query — Can't parse this filter…". Every row's leading icon is a ">" chevron, which reads as "expandable". Go-to-collection is not offered until typing (spec X07 §13.2 "Empty query"). | Opening ⌘K lands on a dead row; the palette looks like a tree; the most common intent (jump to a collection) needs ⌘P knowledge. | med |
| F23 | Connection switcher | `16`: a 300px popover row carries name, host, version, a check, and four unlabeled 14px icons (settings, disconnect, edit, red delete) side by side. "Manage connections" opens a separate modal (`18`) with the same list as a table. | Delete sits one mis-click from edit in a quick-switch control; two overlapping lists to learn. | high |
| F24 | Connection manager | `18`: modal with disabled bulk "Export / Delete" above the table and "+ New / Paste URIs / Import" below it; shows "Connected" with "Last used: Never". Server admin (Overview, Monitor, Collections, Users, Roles — `DetailPanel.tsx:25`) is a separate full-page route `/connections/:id` reachable only via the switcher's icon / palette. | Create actions are below the fold of attention; monitoring and user management are effectively undiscoverable. | med |
| F25 | New connection | `02`: five tabs (General, Auth, TLS, SSH, Advanced). "Paste URI ›" is a 12px link at the right of the Host section. Type defaults to SRV with placeholder `cluster.mongodb.net` (`ConnectionForm.tsx:74`). Footer: Cancel, Test connection, Save — no "Save & connect" (none in `ConnectionForm.tsx`). | The fastest path (paste a URI) is hidden; local users must first change the type; after Save a second step is needed to connect. | high |
| F26 | First run | `01`: full chrome around nothing — a live "Filter…" box and refresh over an empty navigator, an enabled "+ Script" tab, a disabled Shell button, "Select a connection". Copy: "No connections yet. Add one to get started." No brand, no explanation of what the app is. `02a`: empty switcher lists "Manage connections" above "No connections yet". | First impression is an empty tool with dead controls; nothing sells or orients. | high |
| F27 | Scripts vs Shell | Two JS surfaces: "Shell" button in the title bar toggling a pane (`TitleBar.tsx:97`) and "+ Script" tabs (`17`). Script tab: header "Script  db: (use default)  timeout: 60 s", output collapsed to a 30px strip "No output yet." | Users can't tell which to use; the Script output area is invisible until a run. | med |
| F28 | Settings / theme | `15`: 680×460 modal; the Appearance page has one control (Theme) which is also the moon button in the title bar (`TitleBar.tsx:121`). | A permanent title-bar slot for a set-once preference; sparse modal. | low |
| F29 | Keyboard | Only six static shortcuts exist outside the palette (`staticShortcuts.ts:10-33`): ⌘K, ⌘P, ⌘1–9, ⌘⌥←/→, ⌘E. No visible shortcut for focus-filter, toggle sidebar/builder, switch Documents/Aggregation/Structure, or switch result view; shortcuts aren't shown on the buttons (Run's is tooltip-only). | Keyboard-first users must route everything through ⌘K. | med |
| F30 | Dark theme (unverified) | No dark capture. From tokens: tab-group tint is `color-mix(groupColor 14%/32%, bg)` (`TabStrip.tsx:260`) over `#0b0e10`; borders are 8%/14% alpha (`index.css:99-100`); stale dim is the same 0.45 opacity. | Likely weak panel separation and faint connection colour in dark; needs real screenshots before design sign-off. | low |

---

## 3. Proposal — "One Spine"

**Principle.** One place per job, read top-to-bottom along a single spine:

1. **Location bar** — where am I (once).
2. **Ask bar** — what am I asking (filter + its options, one row, one primary).
3. **Canvas** — the answer (results), with its own light header.
4. **Inspector** — one right-hand panel that hosts whatever is being worked on in detail (filter builder, a document, a query plan). Closed by default.
5. **Status bar** — connection health, run stats, paging.

Everything else is a menu item or a palette action. Exactly one filled-violet control per view (Run). Sentence case everywhere; uppercase only for 11px group captions.

### 3.1 App shell (fixes F1–F7, F28, F29)

Regions at 1440×900:

| Region | Size | Content |
|---|---|---|
| Title / location bar | 1440×40 | `[70 traffic-light inset]` `[sidebar toggle 28]` `[breadcrumb]` `[flex drag]` `[search field 320]` `[Shell]` `[Settings]` |
| Tab strip | 1440×32 | tabs + `[+ ▾]` |
| Navigator | 240×(900−40−32−24) | search, tree, footer |
| Main | 1200×804 | view header 36, ask bar 44, canvas |
| Status bar | 1440×24 | connection · run stats · paging |

- **Breadcrumb (new, replaces switcher pill + sub-tab breadcrumb).** `● Local dev  ›  shop  ›  orders`. Three segment buttons, 13px, name weight 600 on the last. The dot is the connection colour and status. Each segment is a dropdown: connection → the quick switcher (3.9); `shop` → sibling databases; `orders` → sibling collections with a filter box. With no tab focused but a connection open it reads `● Local dev  ›  Choose a collection…` — never "Select a connection" while connected (F4). With zero connections the breadcrumb is absent.
- **Search field (replaces the "⌘ K" button).** A 320×26 input-looking button, centred-right: magnifier, placeholder "Search collections and actions", right-aligned key cap `⌘K`. Click or ⌘K opens the palette anchored to it.
- **Removed from title bar:** theme toggle (stays in Settings and as the palette's "Dark mode" toggle).
- **Tab strip.** Each tab: 3px left stripe in the connection colour, kind icon (collection / Σ aggregation / script), label, dirty dot, close. Label is `orders`; when two open tabs share a collection name it becomes `shop.orders`. Script tabs are named `Script 1`, `Script 2` (or the saved name). The connection **group chip appears only when tabs from ≥2 connections are open**; with one connection the stripe alone carries it. `[+ ▾]` button at the end (28×24): "Open collection… ⌘P", "New script", "New aggregation on <focused collection>".
- **Navigator (240px).** Header: search "Filter collections" + single refresh. Tree rows 28px: connection root shows `● name`, read-only lock, and on hover `[Server]` (opens Monitor/Users/Roles, see 3.9) and `⋯`. Counts become tooltipped muted suffixes ("2 collections"). One selection style: filled accent-soft = focused tab's collection; a small open-tab dot = open but not focused; nothing else. Footer row (32px): "+ Add connection". Sidebar toggle moves to the title bar with ⌘B.
- **View header (36px, replaces the uppercase sub-tab row).** Left: segmented control `Documents | Aggregation | Schema & indexes` (sentence case, 13px, shortcuts ⌥1/⌥2/⌥3 shown in tooltips). Right, muted 12px: `40 documents · 1 index · 10.8 KB`. No breadcrumb here.
- **Status bar (24px, new).** Left: `● Local dev · 127.0.0.1 · v8.0.5` (+ "Read-only" badge). Middle: last run `40 documents · 12 ms · COLLSCAN` (the plan badge moves here; click opens the plan in the Inspector). Right: pager `1–40 of 40  ‹ ›  50 / page`.
- **Net vertical budget above the first row:** 40 + 32 + 36 + 44 + 28 (canvas header) = 180px vs. ~220px today, and no hint row; with query options open +36px instead of +148px.

### 3.2 First run and new connection (fixes F25, F26, F4)

**First run (zero connections) — a dedicated welcome canvas.** No tab strip, no navigator, no status bar; only the 40px title bar (search + settings).

- Centred column, 560px wide, starting at y≈200:
  - Wordmark (existing asset `src/assets/atelier-wordmark-*.svg`), 32px high.
  - Headline, 20px: "Connect to MongoDB".
  - **URI field**, 560×40, monospace, placeholder `mongodb://localhost:27017  or  mongodb+srv://…`, with a filled violet **Connect** button (96px) attached on the right. Enter connects; the connection is saved under the host name and can be renamed later.
  - Under it, a row of three quiet links, 13px: "Enter details manually" · "Import from Compass or a file" · "Paste several URIs".
  - A single muted line, 12px: "Passwords are encrypted with your system keychain and never leave this machine." (matches F03/X21 behaviour).
- On failure, the existing troubleshooting drawer (C11) opens from an inline error under the field.

**New connection form (modal kept, 720×560).**

- **Connection string field moves to the top**, full width, always visible, above the tabs, labelled "Connection string" with helper "Paste a URI to fill the form". Editing it fills the tabs; editing the tabs rewrites it (the form already has Paste URI parsing — C01).
- Type is **inferred from the URI**; empty form defaults to Standard / `localhost` / `27017`.
- Tabs reduce to `General | Authentication | TLS / SSH | Advanced`; a dot on any tab that holds non-default values.
- Footer: `Cancel` (left) … `Test` (default) · `Save` (default) · **`Save & connect`** (filled, ⌘↵). Test result renders inline in the footer ("Connected in 84 ms · v8.0.5").

**Connected, no tab (replaces `03`).** Canvas shows a 560px column: "Local dev is connected" + a collection list (top 8 by name, with doc counts if known) as clickable rows, and "Search collections ⌘P". No modal step.

### 3.3 Documents view — ask bar (fixes F8–F11, F15, F29)

One row, 44px, full main width:

`[Filter ▾]  [ editor: { status: "shipped" }  ……… ]  [Sort] [Project] [Limit] [⋯ More]   [Builder]  [History ▾] [☆]   [▶ Run ⌘↵ |▾]`

- **`Filter` label** (accent-ink, 12px) names the input. `⌘L` focuses it. Placeholder: `{ field: value } — press ⌘↵ to run`.
- **Option pills** replace the "QUERY" disclosure and the uppercase grid. Each pill is a 24px button; unset = ghost label ("Sort"), set = filled-soft with the value ("Sort: _id ↓", "Project: 3 fields", "Limit: 100"). Clicking a pill opens a small popover with the existing editor for that option. `⋯ More` holds Skip, Collation, Hint, Max time, Read preference; any set one is promoted to a visible pill. **Projection ("Fields") moves here** from the toolbar (F9).
- **`Builder` toggle** (default button, pressed state when open, ⌘⇧B) opens the Inspector on its Filter tab — replaces the 8px edge notch.
- **History ▾** and **☆ Save** stay in the bar and are the *only* entry points; the builder's "Saved" and "Recent" tabs are removed (their lists become the History/Saved popovers, 360px wide, searchable).
- **Run** is the single filled-violet control. Its split menu keeps Explain (labelled "Explain plan", "Explain with execution stats", "Explain all plans" instead of raw verbosity names — `QueryBar.tsx:814-835`).
- **Error strip (new).** When the filter doesn't parse, a full-width 28px strip appears directly under the ask bar, red-soft background: `⚠ Line 1, column 3 — unexpected text after the filter` (never truncated; wraps to two lines), with the offending range underlined in the editor. Run shows "Fix filter to run" as its disabled label.

### 3.4 Documents view — canvas (fixes F11–F14, F16–F18)

- **Canvas header (28px).** Left: view switch `Table | Tree | JSON` (Table first; default stays a setting). Right: `References` (icon + count, only when >0 or on hover), `⋯` menu = **"Bulk actions"** group (Update matching…, Delete matching…) and **"Data"** group (Export…, Import…) — replaces the "Documents ▾" menu (F13); then `+ Insert` as a **default (outline)** button.
- **Pager** moves to the status bar. **Selection hint row removed.**
- **Stale banner (new).** When the filter changed since the last run: a 28px warn-soft strip at the top of the canvas — "These results are from the previous filter." + `Run ⌘↵` text button. Rows stay at full contrast (drop the 0.45 opacity); the count in the status bar gets a warn dot.
- **Selection.** Checkbox column appears on row hover and stays once anything is selected. With ≥1 selected, the existing `SelectionActionBar` renders as a floating pill, bottom-centre of the canvas, 40px high: `3 selected · Copy · Export · Delete · ✕`.
- **Table.** 30px rows; header row sticky with sort-on-click and column menu; type-coloured values (existing `--atelier-color-*` tokens); `_id` shown shortened with full value on hover and a copy affordance; nested values as `{3}` / `[2]` chips that expand in place.
- **Tree.** Keep, but render the row summary as aligned `key value` pairs for the first N fields and show the `_id` in plain monospace (not link colour).
- **JSON.** Default to relaxed/shell rendering for display (`ObjectId("…")`, `ISODate("…")`, `19.99`), with a "Canonical EJSON" toggle in the view's `⋯` (copy still offers both). Card actions appear on hover/focus only.
- **Row actions.** One model: click a row → opens it in the Inspector (3.5); double-click a cell → inline edit (existing, `TableView.tsx:370`); hover shows a single `⋯` at the row's right edge. Context menu gains "Copy document" and "Open document"; "Edit" becomes "Open document".

### 3.5 Inspector and document editing (fixes F15, F19, F18)

A single right-hand panel, **closed by default**, resizable 320–640px (default 400), with a 36px header: title, tab switch, close (Esc). It hosts one of:

- **Filter builder** — today's builder content minus the Saved/Recent tabs. Footer keeps `Reset`, `Copy code ▾`, `Open as pipeline`.
- **Document** — replaces the centered modal for edit *and* insert:
  - Header: `orders · _id 6af6…583c` + copy, `Fields | JSON` switch, `‹ ›` previous/next document in the result set.
  - Body: the existing field rows / JSON editor.
  - **Changes strip (new)** above the footer when dirty: "2 changes" expandable to a diff list (`status: "pending" → "shipped"`), which is exactly what is sent (ADR 0012).
  - Footer: `Discard` · **`Save 2 changes ⌘↵`** (default-variant until dirty, then filled). Conflict and deleted banners stay as today (`DocumentEditor.tsx:1100-1120`).
  - An "Expand" button promotes the panel to the current large modal for big documents.
- **Query plan** — the Explain drawer content, opened from the status-bar plan badge or Run ▾.

The result list stays visible and selectable while the Inspector is open.

### 3.6 Aggregation (fixes F20, F12)

Regions inside the 1200×768 main area (below the 36px view header):

| Region | Size | Content |
|---|---|---|
| Pipeline bar | 1200×44 | `[name ● unsaved]` `[Save ▾]` … `[Explain]` `[Copy ▾]` `[▶ Run ⌘↵]` |
| Stages column | 480×724 | source chip, stage cards, add-stage |
| Preview column | 720×724 | output of the selected stage / final output |

- **The 200px outline is removed**; the stages column *is* the outline. Each stage is a card: header 32px (`drag handle · 1 · $match ▾ · enable switch · ⋯`), body = editor, footer = "→ 12 documents" preview count when available. Collapsed cards are 32px, so a long pipeline still reads as an outline.
- **Preview column** shows the output for the *selected* stage (existing "Run up to this stage", `StageAccordion.tsx:917`) with the same `Table | Tree | JSON` header as Documents. Selecting "Output" shows the final result. The vertical split with a bottom output panel is replaced by this side-by-side layout (toggle to stacked for narrow windows).
- **Pipeline bar.** `Save ▾` = Save, Save as…. The output's actions become one **`Export results ▾`** in the preview header: Copy, Download, Save to collection…, Create view… — no second "Save as" (F20).
- **Empty state.** In the stages column under the source chip: "Add a first stage" with chips `$match  $group  $sort  $project  $lookup  $unwind` and "All stages…". If Run is unavailable, its tooltip *and* a muted line in the preview say why ("Add a stage to run").

### 3.7 Schema & indexes (was "Structure") (fixes F7, F21)

- Renamed tab: **Schema & indexes**. One `Refresh` in the top-right of the view; sections refresh together.
- **Stat strip** (64px): five tiles, 13px label over 18px value — Documents 40 · Data size 10.8 KB · Storage 4.0 KB · Avg doc 276 B · Indexes 1 (4.0 KB). "Capped: No" moves to a tooltip unless true.
- **Section pills** under the strip: `Indexes 1 · Schema 12 fields · Validation` — anchors with scroll-spy; ⌘K "Go to schema/indexes" land on them.
- **Indexes** table as today, `+ New index` as a default button (the only filled button on the page is none; this is a read view).
- **Schema** table: Field (indented by nesting instead of dotted repeats), Types (chips), **Frequency as a 80px bar + %**, Distinct, Range. Row click → "Filter by this field" / "Create index on this field".
- **Validation** collapsed to one line when there are no rules: "No validation rules · Add rules".

### 3.8 Command palette (fixes F22, F3, F29)

- Entry point is the title-bar search field (3.1); the palette opens anchored under it (640px wide), not as a floating centre modal.
- **Empty query order:** Recent (5) → **Collections in this connection** (5 + "Show more") → actions for the focused tab → the rest. This changes the "objects are not listed until the user types" rule in X07 §13.2.
- **Disabled rows sort last within their group** and are never the initial cursor row.
- **Row icons are kind icons** (collection, Σ, script, connection, command glyph) — no chevron as a leading icon; `›` is used only on the right for rows that open a second step.
- Shortcuts shown on every command that has one; add to the cheat sheet: ⌘L focus filter, ⌘B sidebar, ⌘⇧B builder, ⌥1/2/3 view, ⌘T open collection.

### 3.9 Connection management (fixes F23, F24, F27)

- **Quick switcher (breadcrumb's connection segment).** 360px popover: search, then rows of `● name — host · version` with status text on the right ("Connected", "Dormant", "Connect ↵"). **No inline icon cluster.** Hover/focus shows one `⋯` with: Open server overview, Edit…, Disconnect, Copy connection string, Delete… (delete last, after a divider, type-to-confirm as per ADR 0013). Footer: "+ New connection" · "Manage all ⌘E".
- **Manager (modal, 880×600).** Header row: search + **`+ New` (default) · `Import ▾` (file, Compass, paste URIs)** on the right — create actions at the top. Table: Name, Host, Status, Last used, `⋯`. Bulk bar (Export, Delete) appears only when rows are selected.
- **Server admin made discoverable.** The connection root in the navigator gets a `Server` row/icon and the breadcrumb's connection menu gets "Server overview"; both open the existing Overview/Monitor/Collections/Users/Roles screen. Proposed as a **tab kind** ("Local dev · Server") rather than a separate full-page route so it lives in the same shell — larger change, see roadmap.
- **Shell vs Script.** Rename the title-bar button to **"Console"** with tooltip "Interactive shell for the focused connection (⌃`)"; it docks at the bottom of the main area. Script tabs get a visible split: editor top, **Output panel bottom at 30% height from the start** (empty text: "Output appears here · ⌘↵ to run"), header fields labelled "Database" and "Timeout".

### 3.10 Dark theme (addresses F30 — unverified, needs captures)

- Mock both themes for every artboard; do not derive dark by inversion.
- Use three clearly stepped surfaces from the existing tokens: canvas `--atelier-bg #0b0e10`, panels (navigator, inspector, bars) `--atelier-surface #161a1e`, raised (popovers, cards, selected row) `--atelier-surface-raised #1f252c`; separate panels by surface step first, border second.
- Connection colour: stripe at full saturation; any tint ≥24% in dark (today 14%/32% for both themes).
- Stale state: banner, not opacity (3.4), so dimming never stacks on already-low-contrast dark text.
- Check white-on-`#7c6af7` for 12px button labels with `src/theme/contrast.ts` before sign-off.

### 3.11 Proposal → findings map

| Proposal item | Fixes |
|---|---|
| Breadcrumb location bar, tab labels, conditional group chip | F1, F4, F5 |
| 40/32/36/44/28 band budget, status bar, hint row removal | F2, F14 |
| Title-bar search field, theme toggle removed | F3, F28 |
| Navigator: one selection style, labelled counts, ⌘B toggle, footer add | F6 |
| Sentence-case view switch, "Schema & indexes" | F7 |
| Ask bar with Filter label + option pills (incl. Project) | F8, F9 |
| Error strip, disabled-Run label | F10 |
| Stale banner at full contrast | F11 |
| One filled primary; Insert as outline; ⋯ Bulk/Data menu | F12, F13 |
| Inspector (builder closed by default, single Saved/History home) | F15 |
| Table-first, plain `_id`, relaxed JSON display, hover-only card actions | F16, F17 |
| Row click → Inspector; one `⋯`; richer context menu | F18, F19 |
| Aggregation: stages column + preview column, Export results ▾, empty-state chips | F20 |
| Stat tiles, section pills, single Refresh, frequency bars | F21 |
| Palette: anchored, collections on empty query, kind icons, disabled last | F22 |
| Switcher without icon cluster; manager with top actions; Server entry | F23, F24 |
| Welcome canvas with URI field; form with top URI, Save & connect | F25, F26 |
| Console rename; Script output panel visible | F27 |
| New shortcuts surfaced on controls | F29 |
| Dark: stepped surfaces, stronger tint, banner not opacity | F30 |

---

## 4. Roadmap

**Wave 1 — quick wins (no layout change, mostly copy/variants)**

| Item | Effort |
|---|---|
| Error strip under the query bar, untruncated (F10) | S |
| Stale banner with Run action; drop 0.45 opacity (F11) | S |
| Insert → default variant; rename "Documents ▾" → `⋯` with Bulk/Data groups (F12, F13) | S |
| Remove permanent selection hint row; show checkbox on hover (F14) | S |
| Fix "Select a connection" while connected; align empty-state copy (F4) | S |
| Sentence-case sub-tabs and option labels; "Structure" → "Schema & indexes" (F7) | S |
| Script tabs numbered; `shop.orders` on label collision (F5) | S |
| Builder closed by default for new tabs; labelled "Builder" toggle in the query bar (F15) | S |
| Palette: disabled rows last, never initial cursor; kind icons (F22) | S |
| Form: default Standard/localhost; "Save & connect" (F25) | S–M |
| Theme toggle out of the title bar (F28) | S |

**Wave 2 — structural**

| Item | Effort |
|---|---|
| Location breadcrumb + title-bar search field; remove sub-tab breadcrumb (F1, F3) | M |
| Ask bar with option pills; Project moved in; single Saved/History home (F8, F9, F15) | L |
| Canvas header + status bar (pager, run stats, plan badge) (F2) | M |
| Welcome canvas with URI connect (F26) | M |
| Switcher simplification + manager header actions (F23, F24) | M |
| Schema & indexes layout: tiles, pills, single refresh, frequency bars (F21) | M |
| Conditional group chip + tab stripes + `+ ▾` menu (F5) | M |
| Shortcut set (⌘L, ⌘B, ⌘⇧B, ⌥1–3, ⌘T) and on-control hints (F29) | S–M |

**Wave 3 — ambitious**

| Item | Effort |
|---|---|
| Inspector panel hosting Builder and Plan; document editing stays in the modal, which gains Tab order, the `$set` change list, the per-field conflict table and ‹ › with an unsaved-edits guard (F19, F18) | L |
| Aggregation side-by-side stages + per-stage preview; outline removed (F20) | L |
| Server admin as a tab kind inside the shell (F24) | L |
| Relaxed-display JSON view with canonical toggle (F17) | M |
| Dark theme pass on real captures (F30) | M |

---

## 5. Risks, trade-offs, open questions

- **Decisions taken 2026-11-13** (Claude Design review):
  - Palette: list collections on an empty query and anchor the palette under the title-bar search field (amends X07 §13.2).
  - Group chip and switcher: chip only with 2+ connections; the breadcrumb's first segment opens the switcher (amends X16 / ADR 0006 and ADR 0001).
  - Query options: option pills, with a per-tab "Keep options expanded" that restores the grid.
  - Status bar: added.
  - Inspector vs modal: keep the modal (W18 / ADR 0012 unchanged). Tab order, the `$set` change list, the per-field conflict table and ‹ › with an unsaved-edits guard go inside the modal; the Inspector hosts only Builder and Plan.
- **Decisions this proposal reopens.** (a) W18 / ADR 0012 chose "one modal" for the Document Editor; decided 2026-11-13 to keep it, so this is no longer reopened — the editor improvements land inside the modal. (b) ADR 0006 / X16 §4.4 specify the named connection chip in the tab strip; hiding it for a single connection is an amendment, and collapsing a group needs another home (tab context menu) in that case. (c) X07 §13.2 says objects are not listed on an empty query, and §13.3's artboards were agreed in Claude Design; listing collections on empty query and anchoring the palette to the title bar both amend that. (d) ADR 0001 names the title-bar switcher trigger; the breadcrumb's first segment is the same trigger with a different look.
- **Status bar adds a band.** Net chrome still drops (~40px at the top), but it is a new always-on row; if rejected, the pager returns to the canvas header and run stats to its left side.
- **Option pills vs. the grid.** Pills are more scannable but each option becomes a popover; power users who set sort+limit+hint on every query may prefer the always-open grid. Mitigation: `⋯ More → Keep options expanded` (per-tab, as today's disclosure state).
- **Removing Saved/Recent tabs from the builder** loses the side-by-side "browse saved while editing" flow; the popovers must support keyboard preview to compensate.
- **Relaxed JSON display** must never be what is copied/edited by default without saying so — the wire format stays canonical (CLAUDE.md "EJSON on the wire"). Needs a clear label on copy.
- **URI-first welcome** auto-names the connection from the host; duplicates and credentials-in-URI handling need a rule (the URI field must be treated as a secret input).
- **Unverified / unsure:**
  - No dark-theme captures, no Document Editor capture, no Shell pane capture, no fresh (non-stale) Table capture, no open-builder-with-conditions capture, no populated aggregation capture. Proposals for those surfaces rest on code reading; please re-shoot before finalising artboards.
  - Why Run is disabled at zero aggregation stages (`11`) — I saw `disabled={… !validation.ok}` (`AggregationTab.tsx:701`) but did not trace what makes an empty pipeline invalid; it may be intended.
  - "Last used: Never" beside "Connected" in `18` may be a seeding artefact like the float totals.
  - The four unlabeled switcher icons in `16` — I inferred settings/disconnect/edit/delete from shape and colour, not from tooltips.
  - Whether the palette's leading ">" in `14` is the intended "command" kind icon or a placeholder.
  - Band heights other than title bar (46) and tab strip (34) are measured from pixels, not code.
