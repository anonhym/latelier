# X19 — Keyboard operability of custom controls

Epic: #51 · Source: `docs/UX-AUDIT.md` §N2 (addendum).
Base branch: `feature/n2-keyboard-operability`.

## Purpose

A pointer reaches every control in the app. A keyboard does not. Across nine
surfaces the app builds interactive controls out of `<div onClick>` — no `role`,
no `tabIndex`, no `onKeyDown` — or builds half the pattern and stops.

This is not an attribute sprinkle. The nine surfaces reduce to **five recurring
patterns**, and the spec is organised around the patterns, not the files:

| Pattern | Surfaces |
| --- | --- |
| Roving focus over a virtualized collection | result rows, navigator |
| Disclosure (expand/collapse a region) | aggregation stages, index/user detail rows |
| Toggle (on/off, single choice) | TLS/verify/direct switches, colour swatches |
| Tablist | builder sub-tabs |
| Separator with a value | resize handles |
| Reorder without a pointer | ColumnChooser |

## Scope

### In

Every surface listed in §2, brought to the acceptance criteria in §4.

### Out — deliberately, and not "not yet"

- **N3, the screen-reader announcement layer** (`aria-live`, combobox wiring,
  `role="alert"` on the error boundary). Filed separately; it overlaps this work
  at the toast/`OutputPanel` boundary and would double the diff.
- **N1, dialogs.** `specs/X15-dialog-consolidation.md`, epic #52 — and largely
  shipped already.
- **Visual redesign of any control.** Where Mantine already ships the right
  component, adopting it is in scope; restyling is not.

## Dependencies

None on other epics. `#20` is the first ticket and is already filed.

## 2. Roving focus over a virtualized collection

The first pattern, and the one that carries the only filed ticket (#20).

### What is already there — do not rebuild it

`src/hooks/useRovingHighlight.ts` **already exists** and already owns the hard
part: clamp-at-render and wrap-around arithmetic, computed from the *clamped*
index so a list shrinking underneath a standing highlight still walks from a row
that is on screen. It is consumed by `ConnectionSwitcher`, `SuggestionPopover`,
`CommandPalette` and `ConnectionExpandedTable`.

Its own docstring states the boundary: it owns "what index is highlighted right
now" and deliberately **not** key bindings or DOM wiring, because callers differ
too much. That boundary is correct and this spec keeps it. The missing layer is
the DOM half, not the arithmetic.

### What is actually missing

All three result views are `react-window`-virtualized
(`TableView.tsx:7`, `TreeView.tsx:7`, `JsonView.tsx:6`), and virtualization is
what makes this more than an `onKeyDown`:

- `TableView.tsx:530-534` — rows are `role="row"` inside a `role="grid"`, with
  `aria-rowindex` and `aria-selected`, `tabIndex={-1}`. The comment at `:528`
  says why no row may be a tab stop (overscan mounts 40+) and names #20 as the
  missing half in so many words.
- The row `onKeyDown` at `:543-552` already runs Enter/Space, and already guards
  against nested buttons bubbling into it (`e.target !== e.currentTarget`). It
  fires only for a row that *already* has focus — which nothing gives it.

> The audit and #20 both describe these rows as `role="option"`. That is stale.
> `TableView.tsx:518-526` records the change and the reason: `option` is
> children-presentational in ARIA, so it may not contain the cell controls these
> rows hold, and it needs a `listbox` parent the view never had. `row` inside
> `grid` is the correct pattern. **Implement against `row`/`grid`, not the
> ticket's wording.**

### Design

Add the DOM half as a second hook beside the first, rather than widening
`useRovingHighlight` — its four existing consumers are non-virtualized popovers
that need none of this, and widening it would make them pay for scroll handling
they cannot use.

- `useRovingHighlight` supplies `index` / `move` / `setIndex`, unchanged.
- The container owns the single tab stop and the key bindings: Arrow to `move(±1)`,
  Home/End to `setIndex(0)` / `setIndex(count - 1)`.
- The active row is identified by **`aria-activedescendant` on the container plus
  a stable DOM `id` per row**, not by calling `.focus()` on the row. With
  virtualization a `.focus()` target can unmount mid-scroll; the container keeps
  real focus throughout and only the pointer moves.
- Because `aria-activedescendant` must reference a *mounted* element, the active
  index change and the `react-window` scroll-into-view are one operation, not two.

### Test and mutation position

`useRovingHighlight` has exactly one test, `tests/component/useRovingHighlight.spec.tsx`
— the **component** project. It is not in `stryker.config.json`'s `mutate` array,
and CLAUDE.md says why that is currently correct: a file whose logic is only
exercised by component tests is too slow to rerun per mutant, so it stays out
"until that logic has fast `tests/unit/*.spec.ts` coverage of its own."

The hook is pure arithmetic — fast and deterministic. Ticket 1 therefore:

1. Adds `tests/unit/useRovingHighlight.spec.ts` covering clamp, wrap at both
   ends, `count === 0`, and the `resetKey` path.
2. Adds `src/hooks/useRovingHighlight.ts` to `mutate`, and hardens it to 90%+.

That is the CLAUDE.md-sanctioned path for the file, not an expansion of scope:
the hook is about to become load-bearing for three more surfaces.

## 4. Acceptance criteria

Per interactive control this spec touches:

- [ ] It is reachable by keyboard alone — either it is a tab stop, or it is a
      member of a composite widget whose container is a tab stop and which moves
      focus to it.
- [ ] It exposes a `role` that matches what it does, and the state attribute
      that role requires (`aria-selected`, `aria-expanded`, `aria-checked`,
      `aria-sort`, `aria-valuenow`).
- [ ] Every action it offers a pointer, it offers a keyboard. A context menu is
      not a keyboard path.
- [ ] No state is conveyed by colour alone.
- [ ] It is not hover-gated — an affordance that only appears on `:hover` is
      unreachable without a pointer, so it must also appear on `:focus-within`.

Per composite widget (grid, tree, tablist, listbox):

- [ ] Exactly one tab stop for the whole widget, never one per child.
- [ ] Arrow keys move the active child; Home/End jump to first/last.
- [ ] The active child is scrolled into view when it moves.
- [ ] The active child is identified to assistive tech — `aria-activedescendant`
      on the container, or real focus on the child.

## 5. Verification — mutation, not green

`tsc -b` was green before this work and proves nothing about it. Every ticket
validates by mutation: break the property the new test claims to protect,
confirm that exact test goes red, revert.

The mutation that matters per pattern:

1. **Roving focus** — delete the Arrow key branch; the navigation test must go
   red. A test that only asserts `tabIndex={-1}` on children stays green against
   a driver that never moves focus, which is precisely the #20 bug.
2. **Toggle** — flip `aria-checked` to a constant; the state test must go red.
3. **Separator** — delete the arrow-key resize branch; `aria-valuenow` must stop
   tracking.

Watch for equivalent mutations: removing a `tabIndex={-1}` that ARIA already
implies is a no-op, not a coverage hole. Prove equivalence with a real probe
before ceding it — never wave off a survivor by category.

**Any new hook with real branching goes into `stryker.config.json`'s `mutate`
array and is hardened to 90%+ before its ticket merges.** A roving-focus driver
(Arrow/Home/End/wrap/clamp) is exactly the shape of module that belongs there,
and it will have fast unit-test coverage, so the "slow or non-deterministic
coverage" disqualifier in CLAUDE.md does not apply.

## 7. Definition of done

Each ticket owes all eight gates in `CLAUDE.md` § Definition of done. This is a
code change, not docs-only. A PR into this base triggers **no CI at all**, so
every gate runs locally — an empty check list is not a pass.
