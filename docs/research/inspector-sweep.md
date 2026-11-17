# Inspector sweep — Filter builder and Plan (post v0.21.0)

A UI and UX pass over the right-hand Inspector (W05 §9.7): the Filter tab (the Query Builder, W04/W13) and the Plan tab (A06). Nothing here is implemented. Findings come from driving the built app at 1440×900 against a seeded `shop.orders` (40 documents), light and dark, with the panel at 320, 400 and 640px.

Evidence labels: **measured** means read from the DOM or the filter text by script; **seen** means read from a screenshot.

Not covered: the `executionStats` plan view, dragging a field from the results into the tree, the regex / array / objectid value editors, keyboard tab order, and screen readers.

## 1. Diagnosis

The One Spine pass fixed where the builder lives: closed by default, opened by a labelled button, no duplicate Saved/Recent tabs. It did not touch what is inside. The content is still the pre-redesign drawer, and three things now stand out against the polished shell around it:

1. **A condition costs too much height.** Each one is two rows of inputs plus a preview line, 105–150px. Five conditions fill a 900px window.
2. **Structure is expressed in glyphs.** Nested groups carry `+ ( ) </> ¬ ×` with no labels, a negated group gets two stacked headers, and drop zones are permanent furniture.
3. **A few behaviours are wrong, not just rough** (section 2).

## 2. Defects

These need no design decision.

| ID | Finding | Evidence |
|---|---|---|
| D1 | A `number` condition with nothing typed filters on `0`. `qty` + `$eq` + empty value compiled to `{"qty":{"$eq":0}}`, the status line read `≈6 match · 1 condition`, and the row was not counted as "not filled in". An empty `string` row is excluded and counted. | measured |
| D2 | Escape in a condition's field input closes the whole Inspector. The rows survive a reopen, but focus and place are lost. | measured |
| D3 | The operator suggestion list overflows the window: its right edge is at 1481px in a 1440px window at the default panel width, so entries read `= equals QUER`. | measured |
| D4 | An untouched `date` or `$in` row turns red at once ("Date must be a date…", "$in needs at least one value") and the status line turns red with `2 not applied: qty, createdAt`. An untouched `string` row gets the neutral `1 not filled in`. Same situation, two treatments. Decided in review: the error stays, a condition that cannot be applied is never passed over quietly. What is left of this finding is the inconsistency, so the empty `string` row and the empty `number` row (D1) get the same error. | seen |
| D5 | The value type follows the sampled type only when the field input is left with Tab. Leave it with Escape and the row stays `STRING` under a hint that says "qty is number in 100% of documents that have it", with nothing to click. | measured |
| D6 | The `?` operator-help button is present on some rows and absent on others (missing on the `$in` row and the empty `date` row), which changes the field input's width from row to row. | seen |
| D7 | The status line shows `Counting...` with three periods; the rest of the app uses `…`. | seen |

## 3. Filter tab — design findings

| ID | Finding | Direction |
|---|---|---|
| F1 | Row height. Line 1: include box, field, operator, `?`, `⋮`, `×`. Line 2: type, value. Line 3: a preview that for strings repeats the value in quotes (`paid` → `"paid"`), and a blank band of the same height when there is none. | Revised in review: a single line jams as soon as a value is long. Line 1 is field and operator; the value gets the full width under it, with the type as a chip inside the value box, and grows downward with its content (long text wraps to four lines then scrolls, list values wrap as chips, objects get a small editor). Only kinds with no free text (boolean, null, `$exists`) stay on one line. The layout follows the kind, never the length, so a row does not change shape while typing. From 560px the value sits beside the operator. About 72px per condition against today's 105–150. Show the preview only when it says something the input does not (a parsed date). |
| F2 | The type select and the field input do not share a left edge (the type starts under the include box). The control reads `STRING` in capitals; its list reads `string`. | Falls out of F1. Sentence case in both. |
| F3 | Root toolbar shows `AND / OR / NOR` on an empty tree and with one condition, where it changes nothing. `NOR` has the same weight as the two everyday choices, and the filled violet `AND` is a second primary next to Run. | Show the logic control from two children up. Consider `Match all / any / none` as one compact select; keep the operator names in its tooltip. |
| F4 | Nested groups: five unlabelled glyph buttons. A negated group renders a `NOT` box with its own `+ ( ) </>` around the group's own header with the same buttons, so one group has two places to add a child. Two "Drop a field here" zones stack at its foot. | One header per group: logic select, a `NOT` toggle chip, one `+ Add ▾` menu (condition, group, raw clause), `⋮`, `×`. |
| F5 | "Drop a field here" is permanent, one per group, 40px each. | Render drop zones only while a field is being dragged. |
| F6 | Empty state sits at the vertical centre of the panel, 400px below the toolbar that acts on it, while the toolbar shows logic and undo/redo for a tree with nothing in it. | Anchor the empty state at the top; hide logic and undo/redo until there is something to act on. |
| F7 | "Try to parse" (raw clause) and "Edit as JSON" (`$in`) are bare text with no button shape. | Use the subtle button variant the rest of the panel uses. |
| F8 | Footer: `Reset`, `Copy code ▾`, `Open as pipeline`. All three act on the whole query. Reset clears sort, limit and projection from a tab named Filter; Copy code repeats the Run menu's "Copy query as…". At 320px the row wraps to two lines. | Rename to `Reset query`, or move all three into a `⋯` menu in the toolbar and give the 50px back to conditions. |
| F9 | The live match count (`≈10 match`) is the builder's best feedback and is 12px muted text. The panel has no Run of its own; the stale strip's `Run ⌘↵` is across the window in the results. | Promote the count. When the tree differs from the last run, show `Run ⌘↵` beside it. |
| F10 | When the bar's text does not parse, the tree is disabled under "Invalid text. Showing last valid filter." with no way forward from the panel. | Add `Restore this filter`, which writes the tree's filter back to the bar. |
| F11 | Removing a condition is one click on `×`, next to `⋮`. Undo covers it, but nothing says so. | Keep one-click; show a brief "Removed · Undo" in the status line. |

