# Specs & docs accuracy audit — 2026-09-15

Point-in-time audit of `specs/`, `docs/`, `docs/adr/`, `CLAUDE.md`, and related
project docs against the current code. Every finding below carries a doc-side
citation and a code-side citation, both independently verified.

**Excluded by design** (not re-litigated below):
- Unbuilt features / unchecked `[ ]` acceptance criteria — that's roadmap, not
  inaccuracy.
- `MongoLab` / `mongolab.db` / `window.mongolab` / `MONGOLAB_USER_DATA_DIR` /
  appId `dev.mongolab.app` — [X09](../specs/X09-namespace-rename.md) defers
  the userData/appId rename to its own Phase 3 ticket; these are deliberate,
  not stale. **Except finding #1 below**, which shows the deferral itself no
  longer holds at runtime.
- "de-scoped to `BACKLOG.md`" phrasing — already documented in CLAUDE.md as
  meaning "filed as a GitHub issue."

---

## Critical — the code already breaks X09's core promise

### 1. `app.setName("L'Atelier")` moves the userData directory today, not in the deferred Phase 3

[X09](../specs/X09-namespace-rename.md) (status: "Phase 1 + Phase 2 applied,
Phase 3 deferred") states as its central safety invariant: **"`appId` remains
`dev.mongolab.app` so existing user data at
`~/Library/Application Support/mongolab/` ... keeps loading."** The spec's
whole phase split exists to protect this — "Changing `appId` orphans every
existing user's settings, secrets, and saved connections." X08 repeats the
same claim: "No data loss, no IPC change, no `userData` path change"
(`specs/X08-brand-identity.md:179`).

That invariant is false as shipped. Electron's `app.getPath('userData')`
defaults from **`app.name`**, not from `appId` — `appId` only affects
electron-builder's packaging/bundle identifier. `electron/main.ts:99` runs
`app.setName("L'Atelier")` unconditionally at module load, before any
`app.getPath('userData')` call (`electron/main.ts:148`), and nothing in the
codebase calls `app.setPath('userData', …)` to pin the directory back to the
old name (verified: no `setPath` call exists anywhere in `electron/main.ts`).
So a normal launch of the current build already resolves `userData` to
`~/Library/Application Support/L'Atelier/` (and platform equivalents) —
**Phase 1's display-string rename silently triggered the exact breaking
change Phase 3 was designed to gate behind a migration.** A real user
upgrading from an old MongoLab-named build today loses access to their
existing connections, secrets, and settings, with no migration path and no
error — the app just opens with a fresh, empty `L'Atelier` userData
directory instead.

This isn't only a doc bug: it's the code contradicting its own governing
spec's safety design. Test coverage doesn't catch it because
`ATELIER_USER_DATA_DIR` overrides `app.getPath('userData')` for every E2E run
(`electron/main.ts:116,148`), so the default-path behavior is never
exercised.

**Downstream effects, also worth flagging:**
- `docs/troubleshooting.md:225-226` tells users to find logs at
  `~/Library/Logs/mongolab/` (macOS) / `%APPDATA%/mongolab/logs/` (Windows).
  Both are wrong. `electron/log.ts:97` builds the log directory as
  `path.join(userDataDir, 'logs')` — under **Application Support**, not
  `Library/Logs` — and (per the bug above) under the folder named
  `L'Atelier`, not `mongolab`. A user following this doc today cannot find
  their log file at either claimed location.
- `docs/mongolab-rename-remaining-2026-09-15.md` (a prior audit in this same
  repo) built its entire "why not now" justification for 10 of its 19 rows on
  the premise that "the OS userData directory... [is] `<appId-derived-name>`"
  and calls the `docs/troubleshooting.md` paths "accurate ... today" (row
  10). Both are the same false premise this finding corrects. That report's
  "Bottom line" reason #1 needs re-derivation once this is fixed — the risk
  it describes ("silent user data loss on upgrade") isn't a future risk
  gated on Phase 3, it's a present one.

**Fix direction** (not prescribing the implementation): either pin
`app.setPath('userData', …)` to the old `mongolab`-named path until Phase 3's
migration ships, or pull Phase 3's migration forward — but the current state,
where Phase 1 already broke the invariant Phase 3 was meant to protect, should
not ship as-is.

---

## High — stale API/contract surfaces that would mislead a dev or agent

### 2. `MongoPool` API renamed; five docs still describe the old shape
`specs/F05-mongo-client-pool.md:53,56,148-154`, `specs/C06-overview-tab.md:21`,
`specs/C07-collections-tab.md:21`, `specs/C09-indexes-tab.md:132,153,167`,
`specs/C10-users-tab.md:161,179,210,220,230` all document `getClient(id)` /
`getDb(id, dbName)`. Neither exists. `electron/mongo/MongoPool.ts:407-426`
replaced them with `readDb()` / `readClient()` / `write(id)` (returning a
`WriteGrant`) as part of the read/write split in
[ADR 0005](../docs/adr/0005-read-only-connection-enforcement.md). None of the
five specs mention the ADR or the rename.

### 3. `specs/W02-db-collection-navigator.md` names IPC channels that were never built under those names
Doc (lines 38, 54, 208, 212, 225, 226, 234-236, 247, 281, 435, 470, 479,
489-492, 507-510) specifies `mongo:dropCollection`, `mongo:dropDatabase`,
`mongo:renameCollection`, `mongo:createCollection`. None exist in
`shared/ipc.ts` or `electron/**`. The shipped names are `collection:create`,
`collection:drop`, `collection:rename`, `database:drop`
(`shared/ipc.ts:137-140`). The doc was written while these were "❌ not
built" (line 38) and never reconciled after they shipped.

### 4. `specs/PLAN-workspace-decomposition.md:464,494` cites a file that doesn't exist
Both lines cite `.claude/ADR.md` (as "ADR-003"/"ADR-004"). No such file exists
anywhere in the repo (`find . -iname ADR.md` returns nothing). The actual
content lives at `docs/adr/0010-collection-tab-state-reducer-scope.md` and
`docs/adr/0011-workspace-jsx-section-split.md`, under a different numbering
scheme entirely.

### 5. `specs/PLAN-workspace.md:361` names the wrong path for `HintsProvider`
Doc says it's mounted "in `src/pages/App.tsx`". No such file exists
(`src/pages/` has no `App.tsx`). The real file is `src/App.tsx:9,46`.

### 6. `specs/F01-architecture.md:174` names an env var that doesn't exist
Doc says the E2E fresh-userData override is `ELECTRON_USER_DATA_DIR`. That
string appears nowhere in the codebase. The actual variable — used
throughout `tests/e2e/*.ts`, `tests/helpers/e2eApp.ts`, `electron/main.ts:116`
— is `ATELIER_USER_DATA_DIR`, which is also what CLAUDE.md's own Testing
section documents. F01 contradicts CLAUDE.md here.

### 7. `docs/agents/triage-labels.md:7-10` documents labels that don't exist in the tracker
Table asserts `needs-triage`, `needs-info`, `ready-for-agent`,
`ready-for-human` exist "in our tracker." `gh label list --repo
anonhym/latelier` returns 12 real labels (`bug`, `documentation`,
`duplicate`, `enhancement`, `good first issue`, `help wanted`, `invalid`,
`question`, `wontfix`, `dependencies`, `github_actions`, `javascript`) — none
of those four. Only `wontfix` (row 5) is real. 4 of 5 documented labels don't
exist.

### 8. `docs/agents/issue-tracker.md:62-63` references labels that don't exist
Instructs `gh issue create --label wayfinder:map` and documents a
`wayfinder:<type>` taxonomy. `gh label list --repo anonhym/latelier --search
wayfinder` returns nothing.

### 9. `docs/agents/issue-tracker.md:23` documents a `gh pr list` invocation that fails
`gh pr list --state open --json number,title,body,labels,author,authorAssociation,comments`,
run verbatim, exits 1: `Unknown JSON field: "authorAssociation"`. That field
is not in `gh pr list`'s valid field set. The doc's contributor-filtering
logic (keep CONTRIBUTOR/FIRST_TIME_CONTRIBUTOR/NONE) can't run as written.

### 10. `CLAUDE.md:131` documents label taxonomy that doesn't exist
"Known gaps... tracked in GitHub Issues, with `priority:P0/P1/P2` and
`effort:S/M/L` labels." `gh label list` shows none of these exist in the
repo. Same root cause as #7/#8 — a documented label taxonomy the tracker was
never actually seeded with.

### 11. `specs/X01-theme-window-state.md:42-49` documents an IPC channel that doesn't exist
Table lists `prefs:watch` (`{ key }` input, event-stream output) as how the
renderer reacts to main-side preference changes. Checked all 90 channel
strings in `shared/ipc.ts` — no `prefs:watch`. The actual mechanism is a
dedicated callback registration, `onThemeChanged`
(`shared/ipc.ts:227`, `electron/preload.ts:117`), not a generic subscription
channel.

### 12. `docs/agents/domain.md:15-24` shows an uncustomized template example
"Single-context repo (this repo):" file tree lists
`docs/adr/0001-event-sourced-orders.md` and
`0002-postgres-for-write-model.md`. Real `docs/adr/` contains
`0001-data-view-home-connection-switcher.md` through
`0011-workspace-jsx-section-split.md` — no filename matches. Reads as an
un-adapted example from the mattpocock-skills plugin template, presented as
describing this repo.

---

## Medium — stale but narrower in blast radius

### 13. `specs/F04-ipc-bridge.md:224` understates the `SECRET_INPUT` allowlist
Doc lists `conn:create, conn:update, conn:test`. `scripts/ipc-secret-allowlist.txt`
actually has five entries — those three plus `user:create`, `user:update` —
both genuinely tagged `SECRET_INPUT` in `electron/ipc/handlers/users.ts:69,73`
and `shared/ipc.ts:394-395`. Stale since C10 added the Users-tab secret
channels.

### 14. `specs/F01-architecture.md:142` lists a nonexistent error class, omits two real ones
Doc's `AppError` subclass list includes `MongoError` (doesn't exist) and
omits `ReadOnlyConnectionError` and `MongoOpError`, both of which do
(`electron/errors.ts:21-79`).

