# C12 — Auto-remediation buttons in the troubleshooting drawer

## Purpose

Turn the C11 drawer's advice from "read this and go fix it yourself" into
"click one button to fix it." Two concrete recipes already declare
`suggestedAction` hooks (`docker-tls` → `retryWithoutTls`, `replica-host`
→ `retryDirectConnection`); this spec wires actual buttons that the
drawer dispatches to a handler the trigger site provides.

The user's recovery loop becomes: Test fails → drawer opens → click
**Retry without TLS** → form flips the toggle and re-tests → the result
shows up in the same pill, and the drawer closes if successful.

## Scope

- **In**: `useTroubleshooting().open(input, actions?)` accepts an optional
  `actions` map keyed by `SuggestedActionId`. `RecipeStep.suggestedAction`
  buttons render only when (a) the step declares one and (b) the open
  call supplied a handler for it. `NewConnection` provides the two v1
  handlers (TLS off + flip Direct connection on, both followed by an
  immediate Test). After a successful action the drawer auto-closes.
- **Out** (deferred):
  - **Persisting `serverReplica` from a failed probe** (BACKLOG
    "Smarter defaults" note about extending `ProbeResult`). The recipe
    `match` function already gates on the right error pattern
    (`TIMEOUT + ENOTFOUND`); adding a topology probe to the failure
    path is strictly an *additional* signal we can layer on later if
    false-positive button offers become a problem in practice. v1
    relies on the match function alone.
  - **Auto-remediation from `DetailPanel`**. The connection there is
    already persisted; "Retry without TLS" would silently mutate the
    saved record. v1 offers buttons only on `NewConnection` (where the
    user is actively configuring). The `DetailPanel` drawer still
    renders the recipe + steps, just without the action buttons.
  - Custom-author recipes / user-defined actions / telemetry on which
    suggestions get clicked — same out-of-scope rationale as C11.

## Dependencies

- C11 (`recipe.suggestedAction`, `useTroubleshooting`, drawer shell).
- C03 (`NewConnection` form state — TLS toggle + Advanced toggle +
  the existing `handleTest` handler).

## 1. Types

```ts
// src/troubleshooting/types.ts (additions)

export type SuggestedActionId =
  | 'retryWithoutTls'
  | 'retryDirectConnection';

/**
 * Optional handlers a trigger site can provide when opening the drawer.
 * Each handler returns a Promise; resolving means "the action ran" — the
 * drawer auto-closes. Rejecting / returning false leaves the drawer open
 * so the user can read the next step.
 */
export type RecipeActionHandlers = Partial<
  Record<SuggestedActionId, () => Promise<boolean>>
>;
```

`RecipeStep.suggestedAction` keeps its existing string-literal shape;
narrowing to `SuggestedActionId` is a one-line type tightening, not a
behavior change. Old recipes that set the field to nothing still render
no button.

## 2. Drawer rendering

In `TroubleshootingDrawer.tsx`, each step row gains:

```tsx
{step.suggestedAction && actions?.[step.suggestedAction] && (
  <button onClick={() => runAction(step.suggestedAction)}>
    {ACTION_LABEL[step.suggestedAction]}
  </button>
)}
```

`ACTION_LABEL` is a small const map:

```ts
const ACTION_LABEL: Record<SuggestedActionId, string> = {
  retryWithoutTls: 'Retry without TLS',
  retryDirectConnection: 'Retry with Direct connection',
};
```

Button placement: right-aligned inside the step card, below the body.
Visual style: re-use the `<Btn small primary />` component for visual
parity with the rest of the connection form.

`runAction` shape:

```ts
async function runAction(id: SuggestedActionId) {
  const handler = actions?.[id];
  if (!handler) return;
  let succeeded = false;
  try {
    succeeded = await handler();
  } catch (err) {
    // Handler is allowed to throw; treat as "didn't succeed" — don't
    // crash the drawer. The trigger site will have surfaced its own
    // error UI (e.g., the failure pill flipped back to fail).
    succeeded = false;
  }
  if (succeeded) onClose();
}
```

