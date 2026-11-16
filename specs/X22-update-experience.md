# X22 — Update experience: check, indicator, What's new

> **Status: Implemented.**

## Purpose

X20 gives the app silent background updates and one toast when a download is ready. Close that toast and nothing in the app says an update is waiting, there is no way to look for one, and after a restart nothing says what changed.

X22 adds three things on top of X20's updater:

1. A way to look for an update: a manual check in Settings and the command palette, plus a re-check every 4 hours.
2. A place that shows an update is on its way or ready: a pill at the right end of the status bar, and a status card in Settings.
3. A short What's new window on the first launch after the version changes.

The design was reviewed on the Claude Design canvas "Update experience mockups" (boards 1–4), and this spec follows those boards.

X20's principle stays: a background update never interrupts and never fails loudly. X22 relaxes it in two named places only. A check the user started reports its result. The What's new window opens once per version change, after a restart the user chose.

## Scope

### In

- More update states in main: checking, up to date, downloading with progress, ready, failed, and off.
- A manual check (`updates:check`) and a re-check every 4 hours while the app runs.
- The status-bar pill and its popover.
- Settings → **About and updates**.
- Three palette commands: Check for updates, Restart to update, What's new.
- The What's new window, built from the `CHANGELOG.md` bundled at build time.
- The release body on GitHub is the version's `CHANGELOG.md` section, so the popover can show highlights before the install.

### Out

- **Update channels (beta), rollback, and a setting to change the check interval or turn checks off.** The 4-hour interval is fixed.
- **Linux updates.** Linux shows the Off state with its own copy (§5.3).
- **Release notes for versions before 0.15.0.** Those entries are commit subjects, not user prose (see the note at the top of `CHANGELOG.md`).

## Dependencies

- X20: `UpdateService`, `shouldCheckForUpdates`, the `updates:*` channels and the quit-gate behaviour of `restart()`. All of it is kept.
- X19 (keyboard operability) and the popover rules in `CLAUDE.md`: every dismiss path calls `stopPropagation()`, and Escape closes.
- X07: the command registry, for the three commands.
- `app:openExternal`, whose host allow-list already holds `github.com`.

## 1. Update states

`UpdateState` in `shared/types.ts` becomes:

```ts
type UpdateState =
  | { status: 'off'; reason: 'development' | 'linux' }
  | { status: 'idle' }                                      // enabled, not yet checked
  | { status: 'checking'; lastCheckedAt: string | null }
  | { status: 'up-to-date'; lastCheckedAt: string }
  | { status: 'downloading'; version: string; percent: number; lastCheckedAt: string }
  | { status: 'ready'; version: string; highlights: string[]; changeCount: number | null; releaseUrl: string; lastCheckedAt: string; downloadedAt: string }
  | { status: 'failed'; message: string; lastCheckedAt: string | null };
```

- Timestamps are ISO-8601 strings, like everywhere else in the app.
- `off` replaces "disabled → the updater is never loaded". The updater is still never loaded when off. `reason` is `linux` on Linux, and `development` for every other case `shouldCheckForUpdates` rejects: not packaged, or `ATELIER_USER_DATA_DIR` set.
- `ready` is sticky. Once an update is downloaded, no later check, timer or error moves the state away from `ready`.
- `failed` only comes from a check the user started (§2). A failed background check is logged at warn and the state goes back to what it was before the check (`idle` or `up-to-date`). This keeps X20's rule.
- Every change is pushed on `updates:state-event`. Progress pushes are throttled to one per 500 ms and one per whole percent, so a fast download does not flood IPC.

## 2. Checks

- **At launch:** unchanged from X20.
- **Every 4 hours:** a timer started after the launch check. It is cleared on `will-quit`, not `before-quit`: a quit the user cancels at the running-work question still fires `before-quit`, and the app that keeps running must keep re-checking. The timer does nothing while the state is `checking`, `downloading` or `ready`.
- **Manual:** `updates:check`. It returns the state once the check settles, and pushes the state along the way.
  - While the state is `checking` or `downloading`, it returns the current state without starting another check.
  - While `ready` or `off`, it returns the current state unchanged and does not throw.
  - When the check fails, the state becomes `failed`, and the next check of either kind clears it.