### 15. `specs/C01-connection-model.md` omits the `readOnly` field entirely
Neither the `Connection` type block (lines 25-72) nor `ConnectionSummary`
(89-99) mentions `readOnly: boolean`, present in `shared/types.ts:59,136`
since migration `010-connection-read-only.sql` and enforced per
[ADR 0005](../docs/adr/0005-read-only-connection-enforcement.md). C01 never
mentions read-only connections.

### 16. `specs/C11-troubleshooting.md:62,122` — `ProbeErrorCode` and the docker-tls recipe are both stale
Doc's enum is `AUTH | NETWORK | TIMEOUT | TLS | UNAUTHORIZED | UNKNOWN`.
Actual type (`shared/types.ts:99-111`) also has `TLS_HANDSHAKE`, which is
what `electron/mongo/errors.ts:191-200` actually emits for TLS handshake
failures (checked before TIMEOUT/NETWORK). Consequently the doc's described
match rule for the `docker-tls` recipe (`errorCode === 'TIMEOUT' AND
message matches /.../`) is also stale — the real implementation
(`src/troubleshooting/recipes.ts:51-58`) matches primarily on
`errorCode === 'TLS_HANDSHAKE'`, keeping the old regex only as a documented
backstop.

### 17. `specs/PLAN-foundation.md:19,34-38` contradicts F01 §7 and CLAUDE.md's native-module section
Doc still specifies a `"postinstall": "electron-builder install-app-deps"`
rebuild step and lists Python/make/build-tools as prerequisites for a native
`better-sqlite3` build. `package.json` has no `postinstall`/rebuild script at
all — confirmed removed once `better-sqlite3` became an N-API addon, per
`specs/F01-architecture.md:211` and CLAUDE.md's "Native-module ABI — no
longer a thing" section. PLAN-foundation's own "Status: SHIPPED" banner
doesn't flag this, so it reads as current guidance while contradicting both.

