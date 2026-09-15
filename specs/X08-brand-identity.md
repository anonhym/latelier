# X08 — Brand identity (L'Atelier)

> **Status: Applied** (visual rollout). Application steps §3.1–§3.6 landed on branch `feat/x08-brand-identity`. The runtime app shows the L'Atelier favicon, splash, and packaged-app icons; the renderer surfaces `--atelier-violet` via CSS custom properties. **Code-level rename of `MongoLab` → `L'Atelier`** (`appId`, `productName`, `window.mongolab` IPC namespace, `MONGOLAB_USER_DATA_DIR`) **remains out of scope** — tracked separately in [X09](./X09-namespace-rename.md), which carries the `mongolab.db` userData migration that rename needs.

## Purpose

Replace the legacy "MongoLab" placeholder identity with **L'Atelier** — a deliberate brand for the desktop app. The metaphor frames the product as a craftsman's workshop where the user *shapes* data (queries, indexes, aggregations) rather than just navigating it. Atelier matches the existing UX (heavy keyboard, builder + visual modes, document-as-material) better than the generic "lab" framing.

This spec covers the **visual rollout only** — favicon, app icon, splash, README, palette tokens. Renaming `window.mongolab` → `window.atelier`, the `MONGOLAB_USER_DATA_DIR` env var, file paths in `src/api/mongolab.ts`, and `appId: dev.mongolab.app` is a separate spec ([X09](./X09-namespace-rename.md)) sequenced *after* this lands so the breaking IPC rename doesn't ride along with a cosmetic change.

## Scope

- **In**:
  - Palette tokens (violet / ghost / deep / navy) → `../atelier-brand/palette/tokens.css`
  - Brand mark (256×256 SVG ligature: bold L + violet dot + bold A) → `../atelier-brand/mark/atelier-icon.svg`
  - Wordmark on light and dark backgrounds → `../atelier-brand/wordmark/atelier-wordmark{,-light}.svg`
  - Application surfaces:
    - `public/favicon.svg` replacement (browser tab + dev window icon)
    - Generated platform icons: `build/icon.icns` (mac), `build/icon.ico` (win), `build/icon.png` (linux)
    - Splash / loading state in the renderer (icon + violet progress)
    - README hero
    - Palette token surfaced in at least one runtime stylesheet (smallest expression of "applied")

- **Out** (deferred):
  - **Renaming `window.mongolab` → `window.atelier`**, `MONGOLAB_USER_DATA_DIR`, `appId`, file paths in `src/api/mongolab.ts`. Owned by [X09](./X09-namespace-rename.md); touches every IPC consumer in the renderer.
  - **`userData` migration** — when the app eventually renames, existing macOS users need `~/Library/Application Support/mongolab/` copied to the new location. Owned by the rename spec.
  - **Marketing surfaces** — site, social profile assets, store listings.
  - **Animated brand assets** — Lottie / motion specs for the dot.
  - **Light-mode icon variant** — deferred until the renderer supports light mode (out of scope per current theme system).
  - **Re-themeing the entire renderer to the brand palette.** This spec only requires that *one* surface references `--atelier-violet`; a full re-theme would warrant its own spec.

## Dependencies

- **F06 (App lifecycle)** — splash/loading state mounts during connect-on-launch; integration point for the brand splash.
- **X01 (Theme + window state)** — palette tokens fold into the existing theme system rather than creating a parallel one (see §3.6).
- **electron-builder.yml** — `productName` and platform icon paths.

## See also

- **`atelier-brand` — separate sibling repo**, expected to live at `~/Projects/atelier-brand/` alongside this repo (`~/Projects/mongo-lab/`). Source of truth for the asset files referenced throughout this spec. Path references like `../atelier-brand/...` assume that layout — they are *not* paths inside this repo. Brand assets are intentionally kept out of `mongo-lab` because they have a different lifecycle (design iteration vs. application code).
- `../atelier-brand/source/option-a.html` — design exploration that produced the current direction (and visualizes the alternatives we rejected).
- The visual rollout that §3 describes — **shipped**; see the Status note above.
- The code-level rename — the breaking-change follow-up, still open.

## 1. Identity

### Palette

| Token | Hex | Role |
|-------|-----|------|
| `--atelier-violet` | `#7c6af7` | Primary accent — dot, focus, progress, links |
| `--atelier-ghost`  | `#e8e0ff` | Text on dark surfaces |
| `--atelier-deep`   | `#1a1a2e` | Primary dark surface — icon bg, splash, modals |
| `--atelier-navy`   | `#0d1f2d` | Alt dark surface — kept for option compatibility |