## 4. Plan tab — design findings

| ID | Finding | Direction |
|---|---|---|
| P1 | The winning stage is named twice: a summary card (`COLLSCAN`, warning chip, "Create an index for this query") and directly below it the stage tree's own `COLLSCAN` bar. | Merge: the stage tree is the summary; the warning and the index action attach to the offending stage. |
| P2 | Under the stage tree the default view lists the raw explain keys (`explainVersion`, `queryShapeHash`, `serverInfo`, `serverParameters`, `ok`) with type badges, although a `Raw` toggle exists for exactly that. | Keep them behind `Raw`. |
| P3 | The default verbosity, `queryPlanner`, has no numbers. The useful facts (documents examined against returned, time) need `executionStats`, which the user has to know to pick. | A `Run with stats` button in the summary; when stats exist, lead with examined / returned / time. |
| P4 | Verbosity options are the API names (`queryPlanner`, `executionStats`, `allPlansExecution`). | Plain labels, API name in the option's description. |
| P5 | The controls float at the top right over an empty left half; the footer's `Copy` / `Download` are right-aligned where the Filter tab's footer is left-aligned. | One alignment for both tabs. |

## 5. Panel frame

| ID | Finding | Direction |
|---|---|---|
| S1 | The title "Inspector" sits on the tab row in the tab's size and reads as a third, disabled tab. The tab rail stops short of the close button. | Drop the title; the two tabs name the panel. |
| S2 | Width is kept as a share of the window, not in pixels: set to 640px at 1440, it is 554px at 1280 and 458px at 1100, leaving the results about 400px. At 1024 the panel hides and the `Builder` button reads unpressed; widening the window brings it back. Nothing tells the user why it went. This is the open narrow-width issue (#322). | Hold a pixel width, clamp so the results keep a minimum, and when the panel is hidden for lack of room keep the button pressed with a tooltip that says so. |

## 6. Plan

Four waves, smallest risk first. Waves B to D change visible structure, so each gets a before/after board for review before any code.

- **Wave A — defects.** D1–D7. No design review needed. D1 first: it changes what a query returns. Each is its own issue.
- **Wave B — the condition row and group chrome.** F1–F7. The largest visible change and the one that most needs a mock: the one-line row at 400px, and the single group header. Amends W04 and W13.
- **Wave C — panel frame and flow.** F8–F11, S1, S2. Amends W05 §9.7; S2 closes #322.
- **Wave D — Plan tab.** P1–P5. Amends A06. Capture the `executionStats` view before designing it.

Decided in review:

- A condition that cannot be applied keeps its error (D4).
- The value gets its own full-width line (F1).
- The operator box keeps the symbol the user typed or picked (`=`, `!=`, `>`, `>=`, `<`, `<=`) instead of repainting it as `$eq`, `$ne` and so on. The stored operator, the filter bar text, saved queries and copied code are unchanged; operators with no symbol keep their name. This reverses the "input keeps showing `$gt`" clause of ADR 0004's symbolic-operators section, which gets amended when wave B is specified.

Open decisions:

1. F3: keep `AND / OR / NOR`, or move to `Match all / any / none`? The first is what Mongo users type; the second is what the control does.
2. F8: keep a footer, or fold its three actions into a `⋯` menu?
3. F1: is the type chip inside the value input acceptable, or must the type stay a separate, always-visible select?
