# X09 — Namespace rename (MongoLab → L'Atelier)

> **Status: Phase 1 + Phase 2 + Phase 3 `appId` switch applied · remaining `mongolab` filenames tracked separately.** The display name in the menu bar / Finder, the IPC bridge identifier (`window.atelier`), the env var (`ATELIER_USER_DATA_DIR`), renderer file paths and the `appId` (`io.github.anonhym.latelier`) now use the L'Atelier name. The `mongolab.db` database name, the log pattern and the diagnostic filename keep the old name and are tracked separately. Recovering data from the old `MongoLab` userData directory is not automated; [the troubleshooting guide](../docs/troubleshooting.md) lists the manual steps.

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

### Phase 3 — Identity (partly in)
- `appId: dev.mongolab.app` → `io.github.anonhym.latelier` (applied). The project is hosted on GitHub with no domain of its own, so the ID uses the reverse of `anonhym.github.io`, the form Flathub requires for such projects.
- **`appId` does not decide the userData path.** Electron derives it from `app.name`, which `app.setName("L'Atelier")` in `electron/main.ts` sets. Changing `appId` leaves the directory where it is. What it does change on macOS is the bundle identity that, together with the code signature, governs access to the "L'Atelier Safe Storage" keychain item, so the switch lands with the first Developer-ID-signed release and the app handles a secret it can no longer decrypt with a specific re-enter-password path, not a generic error.
- The remaining `mongolab` filenames (`mongolab.db`, the log filename pattern, the diagnostic filename, doc paths) are tracked separately.
- Moving data out of the old `MongoLab` userData directory (only v0.1.0 to v0.4.0 shipped under that name) is not automated: the user moves the folder by hand, per [the troubleshooting guide](../docs/troubleshooting.md).
- Moving Connections between machines or installs is not part of this phase; that is [C13](./C13-connection-export-import.md).
- The signed release removes the 0.16.0 pre-signing notice. Saved passwords stay readable: macOS asks once for keychain access at the first connect, and "Always Allow" keeps them; the app explains the recovery if access is denied.

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
| appId (Phase 3, applied) | `dev.mongolab.app` | `io.github.anonhym.latelier` | reverse-DNS; bundle identity, not the userData path |

## Why not all-at-once

Renaming the userData directory orphans every existing user's settings, secrets, and saved connections, and changing `appId` together with code signing can cut off access to their saved secrets. Coupling those to the cosmetic rename is the kind of thing that ships a P0 bug: a user updates and "all their connections are gone."

The split lets the visible rename ship first. The `appId` switch followed with the signed release; the userData folder was never renamed again, and the few installs under the old `MongoLab` name move their folder by hand.

## Acceptance criteria — Phase 1 + Phase 2

- [x] App menu bar / About dialog / window title display "L'Atelier" instead of "MongoLab".
- [x] `npm run lint`, typecheck, and unit + component tests are green after the rename.
- [x] No `import` statements reference `'./api/mongolab'` (all replaced with `'./api/atelier'`).
- [x] No `window.mongolab` references in `src/` or `tests/`.
- [x] No `MONGOLAB_USER_DATA_DIR` references in source; `ATELIER_USER_DATA_DIR` is honored in `electron/main.ts` and E2E helpers.

## Acceptance criteria — Phase 3

- [x] `appId: io.github.anonhym.latelier` set in `electron-builder.yml`, before the first Developer-ID-signed release.
- [x] The pre-signing notice and its dismissal preference are removed.
- [x] The troubleshooting guide documents moving data from an old `MongoLab` install by hand.

## See also

- [X08](./X08-brand-identity.md) — visual identity rollout (precedes this).
- The "Rename MongoLab → L'Atelier in code" item — this spec replaces that plan; Phase 3 of it is still open.
