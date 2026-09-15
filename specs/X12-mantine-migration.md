# X12 — Mantine migration

> **Status: Shipped.** The 13-phase migration landed — Mantine (`@mantine/core`/`@mantine/form`/`@mantine/modals`) is adopted across dozens of files, `App.tsx` mounts `MantineProvider`/`ModalsProvider` at the root, and source comments cite specific completed phases (e.g. "X12 Phase 0" in `App.tsx`, later phases in `ConnectionForm.tsx`, `Workspace.tsx`, `ConnectionManager.tsx`, `DbCollectionNavigator.tsx`). The acceptance-criteria checkboxes below were not individually re-audited against final code — treat this spec as historical design record for the target shape and phased approach, and prefer reading current source for the ground truth of what shipped. Builds directly on the composition seams introduced by [X11](./X11-workspace-composition.md).

## Purpose

Retire the inline-style + custom-token approach in the renderer in favor of [Mantine](https://mantine.dev) as the primitives layer for chrome (buttons, modals, drawers, menus, tabs, forms, command palette, app shell), while keeping the bespoke data views (result grid, JSON detail panel, schema viz, aggregation builder, CodeMirror) as custom components themed via Mantine CSS variables.

Today the renderer has **1,029 inline `style={{}}` occurrences across 53 files**, all themed by hand via `useT()` and `src/tokens.ts`. The pattern works but doesn't scale: every new component re-derives buttons, dialogs, focus rings, density rules, and a11y wiring. Mantine 7 collapses that surface into a small set of well-tested, accessible primitives backed by CSS variables — the same substrate `useT()` already approximates, but standardized.

## Scope

### In
- Adopt Mantine 7 as the primary component library and theming substrate.
- Replace chrome components (`Btn`, `ContextMenu`, `FeatureHint`, modals, drawers, tab strips, form inputs, command palette, app shell, notifications) with their Mantine equivalents.
- Migrate theming from `src/tokens.ts` + `useT()` to `MantineProvider` + CSS variables; preserve theme persistence via `api.prefs`.
- Add `react-resizable-panels` for the inner workspace split-pane behavior (sidebar ↔ main ↔ detail).
- Theme bespoke data views via Mantine CSS variables (no Mantine components inside virtualized rows).
- Update component and E2E tests for the new DOM shapes; prefer ARIA-role selectors over class selectors.

### Out
- **Data-view internals** — `ResultViewer.Tree` / `Table` / `Json`, `DetailPanel`, `SchemaView`, `BuilderPane` orchestration, aggregation pipeline stage cards, CodeMirror integration: these stay custom by design. Mantine themes them; Mantine doesn't render them.
- **The X11 composition seams** — `CollectionWorkspaceProvider`, `useQueryRunner`, the `<ResultViewer>` / `<QueryEditor>` / `<QueryBuilder>` compound shapes: untouched. Their *visual* leaves get reskinned; their *structural* contracts don't.
- **IPC, services, repositories, EJSON wire**: untouched.
- **The `useWorkspaceTabs` single-call-site rule**: preserved.
- **Renaming `tokens.ts` symbols across non-renderer code**: no consumers exist; the file is deleted in Phase 12.
- **Material 3 / M3 Expressive look**: explicitly deferred. Mantine is the destination, not a stepping stone. If M3 becomes desirable later, the post-X12 state is the right starting point: tokens centralized, primitives owned, layout in `AppShell`.
- **Tailwind**: not adopted. Mantine uses CSS variables + scoped CSS modules, not utility classes.

## Why Mantine specifically

Three component libraries were on the table:

1. **Radix Themes** — strongest a11y story, smallest API. Fits SaaS / marketing better than data-tool density. Visual identity is Linear/Vercel.
2. **shadcn/ui** — best long-term control (you own the components), but requires Tailwind, which is a separate paradigm shift the project isn't ready for.
3. **Mantine** — broadest component set for *data-tool* genre specifically: `AppShell`, `Spotlight` (real command palette), `Modal` manager, `@mantine/form`, `Drawer` with side variants, `Notifications`, dense defaults. Closest visual match to the genre (Compass / Studio 3T / Atlas) and the smallest gap between "library covers it" and "we already built it."

Picked Mantine. Rationale: maximizes off-the-shelf coverage of the *chrome* (~60% of files, ~90% of inline styles) while requiring the smallest paradigm shift. Bespoke data views remain custom — which they were always going to be regardless of library.

The trade-off accepted: Mantine is more opinionated than Radix Themes. Once adopted, the codebase is "Mantine-shaped." A future M3 retrofit would mean overriding Mantine's CSS rather than editing self-owned components. That cost is judged acceptable given the productivity win now.

## Target architecture

```
MantineProvider (theme, color scheme)
   ├── ModalsProvider           (global modal manager)
   ├── Notifications            (toast surface)
   └── App routes
       ├── ConnectionManager    — AppShell-style layout, Mantine forms/cards
       ├── NewConnection        — @mantine/form, TextInput/PasswordInput/Select/Switch
       └── Workspace
           ├── AppShell.Navbar  (connection/db/collection sidebar)
           ├── AppShell.Header  (tab strip, global controls)
           └── AppShell.Main
               └── react-resizable-panels
                   ├── QueryEditor  ── Mantine inputs in custom layout
                   ├── ResultViewer ── Mantine chrome (ResultBar, Pagination)
                   │                   + custom virtualized rows themed via CSS vars
                   └── DetailPanel  ── custom tree, themed via CSS vars
```

The X11 layering is preserved exactly: `useWorkspaceTabs` → `CollectionWorkspaceProvider` → headless hooks → compound components. X12 only changes the *visual* output of those compounds, plus the chrome around them.

## Phases

Each phase is its own PR, shippable independently. Phase boundaries are intentional stop points — the app is strictly better after any of them than before.

| # | Phase | Effort | Risk | Shippable? |
|---|---|---|---|---|
| 0 | Foundations | ½–1 day | low | yes |
| 1 | Primitives sweep | 3–5 days | medium | yes (per sub-PR) |
| 2 | Notifications | 1 day | low | yes |
| 3 | Modals & Drawers | 2–3 days | medium | yes |
| 4 | Forms | 2–3 days | medium | yes |
| 5 | Spotlight (command palette) | 1–2 days | low | yes |
| 6 | AppShell layout | 3–5 days | **high** | only when complete |
| 7 | Resizable inner panels | 1–2 days | low | yes |
| 8 | Tables (Users / Indexes) | 2–3 days | low | yes |
| 9 | Workspace chrome | 2–3 days | low–med | yes |
| 10 | Result grid integration | 1–2 days | medium | yes |
| 11 | Detail panel & custom views | 1–2 days | low | yes |
| 12 | Token cleanup (`useT()` removal) | 1–2 days | low | yes |
| 13 | Test sweep | continuous | — | — |

**Total: 22–35 working days** for one focused engineer (~5 weeks with normal interruptions).

### Phase 0 — Foundations

- Install: `@mantine/core @mantine/hooks @mantine/notifications @mantine/modals @mantine/form @mantine/spotlight`
- Install side deps: `react-resizable-panels`, `postcss-preset-mantine`, `postcss-simple-vars`
- Add `postcss.config.cjs` per Mantine 7 setup; verify Vite picks it up
- Add `src/theme/mantineTheme.ts` mapping `tokens.ts` values onto Mantine's theme: violet primary scale, `defaultRadius`, font stack, custom shadows
- In `App.tsx`, wrap with `<MantineProvider>`, `<ModalsProvider>`, `<Notifications />`. Wire color scheme to existing `useTheme()` hook so it drives both Mantine and `useT()` simultaneously
- Leave `tokens.ts` and `useT()` untouched — coexistence is required through Phase 11

**Acceptance:** App renders identically. Mantine providers mounted. CSS variables emitted at `:root`. `npm test` and `npm run lint` green.

### Phase 1 — Primitives sweep

Replace the smallest, most-used components first. Leaf order:

1. `src/components/Btn.tsx` → delete; replace ~80 call sites with `<Button>` / `<ActionIcon>`. Split this work by directory (one PR for `pages/` call sites, one for `Workspace/` call sites, one for the rest).
2. `src/components/ContextMenu.tsx` → Mantine `Menu`.
3. `src/hints/FeatureHint.tsx` → `Tooltip` / `HoverCard` / `Popover`.
4. Inline tooltips scattered across `Workspace/*` files.

**Acceptance:** zero remaining imports of `Btn`, `ContextMenu`, `FeatureHint`. Component tests updated to assert via ARIA roles (`getByRole('button', { name })`) rather than test IDs where possible. `npm test` green.

### Phase 2 — Notifications

- Audit current error display surfaces (callout-style inline divs, ad-hoc red banners, anywhere IPC errors are rendered).
- Standardize via `notifications.show({ color, title, message })`.
- Wire IPC error envelope failures to a notification helper in `src/api/atelier.ts` so any `{ ok: false, error }` automatically surfaces.

**Acceptance:** at least one error path proven to fire a Mantine notification end-to-end. No ad-hoc error banners in `src/pages/`.

### Phase 3 — Modals & Drawers

- `src/pages/SettingsModal.tsx` → `Modal` + `Tabs` + `Switch` + `Slider`.
- `src/troubleshooting/TroubleshootingDrawer.tsx` → `Drawer position="right"`.
- `src/pages/Workspace/InsertDrawer.tsx` → `Drawer`.
- Scattered confirm-delete dialogs → `modals.openConfirmModal({...})` via the global modal manager.

**Acceptance:** every overlay surface uses Mantine. Focus trap, ESC handling, scroll lock verified. Edit / delete / insert flows in workspace integration tests still pass.

### Phase 4 — Forms

- `src/pages/NewConnection.tsx` → `@mantine/form` with `TextInput` / `PasswordInput` / `Select` / `Switch`. Lift the connection-string parser into the form's `transformValues` or `validate` step.
- Settings form fields inside `SettingsModal.tsx`.
- Any inline `<input>` usage in workspace subviews not already migrated.

**Acceptance:** form state, validation, and dirty-tracking live in `useForm`. No ad-hoc `useState` form patterns remain in migrated files.

### Phase 5 — Spotlight (command palette)

- `src/commands/CommandPalette.tsx` → `@mantine/spotlight`.
- `src/commands/GlobalCommands.tsx` → register actions via Spotlight's action API.
- Cmd+K / Ctrl+K binding wired through Spotlight's trigger.

**Acceptance:** palette opens via shortcut, all current commands listed and dispatch correctly. Keyboard navigation passes a11y check.

### Phase 6 — AppShell layout (highest risk)

- `src/pages/Workspace.tsx` outer layout → `AppShell` with `Navbar` (left sidebar) + `Header` (tab strip + global controls) + `Main`.
- `src/pages/ConnectionManager.tsx` → either `AppShell` variant or a simpler `Container`-based layout.
- AppShell sidebar collapse/expand state persisted via existing `api.prefs` panel-width key.

**Why this is the dangerous phase:** every visible page depends on the shell. Plan: execute in isolation on a long-lived branch, merge to main only when the full phase is working and E2E tests pass. No intermediate states shipped.

**Acceptance:** workspace renders with Mantine `AppShell` chrome. Sidebar width persists across reloads. All E2E happy-path tests pass.

### Phase 7 — Resizable inner panels

- Add `react-resizable-panels` for the inner splits inside `AppShell.Main`: query/builder pane ↔ result grid ↔ detail panel.
- Persist panel sizes via `api.prefs`.

**Acceptance:** splitters drag smoothly, sizes round-trip across reloads, no layout shift on first render.

### Phase 8 — Tables

- `src/pages/UsersTab.tsx` → `Table` + per-row `Menu` + create/edit `Modal`s.
- `src/pages/IndexesTab.tsx` → `Table` + create-index form `Modal`.

`mantine-react-table` may be evaluated as an upgrade path but is not required for this phase.

**Acceptance:** both tabs render their data via Mantine `Table`. CRUD flows still work.

### Phase 9 — Workspace inner chrome

- `src/pages/Workspace/QueryBar.tsx` / corresponding `QueryEditor.*` compound slots → `Group` + `TextInput` + `Button` + `Menu`.
- `src/pages/Workspace/ResultBar.tsx` / `ResultViewer.Pagination` slot → `Group` + `ActionIcon` + `Pagination` + `Text`.
- `src/pages/Workspace/BuilderPane.tsx` / `QueryBuilder.*` slots → keep bespoke layout; swap inputs to Mantine.
- Tab strip styling within `WorkspaceInner`.

**Acceptance:** the chrome *around* the data views is fully Mantine. Data views themselves untouched.

### Phase 10 — Result grid integration

- Keep `react-window`-based result grid; **no Mantine components inside the row renderer**.
- Row backgrounds, borders, hover states reference Mantine CSS variables (`var(--mantine-color-gray-1)`, `var(--mantine-spacing-xs)`, theme-aware accent).
- `ResultBar` chrome above the grid is fully Mantine (delivered in Phase 9).
- Verify scrolling perf with 10k+ row case.

**Acceptance:** result grid visually consistent with Mantine theme in both light and dark modes. Frame time during scroll unchanged vs pre-migration baseline.

### Phase 11 — Detail panel & remaining custom views

- `src/pages/Workspace/DetailPanel.tsx` → wrap in `Paper`, restyle tree-node CSS to use Mantine vars.
- `src/pages/Workspace/SchemaView.tsx` → restyle field-distribution viz with Mantine vars; logic untouched.
- `src/components/ScriptEditor.tsx` → wrap in `Paper`; harmonize CodeMirror theme colors with Mantine (light/dark variants pulling from the same accent).
- `src/components/Splash.tsx` → `Center` + `Paper` + Mantine `Loader`, or keep custom — call at implementation time.

**Acceptance:** every visible surface uses Mantine tokens, including bespoke views. No inline `style={{}}` referencing `useT()` remains in `src/pages/`.

### Phase 12 — Token cleanup

- Delete `src/tokens.ts`.
- Delete the `useT()` half of `src/ThemeContext.tsx`. Keep the `useTheme` mode hook (drives `api.prefs.setTheme`); rewire it to drive `useMantineColorScheme()`.
- Grep `useT(` and `from './tokens'` across `src/` and assert zero remaining call sites before deleting.
- Move tokens Mantine doesn't cover (status pill foregrounds, schema-view specific accents) into `theme.other` on `MantineProvider`.

**Acceptance:** single source of truth for design tokens. `useT` symbol does not exist. `tokens.ts` does not exist. `npm test`, `npm run lint`, and `npm run build` all green.

### Phase 13 — Test sweep (continuous)

This is not a phase you do at the end — it runs across every other phase. Key notes:

- **Component tests** (`tests/component/*`): many assert on DOM shape. `getByRole('button')` keeps working through the migration; `getByTestId(...)` breaks if test IDs aren't preserved. Add `data-testid` *before* swapping any component the tests rely on.
- **E2E tests** (`tests/e2e/*`): Playwright selectors will break for swapped modals / drawers / menus. Prefer `getByRole('dialog')`, `getByRole('menuitem', { name })` over CSS classes (Mantine's class names are hashed and unstable).
- **`atelierMock.ts`**: unaffected — mocks IPC, not UI.
- **ABI flips**: irrelevant to all of this. UI changes don't require `rebuild:electron`.

## Files touched (cumulative across phases)

Renderer-only. No `electron/`, no `shared/`, no migrations.

- **Deleted by end of migration**: `src/components/Btn.tsx`, `src/components/ContextMenu.tsx`, `src/components/Splash.css` (probably), `src/tokens.ts`, parts of `src/ThemeContext.tsx`, `src/commands/CommandPalette.tsx` (replaced by Spotlight registration).
- **Reskinned**: every file under `src/pages/`, `src/pages/Workspace/`, `src/components/`, `src/hints/`, `src/commands/`, `src/troubleshooting/`.
- **New**: `src/theme/mantineTheme.ts`, `postcss.config.cjs`, possibly `src/theme/notifications.ts` helper.

## Branch strategy

- One long-lived feature branch (`feat/mantine-migration`) tracks the full migration.
- Each phase is its own PR against the feature branch with its own test sweep.
- Merge the feature branch to `main` at phase boundaries that produce visible improvement: after Phase 1, 5, 6, 9, 12.
- Phase 6 (AppShell) is the only phase that meaningfully changes layout — do it in isolation, don't combine with anything else.

## Stop points

The migration can pause at any phase boundary with the codebase strictly improved:

- **After Phase 5:** chrome primitives + overlays + forms + palette are Mantine. Layout shell still custom. Already a big improvement.
- **After Phase 9:** the only thing still inline-styled is the data viz itself. ~85% of inline styles eliminated. Defensible stopping point.
- **After Phase 12:** clean slate. The only custom styling left is intentional (data views). Tokens unified.

## Risks & mitigations

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| AppShell phase breaks E2E selectors | high | medium | Audit selectors before Phase 6; convert class-based selectors to ARIA-role-based in advance. |
| Mantine wrapper DOM tanks virtualized row perf | medium | high | Phase 10 explicitly forbids Mantine inside row renderers; benchmark before/after. |
| `useT()` and Mantine drift visually during long coexistence | medium | low | Map `tokens.ts` values onto `MantineProvider` theme in Phase 0 so both systems emit the same CSS variables. |
| Bundle size growth | low | low | Tree-shaking handles unused Mantine modules; budget ~150 KB gz total — non-issue for Electron. |
| `connection-string` parser regression during form migration | medium | high | Phase 4 lifts the parser as a `validate` step without rewriting it; preserve existing unit tests for the parser. |
| PostCSS config conflict with Vite | low | medium | Phase 0 verifies build before any other work lands. |

## Acceptance criteria (overall)

- [ ] No `import { useT } from '...ThemeContext'` in `src/`.
- [ ] No `import { ... } from '../tokens'` (or any path to `tokens.ts`) in `src/`.
- [ ] No `style={{` in `src/pages/`, `src/components/`, `src/commands/`, `src/troubleshooting/`, `src/hints/` except in deliberately bespoke leaves (data viz rows, CodeMirror wrapper, splash, JSON tree nodes — enumerated in code with a brief comment).
- [ ] Inline-style occurrence count (`rg "style=\{\{" src/ | wc -l`) reduced by at least 85% from baseline (1,029).
- [ ] `MantineProvider` is mounted once at the app root and drives both light/dark themes.
- [ ] Theme mode persistence (`api.prefs.setTheme`) works end-to-end through `useMantineColorScheme()`.
- [ ] All existing component tests pass.
- [ ] All existing E2E tests pass.
- [ ] No visual regression in `ResultViewer.Tree` / `Table` / `Json`, `DetailPanel`, `SchemaView`, CodeMirror script editor (verified by hand against the pre-migration build).
- [ ] `npm run build` succeeds; bundle size delta documented.

## Test cases

- **Unit**: no new unit tests required — Mantine is presentational. Existing unit tests (URI parser, MQL compiler, EJSON, builder reducer) untouched.
- **Component**: each phase updates affected component tests to assert via ARIA roles. New tests cover: `notifications.show` integration, `@mantine/form` validation paths in `NewConnection`, Spotlight action registration.
- **Integration**: existing integration tests are unaffected (they test main-process services). Spot-check that `workspace_tabs.state_json` persistence still round-trips through the migrated `useWorkspaceTabs` consumer.
- **E2E**: a full Playwright pass at the end of each phase. Particular attention to: open/close of every modal and drawer, Spotlight command dispatch, sidebar resize persistence, theme toggle round-trip.

## Constraints

- The X11 contract (`CollectionWorkspaceProvider`, `useQueryRunner`, compound components) is load-bearing — do not change its public shape. Only the leaves' internals change.
- `useWorkspaceTabs` remains a single-call-site hook at `WorkspaceInner` (CLAUDE.md "Renderer state" section).
- No Mantine components inside virtualized row renderers (`ResultViewer.Tree`, `ResultViewer.Table` rows).
- Theme persistence stays in `app_state` via `api.prefs`; do not introduce a parallel persistence channel.
- No new IPC channels are added. No `shared/` or `electron/` changes.

## Decisions (resolved)

- **Mantine 7+ only.** Avoid Mantine 6 (emotion runtime, different theming model).
- **Light + dark only.** No "auto/system" tri-state at the Mantine layer — the existing `useTheme` mode hook resolves system preference to a concrete `'light' | 'dark'` before handing it to `MantineProvider`.
- **Violet primary.** Mantine's built-in violet scale is close enough to `#7c6af7` that no custom palette is required; revisit only if contrast/branding feedback says otherwise.
- **Notifications opt-in per call site.** No global wrapper that auto-toasts every IPC failure — explicit calls only. Avoids surprise toasts during silent retries.
- **`@mantine/modals` for confirms.** Replaces ad-hoc confirm dialogs. Custom modals with non-trivial content still use `<Modal>` directly.

## Open questions

- Should the result grid eventually move to `mantine-react-table` (TanStack Table wrapper)? Not in scope here; revisit after Phase 12 as a separate spec if the current `react-window` grid hits feature ceiling.
- Should `BuilderPane` / `QueryBuilder` slots adopt Mantine's `Combobox` headless primitive for operator pickers? Possible polish item for Phase 9; not required.
- Splash screen — keep the bespoke animation or rebuild with Mantine `Loader`? Decide at Phase 11.

## See also

- [X10](./X10-renderer-retheme.md) — current theming foundation; X12 supersedes the `tokens.ts` half of X10.
- [X11](./X11-workspace-composition.md) — workspace composition seams that X12 reskins without restructuring.
- [X01](./X01-theme-window-state.md) — `api.prefs` theme persistence; preserved as-is.
- CLAUDE.md — "Renderer state" section: `useWorkspaceTabs` single-call-site rule (preserved).
- [Mantine 7 docs](https://mantine.dev/getting-started/) — install, theming, AppShell, Spotlight, form, modals manager.
- [react-resizable-panels](https://github.com/bvaughn/react-resizable-panels) — used in Phase 7 for inner splits.
