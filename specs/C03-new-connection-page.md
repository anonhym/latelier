# C03 — NewConnection page UI

> **Status: Accepted.** §1–§12 shipped. §13 is agreed and not built yet: a welcome canvas that connects from a pasted URI, a connection string field at the top of the form, a Standard / localhost default, and Save & connect.

> **Note:** The form body described below now lives in the host-agnostic
> `src/features/connections/ConnectionForm.tsx` (extracted from
> `NewConnection.tsx`, see ADR 0001) so it can be reused outside the
> page route — `NewConnection.tsx` is now a thin route host that renders it.
> The state shape, tabs, and behavior below are unchanged by that extraction.

## Purpose

A single page that lets the user create or edit a connection. It covers the form already visible in `src/pages/NewConnection.tsx`, wires it to real IPC, handles URI paste, drives the Test action, and commits via `conn:create` / `conn:update`.

## Scope

- **In**: route, local state shape, all five tabs (General, Auth, TLS, SSH, Advanced), Save, Cancel, Test binding to C04, URI paste, edit-mode loading, error banner.
- **Out**: The actual Test connection probe (C04), CmdK (C08 stub), the Stub SSH fields only — SSH is deferred (F04 doesn't take SSH plaintext to Mongo; the form still collects it for future use, but `ssh.enabled` cannot be saved as `true` in iteration 1).

## Dependencies

- C01 (types), C02 (`conn:*` channels), C04 (`conn:test` channel, may be inlined from F05's `mongo:probe`).

## 1. Route

- Path: `/connections/new` (create) and `/connections/:id/edit` (edit). Replace current `/new-connection`.
- Top-level page component: `NewConnection` (rename existing file or keep; internal refactor).
- Navigation: arriving via the list sidebar's `+` button (C05) or the detail panel's Edit button (C08).

## 2. State

```ts
type Mode = 'create' | 'edit';
type TestState = 'idle' | 'testing' | 'ok' | 'fail';
type BannerState = { kind: 'info'|'error'; text: string } | null;

const [mode, setMode] = useState<Mode>(params.id ? 'edit' : 'create');
const [tab, setTab]   = useState<NCTab>('General');
const [form, setForm] = useState<ConnectionInput>(INITIAL);   // seeded from get() in edit mode
const [dirty, setDirty] = useState(false);
const [saving, setSaving] = useState(false);
const [testState, setTestState] = useState<TestState>('idle');
const [testError, setTestError] = useState<string | null>(null);
const [banner, setBanner] = useState<BannerState>(null);
const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
```

On mount in edit mode: `api.conn.get(id)` → populate form. Password, SSH password, SSH passphrase are **blank** (we never retrieve plaintext); their inputs show a "Stored — enter new value to replace" placeholder derived from `form.hasPasswordStored`.

`dirty` flips when any field changes; prompts a confirmation on navigate-away.

## 3. Layout (matches existing mock, wired up)

```
┌──────────────────────────────────────────────────────────────────┐
│  Title bar  [< Connections] / New Connection          [🌙/☀]   │
├──────────────────────────────────────────────────────────────────┤
│  Centered card (max 740px)                                       │
│    Tab bar: General · Auth · TLS · SSH · Advanced                │
│    ─────────────────────────────────────────────                 │
│    Tab content (see §4)                                          │
│    ─────────────────────────────────────────────                 │
│  Footer: [TestStatus]                [Cancel] [Test] [Save]      │
├──────────────────────────────────────────────────────────────────┤
│  Banner (error)                                                  │
└──────────────────────────────────────────────────────────────────┘
```

## 4. Tabs (detailed)

### General
- **Name** (required) — text input. Error if blank on Save.
- **Color** — 6 presets from `COLORS`. Click selects.
- **Paste URI** toggle — reveals a single textarea. On blur or ⌘↵, call `api.conn.parseUri(uri)` → merge result into `form` (preserving `name`, `color`); show a toast listing any dropped params. Any parse error becomes a banner.
- **Hostname** / **Port** — or, if SRV type, only **Hostname** (port grays out with tooltip "SRV discovers port via DNS").
- **Default database** — optional.
- **Connection type** — `srv` / `standard`. Switching away from SRV re-enables port.

### Auth
- **Authentication mechanism** — SCRAM-256 / SCRAM-1 / X.509 / AWS IAM / None. Layout adapts per mechanism (matches existing mock).
- **Username + Auth database + Password** block shown for SCRAM.
- **AWS Access Key ID + Secret** block for AWS IAM.
- **X.509** block explains "Configured via TLS client certificate — see TLS tab" and jump-link.
- Password input:
  - In **create** mode: plain password field with show/hide toggle. Empty allowed only for `none` mech.
  - In **edit** mode when `form.hasPasswordStored`: shows placeholder "••••• (stored). Enter new value to replace" plus a "Remove stored password" secondary button that sets a `clearPassword: true` flag.

### TLS
- **Enable TLS/SSL** toggle.
- If enabled: **CA certificate path**, **Client certificate path**, **Verify server certificate** toggle.
- Auto-enables when connection type is SRV and cannot be disabled (helper text explains: "SRV URIs always use TLS").
- File picker: each path field has a ⋯ button opening `dialog.showOpenDialog` via a new `app:pickFile` IPC that returns a path or `null`.

### SSH (deferred — form collects but warns)
- Toggle labeled **"SSH tunnel (coming soon)"** — disabled with tooltip "Saving a connection with SSH enabled is not supported in this iteration."
- All sub-fields preserved in state so a future iteration can enable them without re-designing.

### Advanced
- **Connect timeout / Socket timeout / Server selection timeout (ms)**.
- **Read preference** select.
- **Max pool size** numeric.
- **Direct connection** toggle.
- **App name** — defaults to blank; reasonable for identifying the client in Mongo server logs.

## 5. Test connection

Clicking **Test connection**:
1. Run client-side validation (see §7). If fail, highlight fields, do NOT call server.
2. `setTestState('testing'); setTestError(null);`
3. `const result = await api.conn.test(form)` — C04 + F05 `probe`.
4. On `{ ok: true }`: `setTestState('ok')` and auto-hide after 6s.
5. On failure: `setTestState('fail'); setTestError(result.errorMessage ?? mapCodeToText(result.errorCode))`.
6. Test does **not** dirty the form or persist anything.

## 6. Save

1. Client-side validation; if fail, stay.
2. `setSaving(true)`.
3. Create mode: `created = await api.conn.create(form)`; Edit mode: `await api.conn.update(id, diff)`.
4. On success: `navigate('/connections', { state: { justCreatedId: created.id } })` so the list can highlight it.
5. On `VALIDATION`: map `error.details` path → `fieldErrors[path] = message`; jump tab to first error.
6. On `CONFLICT` (duplicate name): banner "A connection named '…' already exists."
7. On `SECRETS_UNAVAILABLE`: banner explaining keychain is unavailable, with a "Save without password" variant that sends `password: ''` if the mechanism permits.
8. `setSaving(false)` in `finally`.

## 7. Client-side validation

Mirrors C01 Zod rules in pure TS so errors appear without a round-trip. Function returns `{ ok: true } | { ok: false; errors: Record<string, string> }`. Same invariants:
- Name non-empty.
- Port 1–65535 (unless SRV).
- SCRAM requires username + password (in create mode) or stored password (in edit mode, unless the user is clearing it).
- Timeouts ≥ 1000.
- `maxPoolSize` 1–500.
- Paths absolute if provided.

## 8. Keyboard & accessibility

- `Tab`/`Shift+Tab` cycle fields.
- `⌘↵` triggers **Test**; `⌘S` triggers **Save**; `Esc` triggers **Cancel** (with dirty guard).
- Each input has an associated `<label>` via `htmlFor`. The existing `<Label>` component wraps labels; extend it to set `id` + `htmlFor`.
- Banner uses `role="alert"`.
- Error text is `aria-live="polite"` and associated with the input via `aria-describedby`.

## 9. Edit-mode secret UI rules

Recap (from §4 Auth):
- If `hasPasswordStored` and the user types into the password field: treat as a new plaintext, which will replace the stored one via `vault.set` server-side.
- If `hasPasswordStored` and the user clicks **Remove stored password**: flip `clearPassword: true` in update payload, empty the input, show "Will be removed on save" hint.
- If not stored and the user leaves empty with a mechanism that requires it: validation fails.

## 10. Banner messages

| Condition                                           | Text |
| --------------------------------------------------- | ---- |
| `conn:parseUri` failed                              | "Could not parse that URI: {message}. Check the scheme and try again." |
| `conn:create` returned VALIDATION                   | (no banner — inline errors) |
| `conn:create` returned CONFLICT                     | "A connection named '{name}' already exists." |
| `SECRETS_UNAVAILABLE`                               | "Your OS keychain is unavailable. Save an X.509 or keyless connection, or fix the keychain." |
| `conn:test` → AUTH                                  | "Authentication failed — check username, password, and auth database." |
| `conn:test` → NETWORK                               | "Could not reach the server. Check host, port, and firewall." |
| `conn:test` → TIMEOUT                               | "Connection timed out. Check host reachability or raise the timeout." |
| `conn:test` → TLS                                   | "TLS handshake failed. Verify certificates and server TLS support." |

## 11. Acceptance criteria

- Fresh form renders with `INITIAL` state; Save is enabled only when required fields present.
- Pasting a valid URI fills all applicable fields.
- Test button works without persisting.
- Create round-trip: save → navigate to list → new connection appears.
- Edit mode: loads existing values; password placeholder indicates "stored"; editing and saving updates vault.
- Removing a stored password via the explicit button clears it server-side.
- Validation errors highlight offending fields and jump to the right tab.
- `⌘S` saves; `⌘↵` tests; `Esc` asks to discard changes if dirty.
- Leaving the full-page form with unsaved changes through an in-app navigation shows a "Discard changes?" confirmation: the back link, Cancel, the command palette or a shortcut. The app runs on a data router (`createHashRouter` + `RouterProvider`) so `useBlocker` can intercept every router navigation; the blocker lets a navigation through when the form is clean, when only the search or state changes, and right after a successful save. Keep editing stays on the form with what was typed; Discard continues the navigation. Closing the window and quitting are not router navigations: the form reports its dirty state to main instead (`app:setUnsavedWork`), and the quit question names it (F06 §4, "Quit with running or unsaved work"). Closing the window is guarded off macOS only, where it quits the app; on macOS it does not, and the report is dropped with the window. Reloading is not guarded.

## 12. Test cases

### Component (Vitest + RTL + mocked `window.atelier`)
- **initial-render.spec.tsx**: renders with General tab active, all required fields empty.
- **field-edit-dirties.spec.tsx**: typing in Name sets `dirty=true`; navigating away triggers confirm.
- **paste-uri.spec.tsx**: pasting `mongodb+srv://u:p@c/mydb` fills host, defaultDb, authUsername, etc.; toast lists dropped params.
- **validation-scram-missing-password.spec.tsx**: attempt Save without password on SCRAM → inline error under Password, tab auto-switches to Auth.
- **save-success.spec.tsx**: mock `api.conn.create` → resolves → expect `useNavigate` called with `/connections` and `state.justCreatedId`.
- **save-conflict.spec.tsx**: mock returns CONFLICT → banner text matches.
- **secrets-unavailable.spec.tsx**: mock returns `SECRETS_UNAVAILABLE` → banner offers "save without password" when mechanism is `none`/`x509`.
- **edit-mode-load.spec.tsx**: mock `api.conn.get` returns a connection with `hasPasswordStored: true` → password input shows stored placeholder; Save without editing password sends an update without plaintext.
- **remove-stored-password.spec.tsx**: click "Remove stored password" → update payload carries `clearPassword: true`.
- **new-connection.spec.tsx (unsaved-changes guard)**: with the Name edited, the back link and Cancel raise the confirmation and the route does not change; Keep editing keeps the typed value; Discard navigates away; a clean form and a successful save navigate with no prompt; a programmatic navigation (as the palette does) is blocked while the form is dirty.

### E2E (Playwright + Electron + memory Mongo)
- **create-test-save.e2e.ts**: click **+** on list → fill form against a known mongodb-memory-server → Test shows ok → Save → landed on list with new connection highlighted.

## 13. Amendment — connect from a URI, and a shorter path through the form

> **Accepted, not built.** The form is still the modal over the Data View ([ADR 0001](../docs/adr/0001-data-view-home-connection-switcher.md)); the model, the parser and the channels (C01, C02, C04) are unchanged. No new IPC channel.

### 13.1 Welcome canvas

With **no saved Connection**, the Data View shows a welcome canvas instead of an empty workbench. The first run used to draw the full chrome around nothing: a live filter box over an empty navigator, an enabled script button, a disabled shell button.

- No tab strip, no navigator, no status bar. The title bar keeps the search field and Settings.
- A centred 560px column: the wordmark (32px high); the headline `Connect to MongoDB`; a **URI field** (560×40, monospace, placeholder `mongodb://localhost:27017  or  mongodb+srv://…`) with a filled **Connect** button attached at its right; under it three quiet links, `Enter details manually` · `Import from Compass or a file` · `Paste several URIs`; and, while the system keychain is available, one muted line: `Passwords are encrypted with your system keychain and never leave this machine.`
- **Connect** (the button, or Enter in the field):
  1. parses the URI (`conn:parseUri`); a URI that does not parse shows the parser's reason under the field;
  2. tests it (`conn:test`); a failure shows the reason under the field with `Troubleshoot`, which opens the troubleshooting drawer ([C11](./C11-troubleshooting.md)). Nothing is saved;
  3. on success saves it (`conn:create`), named after its first host (`localhost`, `cluster0.example.net`), with ` 2`, ` 3` appended when that name is taken, then connects. The Data View opens on the connected, no-tab canvas ([W01 §14.7](./W01-workspace-shell.md)). The name can be changed later in the form.
- **The URI field is a secret input.** A URI can carry a password, so its text lives only in the field's own component state. It is never written to a preference, a tab's state, the palette's history or the renderer log, and no message shown or logged echoes it: an error under the field is the parser's or the probe's reason, with any credentials removed. The field is emptied once the Connection is saved. It reaches the main process only through channels already tagged and allow-listed for plaintext secrets (`conn:parseUri`, `conn:test`, `conn:create`). `autoComplete="off"`, no spell-check.
- The three links open what they name: the form (§13.2), the Import Wizard on a file ([C14](./C14-import-wizard.md)), the Import Wizard on pasted URIs.

### 13.2 The form

- **Connection string on top.** A full-width field labelled `Connection string`, with the helper `Paste a URI to fill the form`, is always visible above the tabs. It replaces the 12px `Paste URI ›` link that hid the fastest path. Pasting or typing a URI fills the tabs, as the link's field did. Once a field below is edited by hand, the string field empties and its helper reads `Edited below — paste a URI to replace`. The string is not rewritten from the fields: a stored password never reaches the renderer (§9), so a rebuilt string could not be complete, and a partial one pasted back would drop the credentials.
- **Type is inferred from the URI.** An empty create form starts on **Standard**, host `localhost`, port `27017`. It started on SRV with a `cluster.mongodb.net` placeholder, so every local user's first step was changing the type.
- **Tabs**: `General`, `Authentication`, `TLS / SSH`, `Advanced`. TLS and SSH share a tab; "Auth" is spelled out. A tab holding any non-default value carries a dot.
- **Footer**: `Cancel` at the left; at the right `Test`, `Save`, and a filled **`Save & connect`**. The test result renders inline in the footer (`Connected in 84 ms · v8.0.5`). After a plain Save the user needed a second step to connect.
- **Save & connect** saves as §6 does, then connects and closes the form. If the connect fails the Connection stays saved, and the failure shows on its navigator root as any failed connect does.
- **Keys** (supersedes §8's second bullet): `⌘↵` is **Save & connect**, the form's primary action, as ⌘↵ is the primary action everywhere else in the app; `⌘S` is Save; `⌘⇧↵` is Test. `Esc` is Cancel, through the dirty guard.
- The form can open on a named tab. An authentication failure's `Edit credentials…` opens it on Authentication ([W02 §16](./W02-db-collection-navigator.md)).

### 13.3 Acceptance criteria

- With no saved Connection the window shows the welcome canvas and no tab strip, navigator or status bar.
- Entering `mongodb://localhost:27017` and pressing Enter saves a Connection named `localhost`, connects, and shows the connected canvas.
- A second URI to the same host is saved as `localhost 2`.
- A URI that fails its test shows the reason and `Troubleshoot`, and saves nothing.
- A URI with a password never appears in a preference, in tab state, in the palette's history or in a log line, and the error under the field does not contain the password.
- The three links open the form, the Import Wizard on a file, and the Import Wizard on pasted URIs.
- The form shows the connection string field without any click; a pasted URI fills the tabs and selects the matching type.
- An empty create form is Standard / `localhost` / `27017`.
- The tabs read General, Authentication, TLS / SSH, Advanced; a tab with a non-default value has a dot.
- `Save & connect` and ⌘↵ save and connect; ⌘S saves only; ⌘⇧↵ tests.

### 13.4 Test cases

- **Unit**: the Connection name derived from a URI's first host, and the suffix when taken; the tab-has-non-default-value rule.
- **Component**: the welcome canvas for zero Connections and its absence with one; the Connect sequence against the mocked bridge (parse, test, create, connect), including a parse failure, a test failure and a name clash; the field emptied after success; no call to `prefs.set` or `tabs.update` carrying the URI; an error that omits the password; the three links.
- **Component** (`connection-form`): the string field visible on open; paste fills tabs and type; a hand edit empties it; the default type; the merged tabs and the dot; the footer's three actions; ⌘↵, ⌘S, ⌘⇧↵; opening on Authentication.
- **E2E**: first run → paste a URI → Enter → connected canvas → open a collection.