- **Updater events:** `UpdaterLike` gains `checking-for-update`, `update-available`, `update-not-available` and `download-progress`, on top of `update-downloaded` and `error`. Their names and payloads are checked against the installed electron-updater 6.8.9 typings before coding, and `tests/unit/load-updater-shape.spec.ts` is extended to cover them.

## 3. Release highlights before install

The popover and the Settings card show the pending version's highlights. The bundled `CHANGELOG.md` cannot supply them, because it is the old version's file, so they come from the GitHub release body, which electron-updater exposes as `releaseNotes` (HTML).

- **Release workflow:** `release.yml` stops using `generate_release_notes: true`. It extracts the tagged version's section from `CHANGELOG.md` and passes it as the release body (`body_path`). A tag whose version has no section fails the `verify` job. This replaces the manual "edit the notes" step after a release.
- **Main:** `extractHighlights(html)` is a pure function in `electron/updater/releaseNotes.ts`. It reads the text of each list item's leading `<strong>`, drops any tags inside, cuts a trailing comma or period, and adds one period. It returns the first three items, and the total number of list items as `changeCount`.
  - It parses with a bounded scan, not nested-quantifier regexes. The input is downloaded HTML, so the ReDoS rule applies.
  - When nothing is found, it returns `highlights: []` and `changeCount: null`. The popover then shows only the release-notes link.
- `releaseUrl` is `https://github.com/anonhym/latelier/releases/tag/v<version>`, opened through `app:openExternal`.

## 4. Status bar pill

It sits at the right end of `StatusBar` (`src/pages/Workspace/StatusBar.tsx`), which is empty today. It is drawn on canvas board 1.

| State | Pill |
|---|---|
| `off`, `idle`, `checking`, `up-to-date`, `failed` | nothing |
| `downloading` | Muted text, not a button: download icon, "Downloading 0.20.0", a 48 px bar, "42%". |
| `ready` | Accent pill, a native `<button>`: restart icon, "0.20.0 ready · Restart". |

Clicking the ready pill opens a popover anchored above it. **It never restarts on one click.** The popover holds:

- the title "Version 0.20.0 is ready";
- "You're on 0.19.1. Restarting reopens your tabs." The second sentence only appears while Reopen tabs on launch is on;
- up to three highlights from §3;
- a link: "All 13 changes" when `changeCount` is known, otherwise "Release notes". It opens `releaseUrl`;
- **Later**, which closes the popover, and **Restart now**, which calls `updates.restart()`.

Escape and a click outside also close the popover. Each of those dismiss paths stops propagation. A cancelled restart (`restarting: false`) leaves the pill in place.

**Away from the workspace** (the Welcome and Connections screens have no status bar), X20's toast stays: id `update-ready`, shown once per version. Closing it is final for that version. The pill and Settings still show the update. The version the toast was shown for is stored in `app_state` as `update.toastShownFor`.

## 5. Settings → About and updates

There is a new rail entry under Maintenance, `SettingsSection` value `'about'`. It shows a dot while the state is `ready`. It is drawn on canvas board 2.

### 5.1 Layout

- **Identity:** the app mark, "L'Atelier", and "Version 0.19.1 · macOS · Apple silicon". The version comes from `__APP_VERSION__` (§6.1). The platform and architecture come from `app:getInfo` (§8), mapped to "macOS", "Windows" or "Linux" and, on macOS, "Apple silicon" or "Intel" (elsewhere "ARM64" or "x64"). If the call fails, the line shows the version alone and the failure is logged.
- **Status card,** one card that follows the state (§5.2).
- **Check for updates** button (secondary), with "Last checked 2 minutes ago · checks at launch and every 4 hours" beside it. The time is relative and refreshes every minute while the section is open.
- **Links:**
  - "What's new in <current version>" reopens the window from §6.
  - "Full release history on GitHub" opens `CHANGELOG.md` on GitHub through `app:openExternal`.

### 5.2 Card states

| State | Card |
|---|---|
| `ready` | Accent card: "Version 0.20.0 is ready to install" · "Downloaded today at 14:02." (read from `downloadedAt`) · **Restart now**. |
| `up-to-date` | Check icon: "You're up to date" · "0.19.1 is the latest version. Checked just now." |
| `checking` | Spinner: "Checking for updates…". The button is disabled. |
| `downloading` | "Downloading 0.20.0", a 42% bar, and "Keep working; you'll be offered a restart when it's done." |
| `failed` | Warning card: "Couldn't check for updates" · the message · **Try again**. |
| `idle` | No card, only the button. |