The button is rendered only when the matching handler exists, so the
DetailPanel surface (which doesn't provide handlers) automatically
hides them — no extra branching in the drawer.

## 3. Provider API change

`useTroubleshooting().open` gains an optional second parameter:

```ts
open: (
  input?: RecipeMatchInput,
  actions?: RecipeActionHandlers,
) => void;
```

The provider stores the actions on the open state and threads them into
the drawer:

```ts
interface DrawerState {
  open: boolean;
  input: RecipeMatchInput;
  actions: RecipeActionHandlers;
  previousFocus: HTMLElement | null;
}
```

Default to an empty actions object — every existing call site keeps
working unchanged.

## 4. NewConnection handlers

In `ConnectionForm.tsx`, the Test path becomes:

```ts
const help = useTroubleshooting();
// existing handleTest unchanged …

const handleTestFailureHelp = () => {
  if (!testFailure) return;
  help.open(testFailure, {
    retryWithoutTls: async () => {
      set('tlsEnabled', false);
      await handleTest();
      // After handleTest, testState reflects the new outcome.
      // We need to read the post-test state, but handleTest is async
      // and updates state synchronously. Read from a ref-tracked
      // testState (see §5 implementation note).
      return latestTestState() === 'ok';
    },
    retryDirectConnection: async () => {
      set('directConnection', true);
      await handleTest();
      return latestTestState() === 'ok';
    },
  });
};
```

The "Help me fix this" link calls `handleTestFailureHelp` instead of
the bare `help.open(testFailure)` it calls today.

## 5. Reading the post-test outcome

`handleTest` mutates `testState` via `setTestState` — React batches the
update, so reading `testState` immediately after `await handleTest()`
returns the *previous* render's value, not the freshly-set one.

Two clean options:

1. **Return the result from `handleTest`.** Convert it to
   `async () => Promise<{ ok: boolean }>` and have it return the
   ProbeResult shape. The handler then knows the outcome without
   relying on render timing.
2. **Track via ref.** A `latestTestStateRef = useRef<TestState>('idle')`
   updated wherever `setTestState` fires. The handler reads
   `latestTestStateRef.current`.

We pick #1 — it's a minimal change to the existing function (one
return statement) and avoids ref bookkeeping. The current `handleTest`
already has all the information at the point of return; we just
surface it.

After the change:

```ts
const handleTest = async (): Promise<{ ok: boolean }> => {
  // … same body …
  // each branch returns { ok: r.ok } / { ok: false }
};
```

All existing call sites keep working because they ignore the return
value.

## 6. Behavior rules

- **Auto-close on success.** Drawer closes after the action handler
  resolves with `true`. The user sees the green "Connection successful"
  pill in the form they were already looking at.
- **Stay open on failure.** If the retry fails for a *different* reason
  (e.g., TLS off → now AUTH error), the drawer stays open with the
  *original* recipe. The form's failure pill updates with the new
  error code; if the user clicks "Help me fix this" again, the drawer
  re-opens with the new recipe. We deliberately don't auto-swap the
  recipe inside an open drawer — that hides the user's mental model of
  "I tried this fix; it didn't work."
- **Idempotent.** Clicking "Retry without TLS" when TLS is already off
  flips the toggle (no-op) and runs Test. No special-casing.
- **One in flight at a time.** While the action handler is awaiting
  `handleTest`, the button is disabled (driven by a local `pending`
  state in the drawer). Mashing the button can't double-fire.

## 7. Persistence

None. Action handlers are renderer-side closures over component state.

## 8. Acceptance criteria

- [ ] In `NewConnection`, a Test failure with `errorCode: TIMEOUT` and
      a message containing `ECONNRESET` opens the drawer with a
      **Retry without TLS** button under the matching step.
- [ ] Clicking it sets `tlsEnabled` to false on the form, runs Test,
      and (when the next probe succeeds) auto-closes the drawer.
- [ ] If the retry fails again, the drawer stays open and the failure
      pill in the form reflects the new outcome.
- [ ] Same flow for `errorCode: TIMEOUT` + `ENOTFOUND` →
      **Retry with Direct connection** flips
      `advanced.directConnection` to true.
- [ ] On `DetailPanel`, the drawer renders the same recipes but no
      action buttons appear (no handlers were registered).