### 18. `specs/W04-query-builder-pane.md` / `specs/W05-query-bar.md` — checked acceptance criteria describe a machine that no longer exists
W04:277,278,280,282,283,284 and W05:136,137,139 are `[x]`-checked items
describing the condition-row / `compileMql` / `parseMqlToBuilder` model and
the SYNCED/DIRTY sync-pill machine, in sections their own files' frozen-scope
banners don't cover (W04 freezes §1-4,7,8, not §9; W05 freezes §1-2, not
§7). Both contradict `specs/W13-filter-tree-editor.md:535` (checked): "No
sync pill, 'Re-sync builder', 'Accept builder', or 'Builder disabled' control
exists anywhere." Code confirms W13: `shared/types.ts:190-208`'s
`BuilderState` comment says `conditions`/`logic` were "retired by W13";
`compileMql`/`parseMqlToBuilder` exist nowhere except as historical comments
in `src/pages/Workspace/legacyBuilder.ts`.

### 19. `specs/W01-workspace-shell.md:38-49` — `CollectionTabState` type block is stale, with no superseded marker
Declares `builder: { conditions, logic, ... }`, optional `queryRaw?`, and
`queryDirty: boolean`. None of these match `shared/types.ts:452-475` (no
`conditions`/`logic`/`queryDirty`; `queryRaw` is required, not optional). Also
declares `WorkspaceTabKind = 'collection' | 'aggregation'` with a top-level
`AggregationTab` — actual code has `WorkspaceTab = CollectionTab | ScriptTab`,
with aggregation as a sub-field (`shared/types.ts:581`, `:448-450`). Unlike
W04/W05 (finding #18), which at least got explicit superseded banners, W01
describes the same retired shape with no acknowledgment at all.

### 20. `specs/W02-db-collection-navigator.md:417,418` — checked-and-wrong context-menu claims
`[x]` items claim Rename/Drop/Create render disabled on right-click.
`src/pages/Workspace/DbCollectionNavigator.tsx:763-810` shows none of
"Rename collection," "Drop collection/view," "Create collection," or "Drop
database" carry a `disabled` property — only "Modify view" does. All four
are fully wired to live modals and IPC channels (see also finding #3).

### 21. `specs/C09-indexes-tab.md` and `specs/W16-structure-view.md` state incompatible architecture without cross-referencing
C09:9 — "Index management is a connection-scoped operation, not a
query-scoped one." W16:145-147, backed by the accepted
[ADR 0003](../docs/adr/0003-collection-scoped-admin-surfaces.md) — "Indexes
are collection-scoped and move [to the Data View]." C09 has no
amendment/supersession marker referencing W16 or the ADR; it still states the
opposite principle as current fact. (W16's actual criteria to retire the
Connection Manager's Indexes tab are unchecked and `IndexesTab` is still
live in code — that retirement is correctly unbuilt roadmap, not part of
this finding. The finding is the two docs' stated design principles being
incompatible with no acknowledgment.)

### 22. `specs/X07-command-palette.md:22` is stale against the shipped Mantine rewrite, with no status marker
Says the palette "uses the existing `Theme` tokens; no separate themeable
surface" — and carries no `Status:` line (X10 and X12 both do). Actual
`src/commands/CommandPalette.tsx:3-7` is built on `@mantine/spotlight`
(`SpotlightRoot`/`SpotlightSearch`/`SpotlightActionsList`/`createSpotlight`),
rewritten under [X12](../specs/X12-mantine-migration.md) Phase 5 ("Status:
Shipped"). X07's prose doesn't describe the shipped component and isn't
flagged as superseded.

---

## Low — index/hygiene gaps

### 23. `specs/README.md`'s Cross-cutting table is missing two shipped specs
`specs/X17-renderer-hardening.md` (status: "Applied" — CSP, sandbox, nav
guard) and `specs/X18-deepening-seams.md` both exist on disk with real
content but aren't listed in the README's spec index table (which stops at
X16).

### 24. `CLAUDE.md:117,140` undercounts the Stryker `mutate` array
CLAUDE.md enumerates 10 modules ("both `ejson.ts` copies, `uri-parse.ts`,
`uri.ts`, `builder.ts`, `filterTree.ts`, `legacyBuilder.ts`,
`displayValue.ts`, `shellSyntax.ts`, `envelope.ts`, `log.ts`").
`stryker.config.json`'s actual array has 16 entries — the doc's list is
missing `deleteMode.ts`, `collectionPatches.ts`, `navigatorTreeReducer.ts`,
`senderGuard.ts`, and `appLocation.ts`.

### 25. `CLAUDE.md:154` contradicts its own CI workflow's timing comment
CLAUDE.md says the "test job" (lint+audit+unit/integration/component) runs
"at the same ~10" minutes as the slowest E2E shard. `.github/workflows/ci.yml:54`'s
own comment says "The job today is ~7m." Same doc section, disagreeing with
the file it describes.

---

## Confirmed still-open (from the prior same-day audit)
`docs/mongolab-rename-remaining-2026-09-15.md` already found and correctly
scoped two small, standalone bugs, re-verified here as still unfixed:
- `docs/field-suggestions-roadmap.md:319-320,431-432` references
  `tests/helpers/mongolabMock.ts` — renamed to `atelierMock.ts` in X09 Phase
  2. Dead path.
- `.claude/skills/new-ipc-channel/SKILL.md:59` says renderer IPC calls go
  through `src/api/mongolab.ts` — renamed to `src/api/atelier.ts` in Phase 2.
  An agent following this skill today would reference a nonexistent file.

---

## Explicitly checked and found accurate (no action needed)
Listed so a future pass doesn't re-spend time here: F02 schema vs
`001-init.sql`, F03 SecretsVault fallback behavior, F04 preload/router/
sender-guard shape, F06 boot/shutdown + dev-reset shortcut, C01-C05/C08 IPC
routes, C09/C10 IPC channel tables, C12 types, `useWorkspaceTabs()` single
call site, W13's supersession banners (accurate for what they cover), ADR
0010/0011 vs the actual reducer/component code, W11/W12 component and IPC
names, ADR 0003 vs W16 (agree with each other), ADR 0005 vs X16 (agree),
X10 vs X12 theming (X12 explicitly supersedes X10, acknowledged), X13 audit
log (internally consistent, correctly unbuilt), all `specs/A*` acceptance
criteria (correctly unchecked/roadmap), no dead relative Markdown links
anywhere in `specs/`, `docs/`, `docs/adr/`, or root `*.md`, package.json /
scripts/ / migrations / hooks all matching CLAUDE.md's structural claims,
`docs/troubleshooting.md`'s `NODE_MODULE_VERSION` section matching CLAUDE.md.

---

## Suggested priority
1. Fix or explicitly re-scope finding #1 (userData path) — this is a shipped
   data-loss bug wearing a documentation-audit disguise, not just a stale doc.
2. Findings #2-#12 (High) are the ones most likely to send a future
   contributor or agent down a dead path — worth a documentation pass soon.
3. Everything else can ride along with normal spec maintenance.