The download size is not shown, because electron-updater does not report the total before the download starts.

### 5.3 Off

When the state is `off`, the button is disabled and a line of text explains why:

- `development`: "Updates are off in development builds."
- `linux`: "Updates aren't available on Linux yet. Download new versions from GitHub." The word GitHub links to the releases page.

## 6. What's new window

It is drawn on canvas board 3.

### 6.1 Source

- `CHANGELOG.md` is imported in the renderer with Vite's `?raw`. This is a build-time import, so there is no IPC and no Node API involved.
- `vite.config.ts` defines `__APP_VERSION__` from `package.json`, typed in a `.d.ts`.
- `src/features/updates/changelog.ts` holds the pure logic:
  - **`parseChangelog(md)`** returns `Release[]`: version, date, preamble paragraphs, and groups (`Added`, `Changed`, `Fixed`, `Security`, `Removed`, `Deprecated`). Each group has items of `{ lead: string | null, text: string }`. It skips `[Unreleased]` and every version below 0.15.0.
  - **`releasesBetween(releases, from, to)`** returns the releases in the half-open range (`from`, `to`], newest first. It uses its own semver compare: plain `x.y.z` with numeric parts, no prerelease tags.
  - A bullet's `lead` is its leading `**…**` text, with a trailing comma or period replaced by one period. A bullet without one has `lead: null`.

### 6.2 When it opens

- `app_state` key `whatsNew.lastSeenVersion`.
- **On launch with no stored value** (a fresh install, and every e2e run): the window never opens. The current version is stored and nothing is shown.
- **On launch with a stored value below `__APP_VERSION__`:** the window opens with `releasesBetween(stored, current)`, and the current version is stored as soon as it opens, so it opens at most once per version. When that range has no releases, the version is stored and nothing opens.
- **A stored value above the current version** (a downgrade): the version is stored and nothing opens.
- **Timing:** it opens only after prefs have loaded and after the restored-tabs hint has been dismissed or was never shown, never on top of it. It takes focus on its close button, not on a field. If the palette is open, the window waits until the palette closes, so a launch-time window never pulls focus out of it.
- **Reopening** from Settings or the palette shows the current version's release only.

### 6.3 Layout

- **Header:** "What's new in L'Atelier". The subtitle is "Updated from 0.19.0 to 0.20.0 · 2 releases" when opened after an update, and "Version 0.20.0" when reopened. There is a close button.
- **Body, newest release:** "0.20.0 · 13 Nov 2026", plus a Current badge on the running version.
  - Then the preamble paragraphs, when there are any. These are not cut: 0.17.0's "Click Always Allow" note is the kind of thing that must be read.
  - Then each group as a heading followed by a bullet list of the leads. Items with no lead are left out of the short view.
  - A **Show details** button toggles every item's full text, including the leadless items.
- **Body, older releases in range:** each is collapsed to a disclosure button, "0.19.1 · 12 Nov 2026 · 1 fix". The count wording comes from the groups: "N fixes", "N changes".
- **Footer:**
  - **Full changelog** opens `CHANGELOG.md` on GitHub.
  - **Got it** closes the window.
- **Behaviour:** Escape and the close button close it too. The body scrolls, and the header and footer stay docked.
- **Markup:** a Mantine `Modal`. The disclosure buttons carry `aria-expanded`.

## 7. Command palette

| Command | When listed | Action |
|---|---|---|
| Restart to update to <v> | state `ready` | `updates.restart()` |
| Check for updates | always. While `off` it is disabled, and the reason shows as its hint. | `updates.check()`, then one toast: "You're up to date", "Found 0.20.0, downloading", "Update ready", or "Couldn't check for updates: …" |
| What's new in <current> | always | opens §6 for the current release |

The hint on Check for updates is "last checked N min ago". Each command is registered once, through the existing global-commands registry.

## 8. IPC (5-file contract)

No payload carries a secret.

| Channel | Kind | In | Out |
|---|---|---|---|
| `updates:getState` | invoke | `{}` | `UpdateState` (now the wider union) |
| `updates:check` | invoke | `{}` | `UpdateState` |
| `updates:restart` | invoke | `{}` | unchanged |
| `app:getInfo` | invoke | `{}` | `{ version: string; platform: string; arch: string }` (`app.getVersion()`, `process.platform`, `process.arch`) |
| `updates:state-event` | push | — | `UpdateState` |

