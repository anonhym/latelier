# X17 — Renderer hardening

> **Status: Applied.** CSP, window-open denial, navigation guard, sender
> validation and `sandbox: true` all ship. Verified in a packaged build and in a
> dev-server run; see §7.

## Purpose

The renderer's entire job is rendering documents from whatever cluster the user
connects to. Its input is attacker-influenceable by construction, and it holds a
preload bridge to a main process with the filesystem, the keychain and every
open Mongo connection behind it.

Two protections were already right — `nodeIntegration: false` and
`contextIsolation: true`. This spec is the layers underneath them.

## Scope

In: Content-Security-Policy, child-window creation, top-level navigation, IPC
sender validation, renderer sandboxing.

Out: the IPC envelope and channel contract, which stay in
[F04](./F04-ipc-bridge.md) — §8.1 there is the normative sender rule and this
spec does not restate it. Out: script and shell execution
(`ShellService`, `ScriptService`), which run main-side and are their own
question.

## 1. Content-Security-Policy

Served as a response header from `session.webRequest.onHeadersReceived`, not a
`<meta>` tag. One document is loaded from two origins — the dev server over
`http`, the build over `file:` — and a meta tag would have to carry the looser
of the two policies into the shipped app.

| Directive | Shipped | Dev | Why |
| --- | --- | --- | --- |
| `default-src` | `'self'` | `'self'` | |
| `script-src` | `'self'` | `+ 'unsafe-inline'` | Vite injects an inline module preamble for React Fast Refresh; no such script exists in a build |
| `connect-src` | `'self'` | `+ ws: http://localhost:*` | HMR websocket |
| `style-src` | `'self' 'unsafe-inline'` | same | See below |
| `font-src` | `'self'` | same | Self-hosted since [X08](./X08-brand-identity.md); no third-party request at runtime |
| `img-src` | `'self' data:` | same | Vite inlines assets under its 4 KB threshold as `data:` URIs |
| `object-src`, `frame-src`, `worker-src` | `'none'` | same | None are used — the editor is CodeMirror, which needs no worker |
| `base-uri`, `form-action` | `'none'` | same | |

**`style-src 'unsafe-inline'` is not a placeholder, and a nonce would not
replace it.** CSP nonces exempt `<style>` *elements*, never `style=""`
*attributes*, and this renderer writes inline style attributes throughout.
Mantine supports a style nonce, but that covers only its own injected `<style>`
tags. Removing this concession means removing inline styles from the
application, which is a different piece of work.

`worker-src 'none'` is safe only while nothing uses a worker. A future
dependency that spawns one will fail silently — as a feature that does nothing,
not as an error — so widen this deliberately rather than on a stack trace.

## 2. Child windows

`webContents.setWindowOpenHandler` denies every request. Nothing in this app
opens a second window.

External links are not affected: they go through `app:openExternal`, which
validates the protocol and hands off to the system browser.

## 3. Top-level navigation

`will-navigate` refuses any URL that is not the app's own document, using the
same predicate as sender validation (`electron/security/appLocation.ts`, rule in
[F04 §8.1](./F04-ipc-bridge.md)). Sharing one predicate is the point: a
navigation rule and a sender rule that drift leave a gap exactly the size of
their difference.

**This must not be a string-prefix test.** Two URLs a prefix test accepts:

- `http://localhost:5173@evil.example/` — starts with the dev server URL, and
  its parsed origin is `http://evil.example`, because everything before the `@`
  is userinfo.
- `file:///tmp/attacker.html` — starts with `file://`, as does every local file.
  An origin comparison does not help either: a file URL's origin is the string
  `"null"` for the app document and for `/etc/passwd` alike.

Either one replaces the privileged document while the preload bridge stays
attached.

The window is loaded with `loadURL(APP_URL)` in both modes rather than
`loadFile`, so the URL the window holds is the same string the guards compare
against. With `loadFile` the expected value would be re-derived, and a
difference in percent-encoding or path normalisation would deny every
navigation — which presents as a dead app, not as an error.

## 4. Sender validation

Normative rule: [F04 §8.1](./F04-ipc-bridge.md).

## 5. `sandbox: true`

The preload reaches only for `contextBridge` and `ipcRenderer`, both of which a
sandboxed preload still gets, and the sandboxed `process` polyfill still exposes
`env` — which the e2e harness detection depends on. A preload that came to need
`fs` or `path` would have to give this up; the OS-level sandbox is worth more
than that convenience.

## 6. Behaviour

- A blocked navigation leaves the document where it was, and the app stays
  wired — `window.atelier` is still present.
- A blocked request logs `window: blocked navigation` with the refused URL.
- A denied `invoke` logs `ipc.denied` with the refused frame URL, and **does not
  log the payload**: the guard runs before `ipc.req`, because an untrusted
  payload is not ours to write down.

## 7. Acceptance criteria

Every one is asserted by behaviour, never by configuration. Asserting the string
passed to `callback()` would pass identically if the header never reached the
document — and whether `onHeadersReceived` fires at all depends on the URL
scheme, which was the open question for the `file:` case.

- [x] A third-party `fetch` from the renderer is refused.
- [x] `window.open` returns `null` and no second window exists.
- [x] `location.assign` to a remote origin leaves the document where it was.
- [x] A userinfo-smuggled host and an arbitrary local file are both refused.
- [x] Zero CSP violations during boot, in a packaged build **and** against the
      dev server with HMR connected.
- [x] An `invoke` from a foreign frame returns `UNTRUSTED_SENDER` without
      reaching the handler.
- [x] `createRouter` cannot be constructed without a sender check.

## 8. Test cases

| Where | Covers |
| --- | --- |
| `tests/unit/appLocation.spec.ts` | the location predicate — userinfo smuggling, arbitrary local files, opaque origins, percent-encoded paths, HashRouter fragments |
| `tests/unit/senderGuard.spec.ts` | frame identity, a navigated main frame, disposed frames, no window |
| `tests/integration/router-sender.spec.ts` | the guard through a registered channel: allow path, deny path, and that a denial logs no payload |
| `tests/e2e/x17-renderer-hardening.e2e.ts` | what the browser enforces, over `file://` |
| `tests/e2e/x18-window-lifecycle.e2e.ts` | that closing the window does not kill the app — **macOS only**, because `window-all-closed` quits elsewhere and the precondition cannot exist |

Every integration spec supplies the **real** sender check rather than a
permissive stub, so all ninety channel tests exercise the allow path.

**The dev-server branch has no automated gate.** It was verified by hand — Vite
on a fixed port, Electron launched with `VITE_DEV_SERVER_URL`, console captured.
Automating it is tracked separately; until then it is a manual step whenever
the policy changes.

## 9. Known gaps

- `worker-src 'none'` and `connect-src 'self'` are correct for today's
  dependencies and are the two directives a new dependency is most likely to
  trip.
- Sender validation is defence in depth, not the primary control. With
  `frame-src 'none'`, no window-open and no navigation, a correct build has one
  frame and this never fires.
