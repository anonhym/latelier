# X10 — Renderer re-theme

> **Status: Accepted.** The re-theme below shipped; the dark theme pass in the amendment at the end is agreed and not built yet. Promoted from [X08 §3.6 option 3](./X08-brand-identity.md) (full re-theme, originally deferred). Lands on the same branch as X08 + X09.

## Purpose

X08 §3.6 surfaced the brand palette as CSS custom properties but explicitly recommended option 1 ("smallest expression"): tokens at `:root`, used by hand in the splash. The accent green / lime in `src/tokens.ts` stayed.

That left the app visually inconsistent: brand splash, brand favicon, brand wordmark — but every page (Connection Manager, Workspace, drawers, modals, data view) still showed the old MongoLab forest green for buttons, focus rings, active states, and category tags. X10 closes that gap.

## Scope

### In
- **Light mode**: keep the warm-paper aesthetic (`#FAF8F2` surfaces, `#1C1812` text, warm beige borders) — only the **accent** swaps from forest green `#1A6835` to atelier-violet `#7c6af7`. Status colors (greenDot/warn/red) unchanged.
- **Dark mode**: full pivot to the atelier-deep palette to match the splash:
  - `bg: #1a1a2e` (atelier-deep), `surface: #22223C`, `surfaceRaised: #2A2A45`, `surfaceActive: #34344F`
  - `text: #e8e0ff` (atelier-ghost), `textMuted: #8E88B0`, `textGhost: #46467A`
  - Borders shift from `rgba(255,255,255,…)` → `rgba(232,224,255,…)` (ghost-tinted)
  - Accent: violet `#7c6af7`, white text on violet
  - Status colors stay functional (semantic green/orange/red).
- **Hardcoded category colors that read as "MongoLab brand"**:
  - `TreeView` ObjectId tag: `#1A6835` → `#3D3984` (deeper indigo, brand-aligned)
  - `$match` aggregation stage tag: `#1A6835` → `#3D3984`
  - `stage` operator class tag (in suggestions): `#1A6835` → `#3D3984`
  - Connection-color picker first slot + new-connection default: `#1A6835` → `#7c6af7`

### Out
- **Other categorical palette colors** (date blue, regex orange, decimal purple, etc.) — these are functional differentiation, not brand. Left alone.
- **Component-level redesigns** — typography, spacing, density, composition. X10 is colors-only; structural changes belong in their own specs.
- **Theme contrast accessibility audit** — all changes preserve contrast against the existing surfaces but a comprehensive WCAG audit is a separate effort.

## Design call (the one X08 deferred)

Three options were on the table:

1. **Keep warm paper everywhere; swap accent only in both modes.**
   Pro: minimal disruption.
   Con: dark mode still reads as the old MongoLab — the brand only lives in a tiny accent.
2. **Commit to atelier palette in both modes.**
   Pro: maximally on-brand.
   Con: light mode against ghost-violet surfaces is jarring for a developer tool used in long sessions.
3. **Hybrid — light keeps warm paper, dark adopts atelier-deep.**
   Pro: light mode stays familiar; dark mode reinforces the splash. Most desktop dev tools (VS Code, Linear, Tana) follow this asymmetry — calmer light, more expressive dark.
   Con: two visually distinct moods rather than one continuous brand.

**Picked option 3.** Rationale: the brand's strongest visual statement (the LA mark on atelier-deep) only reads in dark mode. Forcing light mode to the same surfaces would crowd brand into a mode where users want minimal visual noise. The asymmetry is a feature, not a bug.

## Files touched

- `src/tokens.ts` — LIGHT (accent only), DARK (full re-theme)
- `src/pages/Workspace/views/TreeView.tsx` — `TYPE_COLORS.objectid`
- `src/pages/Workspace/Aggregation/pipeline.ts` — `OP_COLOR.$match`
- `src/features/fieldSuggestions/operators.ts` — `CLASS_COLOR.stage`
- `src/pages/NewConnection.tsx` — `COLORS[0]` and `INITIAL.color`

## Acceptance criteria

- Dark mode shows atelier-deep surfaces and atelier-ghost text. The splash bg blends seamlessly with the connection list bg behind it.
- Light mode keeps the warm paper feel; only the accent (buttons, focus, active states) is violet.
- No surface in `src/` references `#1A6835` or `#3DC870` (the two old accent colors).
- `npm run lint`, typecheck, and unit + component tests are green.

## See also

- [X08](./X08-brand-identity.md) — brand identity rollout (precedes this; §3.6 deferred this work)
- [X09](./X09-namespace-rename.md) — namespace rename (parallel rebrand work)
- `branding/palette/tokens.css` (in the `atelier-brand` sibling repo) — source of truth for the violet/ghost/deep/navy values

## Amendment — dark theme pass

> **Accepted, not built.** It runs last, after every surface reworked by the One Spine amendments (W01 §14, W05 §9, W06 §8 and the rest) has landed, because it touches all of them.

The dark theme was derived from the tokens and never reviewed on screen. Captures of the shipped build show the window body painted in the surface tone rather than the background tone, borders at 8% and 14% alpha doing the work of separating panels, and a connection tint of 14% that barely registers over a near-black background.

### Rules

- **Three stepped surfaces**, from the existing tokens: the canvas on `--atelier-bg`, panels (navigator, Inspector, the bars) on `--atelier-surface`, raised things (popovers, cards, the selected row) on `--atelier-surface-raised`. Panels are told apart by the surface step first and by a border second.
- **Connection colour**: the tab and navigator stripe at full saturation; any tint mixed from it is at least 24% in dark. Light keeps its values.
- **Results that are not current** are marked by the banner of [W06 §8.2](./W06-result-views.md), never by opacity, so dimming never stacks on text that is already low-contrast.
- **Contrast**: every text and icon colour on its surface passes `src/theme/contrast.ts` at the size it is drawn, the 12px label on the accent fill included.
- Dark is designed, not inverted: each reworked surface is captured in both themes at 1440×900 and reviewed before this is called done.

### Acceptance criteria

- In dark, the canvas, a panel and a popover are three distinguishable tones, in that order from darkest.
- A tab's connection stripe is the Connection's colour unmixed; a group chip's tint is at least 24%.
- No result row is drawn at reduced opacity in either theme.
- The contrast check passes for every token pair the shell uses, in both themes.
- Dark captures exist for: Documents (Table, Tree, JSON), a stale result, the Filter Bar with an error strip, the Inspector, Aggregation, Schema & indexes, a script tab, the Console, the palette, the Switcher, the Connections table, the connection form, the welcome canvas, the Document Editor with a conflict, and the status bar.

### Test cases

- **Unit** (`filled-button-contrast` and a token-pair table): each foreground/background pair the shell uses meets its ratio in both themes; the dark tint floor.
- **E2E**: the dark captures above, each asserting the scheme attribute and the canvas, panel and raised tones by computed style.
