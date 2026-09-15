# X10 — Renderer re-theme

> **Status: Applied.** Promoted from [X08 §3.6 option 3](./X08-brand-identity.md) (full re-theme, originally deferred). Lands on the same branch as X08 + X09.

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

- [x] Dark mode shows atelier-deep surfaces and atelier-ghost text. The splash bg blends seamlessly with the connection list bg behind it.
- [x] Light mode keeps the warm paper feel; only the accent (buttons, focus, active states) is violet.
- [x] No surface in `src/` references `#1A6835` or `#3DC870` (the two old accent colors).
- [x] `npm run lint`, typecheck, and unit + component tests are green.

## See also

- [X08](./X08-brand-identity.md) — brand identity rollout (precedes this; §3.6 deferred this work)
- [X09](./X09-namespace-rename.md) — namespace rename (parallel rebrand work)
- `branding/palette/tokens.css` (in the `atelier-brand` sibling repo) — source of truth for the violet/ghost/deep/navy values