- [ ] Recipes without a `suggestedAction` (e.g., `auth-default`,
      `unauthorized`) render no buttons regardless of trigger site.
- [ ] The action button is disabled while a previous click is in
      flight; double-clicks fire the handler exactly once.
- [ ] `useTroubleshooting().open()` with no `actions` argument
      (existing call sites — palette command, future surfaces) renders
      the drawer with no action buttons.

## 9. Test cases

### Unit

- **action-handler-resolution.spec.tsx** — A mock provider with a
  spying handler. Assert: clicking a button calls the handler exactly
  once; resolving `true` triggers `onClose`; resolving `false` /
  rejecting leaves the drawer open.
- **action-button-gating.spec.tsx** — Drawer rendered with a recipe
  that has `suggestedAction: 'retryWithoutTls'` but no matching
  handler in `actions` → no button. With a handler in `actions` → one
  button. Recipe with no `suggestedAction` → no button regardless.

### Component

- **troubleshooting-retry-without-tls.spec.tsx** — Full
  `NewConnection` flow: Test fails with `TIMEOUT + ECONNRESET`, click
  Help, click *Retry without TLS*, mock `conn.test` resolves `ok: true`
  on the second call, drawer auto-closes, success pill visible.
- **troubleshooting-retry-direct-connection.spec.tsx** — Same but for
  `TIMEOUT + ENOTFOUND` → `retryDirectConnection`. Verify the
  *Direct connection* toggle on the Advanced tab is checked after the
  click (form mutation observable via `screen.getByRole('switch')`).
- **troubleshooting-retry-stays-open-on-second-failure.spec.tsx** —
  First Test fails with `TIMEOUT + ECONNRESET`. User clicks *Retry
  without TLS*. The retry's `conn.test` resolves with a *different*
  failure (e.g., `AUTH`). Assert: drawer is still open showing the
  original recipe; failure pill now shows `Authentication failed`.

## 10. Implementation order

One commit. The change is small enough not to benefit from staging:

1. Tighten `RecipeStep.suggestedAction` to `SuggestedActionId | undefined`.
2. Add `RecipeActionHandlers` type and `ACTION_LABEL` const.
3. Extend `useTroubleshooting().open()` signature; thread `actions`
   through the provider and into the drawer.
4. Render the action button per step in `TroubleshootingDrawer.tsx`,
   gated on `actions[step.suggestedAction]`.
5. Convert `NewConnection.handleTest` to return `{ ok: boolean }`.
6. Wire `handleTestFailureHelp` and pass actions to `help.open`.
7. Update existing component tests that called the old signature
   (none today — the only call sites are the palette command and the
   raw failure-pill click, both pass-through).
8. Add the four new tests from §9.

## 11. Risks and mitigations

- **Stale closure in handlers.** `handleTest` reads `form` state; if
  the user opens the drawer, edits the form, and then clicks the
  retry button, the closure still sees the form values from the time
  `handleTestFailureHelp` was called. Mitigation: handlers always read
  the freshest `form` via the existing `set` accessor (it operates on
  the current state via the setter callback) — `set('tlsEnabled',
  false)` flips the value regardless of the closure's view, then
  `handleTest` is itself a closure over the latest `form` because it's
  re-created every render. Not an issue in practice; the test in §9
  covers it.
- **Toggle race.** `set('tlsEnabled', false)` is async (React batches);
  `handleTest()` reads `form.tlsEnabled` synchronously when building
  the probe input. Mitigation: rather than relying on render timing,
  pass the *new* values through `handleTest` via a `formOverride`
  parameter, or restructure to compute the probe input inside the
  handler (`toInput({ ...form, tlsEnabled: false })`). v1 picks the
  second: `handleTest({ ...form, tlsEnabled: false })`. Cheap, no ref
  bookkeeping.
- **Discoverability.** A user who never reads the recipe body and
  just clicks the button without understanding what changed could
  end up with a connection that works in dev but fails in prod
  (TLS off → committed). We mitigate by making the button label
  explicit ("Retry **without TLS**") and by leaving the form toggle
  visibly flipped after the action — the saved connection clearly
  shows TLS off, so a careful user spots it before saving.