Files: `shared/types.ts`, `shared/ipc.ts`, `electron/preload.ts`, `electron/ipc/handlers/updates.ts` and `electron/ipc/handlers/app.ts` (zod `NoInput`) and `electron/main.ts`. The `ipc-channel-registration` spec gains `updates:check`.

## Acceptance criteria

- `UpdateState` carries every state in §1, and the renderer handles each one.
- A background check that fails changes no visible state and writes one warn log line. A manual check that fails shows `failed` in Settings and as a toast from the palette.
- No check runs while the state is `checking`, `downloading` or `ready`, whether it comes from the timer, Settings or the palette.
- The re-check runs every 4 hours while the app is open, and its timer is cleared on quit.
- The status bar shows the downloading text and the ready pill as in §4. The pill opens a popover, never a restart, and the popover closes on Escape, on an outside click and on Later, without side effects on its ancestors.
- Away from the workspace, the ready toast shows once per version.
- Settings → About and updates shows the version, the status card in every §5.2 state, the Check button, and the Off copy for development and Linux.
- The palette lists the three commands as in §7.
- The What's new window opens exactly once after a version increase, never on a fresh install, never on a downgrade, never over the restored-tabs hint, and never while the palette is open. Escape closes it.
- The window's short view shows bold leads and preambles, and Show details shows full text.
- The release workflow publishes the `CHANGELOG.md` section as the release body and fails a tag that has no section.
- `releaseNotes.ts`, `changelog.ts` and the grown `UpdateService` are in `stryker.config.json`'s `mutate` list at 90% or higher.

## Test cases

**Unit**

- `update-service.spec.ts`, extended with a fake `UpdaterLike`:
  - each event moves the state as in §1;
  - `ready` is sticky;
  - a background error restores the prior state, and a manual error moves to `failed`;
  - re-entrant `check()` calls return the current state without calling `checkForUpdates` again;
  - progress pushes are throttled;
  - the timer is cleared on stop;
  - `off` carries the right reason for linux, unpackaged and override.
- `release-notes.spec.ts`: highlights from a real GitHub release-body HTML fixture, nested tags inside `<strong>`, no list, an empty string, and a 1 MB input that finishes in linear time.
- `changelog.spec.ts`, run against the real `CHANGELOG.md`:
  - 0.20.0 has 8 leads under Changed and 4 under Fixed, plus one leadless item;
  - 0.17.0 keeps its preamble;
  - `[Unreleased]` and anything at or below 0.14.0 are skipped.
- `changelog.property.spec.ts` (fast-check): for any two versions in the file, `releasesBetween` returns exactly the releases with `from < v ≤ to`, newest first. It returns nothing when `from ≥ to`.

**Integration**

- `updates-handlers.spec.ts`: `updates:check` answers with an ok envelope in every state, including `off`. An undefined payload returns a validation envelope.

**Component** (mocked `window.atelier`)

- `update-status-pill.spec.tsx`:
  - nothing is rendered for the quiet states;
  - downloading text;
  - clicking the ready pill opens the popover and does not call `restart`;
  - Restart now calls `restart` once;
  - Escape and outside-click under a parent spy do not bubble;
  - a cancelled restart keeps the pill.
- `settings-about.spec.tsx`: each card state, the disabled button with its reason for each Off reason, and the Check button calling `check` once.
- `whats-new.spec.tsx`:
  - no stored version, then nothing opens and the version is stored;
  - stored 0.19.0 with current 0.20.0, then it opens with two releases, the older one collapsed;
  - opening it stores the version;
  - Show details reveals the leadless item;
  - it waits for the restored-tabs hint;
  - it does not open while the palette is open.
- `update-ready-prompt.spec.tsx`, updated: the toast is shown only off-workspace and only once per version.

**E2E**

- Launching with a fresh userData shows no What's new window. This guards the whole suite.
- A test that seeds `whatsNew.lastSeenVersion` to an older version sees the window and closes it with Escape.

**Manual** (needs two signed releases, as in X20): the pill, the popover, Restart, and the What's new window after the relaunch. Also check that the release body on GitHub is the changelog section.

## Definition of done

All eight gates in `CLAUDE.md` § Definition of done apply. This is code, build config and CI.
