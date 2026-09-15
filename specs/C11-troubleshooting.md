# C11 — Connection troubleshooting drawer + inline explainers + docs

## Purpose

Turn connection failures from a dead-end ("Connection failed.") into a guided
recovery path. Three coordinated changes share a single source of truth:

1. **Help drawer** keyed by `errorCode` — slides out from the failure pill on
   `NewConnection` and from the error state on the workspace `DetailPanel`,
   with a recipe per error class lifted verbatim from real incidents.
2. **Inline explainers** — short copy under the TLS toggle and the
   "Direct connection" toggle so the most common gotchas are visible
   *before* a user tries Connect for the first time.
3. **`docs/troubleshooting.md`** — a checked-in guide that mirrors the
   drawer's taxonomy. Linked from the drawer's footer; usable by anyone
   who wants the full picture without opening the app.

The same recipe content appears in all three places. No drift.

## Scope

- **In**: `<TroubleshootingDrawer>` mounted globally, `useTroubleshooting`
  hook for opening it from anywhere, the recipe registry
  (`src/troubleshooting/recipes.ts`), inline explainers under the two
  toggles, `docs/troubleshooting.md` plus a build-time check that the
  doc and the registry stay aligned, and the `app:openExternal` hand-off
  for "View on GitHub".
- **Out** (deferred):
  - **Smarter defaults / auto-remediation** (BACKLOG P1, M) — one-click
    "Retry with Direct connection" / "Retry without TLS" buttons. The
    drawer surfaces *advice* in v1; the buttons need an extension to
    `ProbeResult` (capture the server's `hello`) and a probe-replay
    pathway. Tracked as the natural follow-up; this spec deliberately
    leaves a hook (`recipe.suggestedAction`) the buttons can plug into
    later.
  - **Improve main-process logging** (BACKLOG P1, M) — splitting
    `TLS_HANDSHAKE` from `TIMEOUT`, capturing inbound driver events,
    "share diagnostic bundle" action. None of that is needed for the
    user-facing drawer copy.
  - **Replica-set host list modeling** (BACKLOG P2, L), **SSH tunnel
    support** (P2, L) — orthogonal connection-form features.

## Dependencies

- C03 (`NewConnection` page — the Test pill lives here), C06 / DetailPanel
  (the error state on a connected tab), C04 (`ProbeResult` / `errorCode`),
  C08 (`app:openExternal` for the GitHub roadmap link).
- F04 (IPC bridge) — only indirectly. The drawer is renderer-only state;
  no new channels.
- X07 (command palette) — surface a `troubleshooting.open` command so
  users can reach the drawer when there is no failure to dismiss
  (e.g., "I want to read the recipes").

## See also

- **Closes the long-standing "P1 — Help drawer for connection
  troubleshooting", "P1 — TLS tab should explain when the server
  doesn't need TLS", "P1 — Advanced tab 'Direct connection' explainer",
  and "P1 — `docs/troubleshooting.md`".
- **electron/mongo/errors.ts** — the existing `classifyMongoError`
  classifier already produces the `ProbeErrorCode` enum the drawer
  keys on (`AUTH | NETWORK | TIMEOUT | TLS | UNAUTHORIZED | UNKNOWN`).

## 1. Recipe registry

```ts
// src/troubleshooting/recipes.ts (renderer-only, runtime-free)

import type { ProbeErrorCode } from '@shared/types';

export interface RecipeStep {
  /** One-line action verb, e.g. "Toggle TLS off (TLS tab)." */
  title: string;
  /** Markdown body. Single paragraph; rendered with our existing
   *  inline-markdown helpers (bold, code, links). */
  body: string;
  /**
   * Optional hook for the future auto-remediation buttons (BACKLOG P1).
   * Strings are intentionally untyped here; the v1 drawer ignores them.
   * Examples we expect later: 'retryWithoutTls', 'retryDirectConnection'.
   */
  suggestedAction?: string;
}

export interface Recipe {
  /** Stable id used by the docs build check and by tests. */
  id: string;
  /**
   * Match function. Receives the same payload the failure pill saw —
   * `errorCode` plus the raw message. Returning `true` means the recipe
   * is offered for this failure. The first match wins; recipes are
   * declared in priority order.
   */
  match: (input: { errorCode?: ProbeErrorCode; message?: string }) => boolean;
  /** Heading shown at the top of the drawer. */
  title: string;
  /** One-paragraph diagnosis the user reads first. */
  diagnosis: string;
  steps: RecipeStep[];
  /** Anchor in `docs/troubleshooting.md`, e.g. `'docker-tls'`. */
  docAnchor: string;
}

export const RECIPES: Recipe[];

/** Public lookup — picks the first matching recipe, or a generic fallback. */
export function pickRecipe(input: {
  errorCode?: ProbeErrorCode;
  message?: string;
}): Recipe;
```

The registry lives in renderer code because the recipe content is
inherently UI copy. Putting it in `shared/` would needlessly load the
strings into main; main never renders them.

### v1 recipe set

| id                | match                                                                                            |
| ----------------- | ------------------------------------------------------------------------------------------------ |
| `auth-default`    | `errorCode === 'AUTH'`                                                                           |
| `docker-tls`      | `errorCode === 'TIMEOUT'` AND message matches `/ECONNRESET|TLS handshake|secure TLS connection/i` |
| `replica-host`    | `errorCode === 'TIMEOUT'` AND message matches `/getaddrinfo ENOTFOUND|EAI_AGAIN/i`                |
| `network-default` | `errorCode === 'NETWORK'`                                                                        |
| `tls-default`     | `errorCode === 'TLS'`                                                                            |
| `unauthorized`    | `errorCode === 'UNAUTHORIZED'`                                                                   |
| `unknown`         | fallback (always matches if nothing above did)                                                   |

The four BACKLOG-mandated recipes (`auth-default`, `docker-tls`,
`replica-host`, `unauthorized`) are reproduced verbatim from the
incident table from the original "P1 — Help drawer" item. `network-default`,
`tls-default`, and `unknown` are the long-tail catchers.

### Example recipe

```ts
{
  id: 'docker-tls',
  match: ({ errorCode, message }) =>
    errorCode === 'TIMEOUT' &&
    !!message &&
    /ECONNRESET|TLS handshake|secure TLS connection/i.test(message),
  title: 'Server doesn\'t speak TLS on this port',
  diagnosis:
    'TLS is on in the form, but the server replied with a network reset ' +
    'before the handshake completed. This almost always means the server ' +
    'isn\'t listening for TLS — common with Docker dev MongoDB.',
  steps: [
    {
      title: 'Toggle TLS off',
      body: 'Open the **TLS** tab and uncheck *Enable TLS / SSL*, then **Test** again.',
      suggestedAction: 'retryWithoutTls',
    },
    {
      title: 'If you need TLS',
      body: 'Verify the server is started with `--tlsMode requireTLS` and the same ' +
            'CA you\'re providing on the **TLS** tab.',
    },
  ],
  docAnchor: 'docker-tls',
}
```

## 2. Drawer component

```tsx
// src/troubleshooting/TroubleshootingDrawer.tsx
```

Renderer-only. Mounted once in `App.tsx` next to `<CommandPalette>`.

### State

```ts
type DrawerState =
  | { open: false }
  | {
      open: true;
      input: { errorCode?: ProbeErrorCode; message?: string };
      // Captured at open time so the drawer can return focus on close.
      previousFocus: HTMLElement | null;
    };
```

### Public hook

```ts
export function useTroubleshooting(): {
  open: (input: { errorCode?: ProbeErrorCode; message?: string }) => void;
  close: () => void;
  isOpen: boolean;
};
```

Implemented over a tiny renderer-side context (`<TroubleshootingProvider>`
mounted in `App.tsx`). No new IPC.

### Layout

```
┌─ Drawer (right slide-out, 480 px, full height) ───────────────────┐
│  ← Connection troubleshooting                              [×]    │
├───────────────────────────────────────────────────────────────────┤
│  Server doesn't speak TLS on this port                            │
│                                                                   │
│  TLS is on in the form, but the server replied with a network     │
│  reset before the handshake completed. This almost always means…  │
│                                                                   │
│  Try these in order                                               │
│  ─────────────────────────────────────────────────────────────── │
│  1. Toggle TLS off                                                 │
│     Open the **TLS** tab and uncheck *Enable TLS / SSL*, then …   │
│                                                                   │
│  2. If you need TLS                                                │
│     Verify the server is started with `--tlsMode requireTLS` …    │
│                                                                   │
│  ─────────────────────────────────────────────────────────────── │
│  Still stuck? Read the full guide on GitHub or in docs/.          │
│  [ Open docs/troubleshooting.md#docker-tls ]                       │
└───────────────────────────────────────────────────────────────────┘
```

- **Backdrop**: `rgba(0,0,0,0.45)`. Click to close. Matches the
  `<CommandPalette>` modal style.
- **Width**: 480 px. Fits side-by-side with the NewConnection form on a
  1280-wide window.
- **Keyboard**: `Esc` closes. `Tab` cycles inside the drawer (focus
  trap); restore focus to the originating element on close.
- **a11y**: `role="dialog"` `aria-modal="true"` `aria-labelledby` on the
  recipe title.
- **Markdown**: re-use the renderer that already powers the X04
  operator-doc panel (`src/features/fieldSuggestions/OperatorDocPanel`);
  it handles bold, italic, inline code, and links. No new dependency.

### "Open docs" CTA

The footer button calls
`api.app.openExternal('https://github.com/.../docs/troubleshooting.md#${docAnchor}')`.
The URL is a constant in `src/troubleshooting/repoUrl.ts`. The existing
`app:openExternal` channel already restricts to `https://`. No change to
the secret-allowlist or audit:ipc.

If `docAnchor` is missing (defensive), the button degrades to opening the
top of the doc.

## 3. Trigger sites

### NewConnection (C03)

The existing failure pill is rendered by `<TestStatus state="fail" .../>`
in `ConnectionForm.tsx`. Below the pill text, when `state === 'fail'`,
add a single-button row:

```tsx
{state === 'fail' && (
  <button onClick={() => help.open({ errorCode: lastResult.errorCode, message: lastResult.errorMessage })}>
    Help me fix this →
  </button>
)}
```

Plumbed via the `useTroubleshooting()` hook. Test fixtures: see §8.

### DetailPanel (C06)

The error state already renders `Connection error: …` with a Retry
button. Add a sibling "Help me fix this" link styled to match.
Recipe key comes from `runtime.errorCode` + `runtime.errorMessage`.
(Fall back to `unknown` if the runtime error is just `'unknown'`.)

### Command palette (X07)

Register one command:

```ts
{
  id: 'troubleshooting.open',
  title: 'Open connection troubleshooting',
  group: 'general',
  perform: () => help.open({ errorCode: undefined, message: undefined }),
}
```

When opened with no input, the drawer renders the **`unknown`** recipe,
which lists every common failure class with one-line summaries and a
"Open the full guide" CTA. This satisfies "I want to browse the
recipes" without polluting the failure-only flow.

## 4. Inline explainers (BACKLOG items 1 + 2)

Both ride along on this spec because the copy comes from the same recipe
set; the explainer is just the diagnosis line surfaced earlier.

### TLS tab

`src/features/connections/ConnectionForm.tsx` `TLSTab`. Add directly under the
"Enable TLS / SSL" toggle, regardless of toggle state:

```
Atlas and most managed MongoDB clusters require TLS. Self-hosted and
dev MongoDB often run without TLS — if you see "Client network socket
disconnected before secure TLS connection was established", turn this
off.
```

Styled like the existing helper text in the SSH tab
(`fontSize: 11, color: T.textGhost`).

### Advanced tab — Direct connection

`AdvancedTab`. Under the "Direct connection" toggle:

```
Bypass replica-set discovery. Useful when a replica set's internal
hostnames (often Docker container hashes) aren't DNS-resolvable from
this machine.
```

### Constants live in the recipe registry

To keep one source of truth, both blurbs are exported from
`src/troubleshooting/recipes.ts`:

```ts
export const TLS_INLINE_EXPLAINER: string;
export const DIRECT_CONNECTION_INLINE_EXPLAINER: string;
```

The TLS blurb is identical to `recipe('docker-tls').diagnosis`'s
user-facing summary; the direct-connection blurb is identical to
`recipe('replica-host').diagnosis`'s. A unit test (§8) asserts the
strings are wired through and not duplicated by hand.

## 5. `docs/troubleshooting.md`

A new, checked-in guide. Each section corresponds to one recipe id.
The file's top reads:

```markdown
# Connection troubleshooting

This guide expands the in-app **Help me fix this** drawer with full
recipes and links. Each section's anchor matches the recipe id it
mirrors.

> If you're reading this from the app, the drawer auto-scrolled to the
> right section. Use your browser's **Find** to jump to a different one.
```

Then one `## <docAnchor>` heading per recipe, in the same order as the
registry. Each section repeats the recipe's `diagnosis` paragraph,
its `steps`, and adds a "When to suspect this" bullet list and a
"Confirmed fix" checklist.

### Build-time alignment check

A new test, `tests/unit/troubleshooting-doc.spec.ts`:

```ts
it('every recipe has a matching anchor in docs/troubleshooting.md', () => {
  const md = fs.readFileSync('docs/troubleshooting.md', 'utf8');
  for (const r of RECIPES) {
    expect(md).toMatch(new RegExp(`^## ${r.docAnchor}\\b`, 'm'));
  }
});