Violet is intentionally not MongoDB green. L'Atelier sits *beside* MongoDB tooling, not inside their brand.

### Mark

Typographic ligature: bold "L", violet dot at cap-height, bold "A". The dot replaces the apostrophe in "L'Atelier" and is the brand's only piece of color.

- Canvas: 256×256, rounded corner radius 56, deep background (`--atelier-deep`)
- Letterforms: Inter Black (900), `font-size: 148`, `letter-spacing: -3`, ghost fill (`--atelier-ghost`)
- L positioned at icon x=84, A at x=180 (text-anchor middle), baseline y=180
- Dot: violet circle, r=11, center (132, 74)

### Wordmark

The same conceit at scale: bold L, violet dot, light "Atelier".

- viewBox `0 0 600 200` (cropped tight; content centered)
- L: Inter 900, font-size 140, x=40, baseline 148, letter-spacing -3
- "Atelier": Inter 300, font-size 140, x=148, baseline 148, letter-spacing -3
- Dot: violet circle, r=9, center (128, 60)
- Two color variants: dark text (`atelier-wordmark.svg`, fill `#1a1a2e`) and light text (`atelier-wordmark-light.svg`, fill `#e8e0ff`)

### Do / don't

- **Do** keep the dot violet. It's the only color in the mark; changing it kills brand recognition.
- **Do** preserve the weight contrast (900 / 300) in the wordmark — that's where the personality lives.
- **Don't** apply gradients, glows, or drop shadows to the mark or letters. The identity is flat, confident, geometric.
- **Don't** scale the dot independently. Sized to sit at cap-height; arbitrary resize destroys the ligature illusion.
- **Don't** approximate the dot with a typographic `·` (middle dot) or apostrophe glyph. The dot is a circle primitive in violet, not text.

## 2. Asset inventory

| Path | What | Authoring |
|------|------|-----------|
| `../atelier-brand/mark/atelier-icon.svg` | 256×256 ligature mark | hand-authored source |
| `../atelier-brand/wordmark/atelier-wordmark.svg` | dark-text wordmark | hand-authored source |
| `../atelier-brand/wordmark/atelier-wordmark-light.svg` | light-text wordmark | hand-authored source |
| `../atelier-brand/palette/tokens.css` | CSS custom properties | hand-authored source |
| `../atelier-brand/source/option-a.html` | exploration & spec rationale | hand-authored reference doc |
| `../atelier-brand/exports/icon-512.png` | raster icon | **TBD — generate before §3.1** |
| `../atelier-brand/exports/icon-1024.png` | raster icon @2x | **TBD — generate before §3.1** |
| `build/icon.icns` | macOS app icon | **TBD — generate from PNG** |
| `build/icon.ico` | Windows app icon | **TBD — generate from PNG** |
| `build/icon.png` | Linux app icon | **TBD — generate from PNG** |

The `build/icon.*` files are what `electron-builder` consumes; they are derived from the SVG via standard tooling (recommended: `electron-icon-builder` cross-platform, or `iconutil` on macOS for `.icns`). Treat them as build-time outputs but commit them — `electron-builder` reads from disk.

## 3. Application checklist

When the BACKLOG item triggers, apply in this order. Each step is independently verifiable.

### 3.1 Generate platform icons

Generate from `../atelier-brand/mark/atelier-icon.svg`:

- `../atelier-brand/exports/icon-1024.png` (rasterize SVG at 1024×1024)
- `build/icon.icns` (macOS, from PNG)
- `build/icon.ico` (Windows, from PNG)
- `build/icon.png` (Linux, 1024×1024)

**Verify**: open `build/icon.icns` in Finder; the icon shows the LA ligature with violet dot at every embedded size (16, 32, 128, 256, 512, 1024).

### 3.2 Wire icons into electron-builder

Add to `electron-builder.yml`:

```yaml
mac:
  icon: build/icon.icns
win:
  icon: build/icon.ico
linux:
  icon: build/icon.png
```

**Verify**: `npm run build` produces a release artifact whose Finder/Explorer icon is the new mark.

### 3.3 Replace favicon

Copy `../atelier-brand/mark/atelier-icon.svg` → `public/favicon.svg`. The current favicon (purple lightning bolt) is preserved in git history if rollback is needed.

**Verify**: `npm run dev` shows the LA mark in the browser tab.

### 3.4 Add splash component

New component (proposed: `src/components/Splash.tsx`) renders icon + tagline + violet progress, mounted by `App.tsx` during connect-on-launch (per F06 lifecycle). Reference layout in `../atelier-brand/source/option-a.html` §05 ("Splash").

**Verify**: cold-start the app; see the splash for ≥300ms before the connection list mounts.

### 3.5 Update README hero

Replace any existing top-of-README image with `../atelier-brand/wordmark/atelier-wordmark.svg`.

**Verify**: GitHub repo page shows the new wordmark.

### 3.6 Surface palette tokens in the renderer

Pick the **smallest** option that satisfies design intent for this iteration:

1. Add the four `--atelier-*` tokens to `:root` in the existing theme stylesheet, used by hand in the splash and any other brand-specific surfaces. **Lowest blast radius — recommended for X08.**
2. Map `--atelier-violet` to the existing accent token (whatever it's currently called) in the theme system. **Replaces existing accent globally; visual delta across the whole app.**
3. Full re-theme. **Out of scope here; would warrant its own spec.**

X08 ships with option (1). **Update**: option (3) — full re-theme — was applied in [X10](./X10-renderer-retheme.md), on the same branch.

## 4. Acceptance criteria

The spec is "applied" when:

- [x] `public/favicon.svg` shows the L'Atelier mark in browser tabs and the dev window.
- [x] Packaged app (`npm run build` → release output) shows the L'Atelier icon in Finder / File Explorer / dock.
- [x] App splash on cold start shows the icon and a violet progress indicator before the first route renders.
- [x] README hero is the L'Atelier wordmark.
- [x] At least one runtime stylesheet references `--atelier-violet` (smallest expression of token surfacing).
- [x] No remaining references to MongoLab in user-visible *visual* surfaces. The string "MongoLab" still appears in code identifiers (`window.mongolab`, `ATELIER_USER_DATA_DIR`, etc.) — that's the future rename spec, not this one.

## 5. Test cases

- **Build artifact has new icon**: `npm run build` → unzip the .dmg/.AppImage/.exe → verify the bundled icon file matches `build/icon.icns` (etc.) by hash.
- **Cold-start splash visible**: Playwright e2e test in `tests/e2e/lifecycle.spec.ts` that launches with an empty `ATELIER_USER_DATA_DIR`, asserts the splash element is in the DOM before the first connection-list render, and disappears within ~2s.
- **Favicon renders**: load `index.html` in dev → assert `document.querySelector('link[rel="icon"]').href` ends with `favicon.svg` and the SVG content matches `../atelier-brand/mark/atelier-icon.svg` by hash.

## 6. Migration / rollback

- Purely additive: new files in `build/`, new component, palette token addition. Reverting means deleting the new files and the `Splash` import in `App.tsx`. No data loss, no IPC change, no `userData` path change.
- The eventual code rename (separate future spec) is *not* additive and will need its own migration plan for `userData` directory paths on each platform.
