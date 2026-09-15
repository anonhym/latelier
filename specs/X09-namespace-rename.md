# X09 — Namespace rename (MongoLab → L'Atelier)

> **Status: Phase 1 + Phase 2 applied · Phase 3 deferred.** The display name in the menu bar / Finder, the IPC bridge identifier (`window.atelier`), the env var (`ATELIER_USER_DATA_DIR`), and renderer file paths now use the L'Atelier name. **`appId` remains `dev.mongolab.app`** so existing user data at `~/Library/Application Support/mongolab/` (and equivalents) keeps loading. Phase 3 — userData migration + `appId` change — is its own ticket.

## Purpose

Finish the L'Atelier rebrand in code, after [X08](./X08-brand-identity.md) shipped the visual identity. Splits the rename into three phases so the breaking ones (anything that touches user data) don't ride along with the cosmetic ones.

## Scope

### Phase 1 — Display strings (in)
- `productName: MongoLab` → `productName: L'Atelier` in `electron-builder.yml`
- `name`, `productName` in `package.json`
- README first-heading
- `<title>` in `index.html`

### Phase 2 — Code identifiers (in)
- `window.mongolab` → `window.atelier` (preload + `shared/ipc.ts` shape, every renderer consumer)
- File renames: `src/api/mongolab.ts` → `src/api/atelier.ts`; `tests/helpers/mongolabMock.ts` → `tests/helpers/atelierMock.ts`
- Env var: `MONGOLAB_USER_DATA_DIR` → `ATELIER_USER_DATA_DIR` (electron/main.ts, E2E test helpers, docs)
- TypeScript module-augmentation (`declare global { interface Window { atelier: … } }`)

### Phase 3 — userData identity (out — separate ticket)
- `appId: dev.mongolab.app` → `dev.atelier.app`
- One-shot migration on first launch with the new appId: detect existing userData at the old path on each platform; move (or copy + symlink) to the new path. Platforms:
  - macOS: `~/Library/Application Support/mongolab/` → `~/Library/Application Support/L'Atelier/`
  - Windows: `%APPDATA%/mongolab/` → `%APPDATA%/L'Atelier/`
  - Linux: `~/.config/mongolab/` → `~/.config/L'Atelier/`
- E2E coverage: launch with old userData dir present → assert data preserved post-migration.

### Out (also deferred)
- Spec body rewrites in `specs/F*`, `specs/C*`, `specs/W*`, `specs/A*`, `specs/X*` that reference "MongoLab" in prose. These are historical design docs; updating them is documentation hygiene, not blocking.
- Generated `.claude/skills/generated/*` files — they regenerate via `npx gitnexus analyze`.
- Renaming the `mongo-lab` git repo or the `mongo-lab` directory on disk.

## Naming decisions

| Surface | Old | New | Notes |
|---|---|---|---|
| Display name | `MongoLab` | `L'Atelier` | apostrophe preserved; safe for macOS DMG names, Windows installer text |
| Package name | `mongo-lab` | `latelier` | lowercase, no apostrophe (npm name rules) |
| IPC bridge global | `window.mongolab` | `window.atelier` | renderer-side; not user-facing |
| Env var | `MONGOLAB_USER_DATA_DIR` | `ATELIER_USER_DATA_DIR` | E2E + dev override |
| appId (Phase 3) | `dev.mongolab.app` | `dev.atelier.app` | reverse-DNS; controls userData path |

## Why not all-at-once

Changing `appId` orphans every existing user's settings, secrets, and saved connections. That requires a tested migration path — and the migration itself is its own design (do we move? copy + symlink? leave the old dir for rollback?). Coupling that to the cosmetic rename is the kind of thing that ships a P0 bug: a user updates and "all their connections are gone."

The split lets the visible rename ship safely now; the under-the-hood rename ships once migration is implemented and tested.

## Acceptance criteria — Phase 1 + Phase 2

- [x] App menu bar / About dialog / window title display "L'Atelier" instead of "MongoLab".
- [x] `npm run lint`, typecheck, and unit + component tests are green after the rename.
- [x] No `import` statements reference `'./api/mongolab'` (all replaced with `'./api/atelier'`).
- [x] No `window.mongolab` references in `src/` or `tests/`.
- [x] No `MONGOLAB_USER_DATA_DIR` references in source; `ATELIER_USER_DATA_DIR` is honored in `electron/main.ts` and E2E helpers.

## Acceptance criteria — Phase 3 (deferred)

- [ ] `appId: dev.atelier.app` set in `electron-builder.yml`.
- [ ] On first launch with the new appId, existing userData migrates to the new path on macOS, Windows, and Linux.
- [ ] E2E test: launch with simulated old userData; assert connections + secrets persist post-migration.

## See also

- [X08](./X08-brand-identity.md) — visual identity rollout (precedes this).
- The "Rename MongoLab → L'Atelier in code" item — this spec replaces that plan; Phase 3 of it is still open.