it('every doc anchor maps back to a recipe id', () => {
  const md = fs.readFileSync('docs/troubleshooting.md', 'utf8');
  const anchors = [...md.matchAll(/^## ([a-z0-9-]+)/gm)].map((m) => m[1]);
  for (const a of anchors) {
    expect(RECIPES.some((r) => r.docAnchor === a)).toBe(true);
  }
});
```

This catches the two drift modes (recipe added without doc, doc section
added without recipe). Cheap; runs on every CI invocation of the unit
project.

## 6. Behavior rules

- **One drawer at a time.** Opening with the drawer already open replaces
  its input — does not stack.
- **Drawer stays open while the user fixes things.** The user can flip
  toggles in the form behind the drawer and Test again; the drawer
  doesn't auto-close on each Test. It closes only on `Esc`, the `×`
  button, or backdrop click.
- **Every IPC failure surfaces a `Help me fix this` link.** If
  `errorCode` is missing (older code path), the recipe registry returns
  the `unknown` recipe rather than swallowing the click.
- **Recipe copy never includes log lines or stack traces.** The drawer
  is for users; logs go to `userData/logs/mongolab.<date>.log` (F06).

## 7. Persistence

None for v1. No new `app_state` keys, no migrations. The drawer is
session-state-only; users will reopen it with the same content on the
next failure anyway.

If we later want a "Don't show this again for AUTH errors" toggle, an
`app_state['ui.troubleshooting.suppressed']: ProbeErrorCode[]` would
slot in cleanly, but the failure rate doesn't justify the friction.

## 8. Acceptance criteria

- [ ] On `NewConnection`, a failed Test renders a `Help me fix this →`
      button next to the failure pill; clicking opens the drawer with
      the matching recipe.
- [ ] On `DetailPanel`, the connection-error state renders a `Help me
      fix this` link next to the existing Retry button; clicking opens
      the drawer with the matching recipe.
- [ ] An `AUTH` failure with no specific message picks the
      `auth-default` recipe.
- [ ] A `TIMEOUT` failure whose message contains
      `ECONNRESET` picks `docker-tls` (not `replica-host` or the
      generic `unknown`).
- [ ] A `TIMEOUT` failure whose message contains
      `getaddrinfo ENOTFOUND` picks `replica-host`.
- [ ] A failure with no `errorCode` at all picks `unknown` and the
      drawer still renders cleanly.
- [ ] The drawer's "Open docs" footer button calls
      `api.app.openExternal` with an `https://github.com/...` URL ending
      in `#${recipe.docAnchor}`.
- [ ] `Esc` closes the drawer and restores focus to the trigger button.
- [ ] The drawer is reachable from the command palette via
      `Open connection troubleshooting`, even with no failure visible
      (renders the `unknown` recipe).
- [ ] The TLS tab renders the inline explainer regardless of toggle
      state; the Advanced tab renders the Direct-connection explainer
      regardless of toggle state.
- [ ] `docs/troubleshooting.md` exists, contains an `## <id>` heading
      for every registry entry, and the build-time alignment unit
      test passes.

## 9. Test cases

### Unit

- **recipe-pick.spec.ts** — Fixture inputs from real driver errors map
  to the right recipe id. Covers all six BACKLOG-listed scenarios plus
  the fallback. (No fuzz; small, hand-curated table.)
- **troubleshooting-doc.spec.ts** — Both drift checks from §5.
- **inline-explainer-source.spec.ts** — Asserts the TLS / direct
  connection blurbs in `ConnectionForm.tsx` are imported from
  `recipes.ts`, not duplicated.

### Component

- **drawer-shell.spec.tsx** — Open / close via `×`, `Esc`,
  backdrop click. Focus restored.
- **drawer-recipe-render.spec.tsx** — For each recipe id, the title /
  diagnosis / step titles render. Markdown anchors render as
  links; clicking the docs button calls `api.app.openExternal`.
- **drawer-from-test-fail.spec.tsx** — On NewConnection, a
  `state="fail"` pill with `errorCode: 'AUTH'` shows the help button;
  clicking opens the drawer with the `auth-default` recipe.
- **drawer-from-detailpanel.spec.tsx** — Connection error state shows
  the help link; click → drawer with the matching recipe.
- **drawer-from-palette.spec.tsx** — Palette command opens the drawer
  on the `unknown` recipe.
- **tls-explainer-render.spec.tsx** — TLS tab shows the explainer
  string under the toggle, both when `tlsEnabled` is true and false.
- **direct-connection-explainer-render.spec.tsx** — Advanced tab shows
  the explainer under the toggle.

### E2E

- **troubleshooting-end-to-end.e2e.ts** — On a fresh launch, fill the
  NewConnection form pointing at a port with no listener, click Test,
  see the help link, click it, drawer renders, Esc closes. (No
  Mongo memory server needed — the failure path is exercised by an
  unreachable host.)

## 10. Implementation order

Three commits, each independently mergeable:

1. **Registry + drawer + palette command, no triggers.**
   - New: `src/troubleshooting/{types.ts, recipes.ts, repoUrl.ts,
     TroubleshootingDrawer.tsx, TroubleshootingProvider.tsx,
     useTroubleshooting.ts}`.
   - Mount provider + drawer in `App.tsx` at the same level as
     `<CommandPalette>`.
   - Register the `troubleshooting.open` palette command.
   - Tests: recipe-pick, drawer-shell, drawer-recipe-render,
     drawer-from-palette.
2. **Triggers + inline explainers.**
   - `ConnectionForm.tsx`: help button next to the failure pill,
     TLS-tab explainer, Advanced-tab Direct-connection explainer
     — strings imported from `recipes.ts`.
   - `DetailPanel.tsx`: help link next to the Retry button.
   - Tests: drawer-from-test-fail, drawer-from-detailpanel,
     tls-explainer-render, direct-connection-explainer-render,
     inline-explainer-source.
3. **Docs file + alignment check.**
   - New: `docs/troubleshooting.md` with one section per recipe.
   - New unit test: troubleshooting-doc.
   - Update `README.md` to link the new doc from its existing
     "Troubleshooting" / "FAQ" pointers, if present; add one if not.
   - E2E: troubleshooting-end-to-end.

## 11. Risks and mitigations

- **Recipe copy drifts from reality.** The two drift modes (recipe
  outdated, doc outdated) are caught by the unit test in §5. Recipes
  changing because the underlying error message format changes is the
  remaining risk; mitigated by the message regexes being deliberately
  permissive (any of three substrings, case-insensitive).
- **Markdown injection.** The recipe bodies are static literals
  authored in this repo; we never render user-supplied markdown.
  Re-use the X04 renderer rather than introducing a new one (which
  would inherit a fresh attack surface).
- **Drawer covers the form.** On a 1280-wide window, 480 px of drawer
  leaves ~800 px for the form, which is enough to read the active tab.
  On narrower windows the user can drag the window wider, or close the
  drawer between attempts. We deliberately don't push the form aside
  with `width: calc(100% - 480px)` because every Test cycle would
  re-flow the form and reset focus.
- **Future auto-remediation buttons.** `recipe.suggestedAction` is the
  hook for them. v1 ignores the field; the BACKLOG follow-up reads it
  and renders a button row above each step. No churn to the recipe
  shape between v1 and v2.
- **Escape hatch when the recipe is wrong.** Every drawer instance has
  the "Open the full guide" CTA at the bottom. If the matched recipe
  is misleading, the user is one click away from the canonical doc.
