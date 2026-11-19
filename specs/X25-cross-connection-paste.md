# X25 — Cross-Connection Paste warning

> **Status: Implemented.**

## Purpose

Warn the user when they paste a value copied from one Connection into a query on another. Connections reach separate servers, so an id copied from `orders` on client A's deployment and searched for on client B's returns nothing, or the wrong document, without saying why. The app remembers the **Copy Origin** of its most recent data-bearing copy. A **Cross-Connection Paste** into a query surface gets an inline warning, and the paste is never blocked. Terms are as defined in `CONTEXT.md`.

## Scope

- **In**:
  - Recording the Copy Origin on data-bearing copies, including text selected in a result view.
  - Detecting a Cross-Connection Paste on the query surfaces.
  - The inline warning strip, emphasised when the next Run is empty.
  - A preference to turn the warning off.
- **Out**:
  - Detection at Run time, for values typed by hand or edited after pasting.
  - Pastes into the Document Editor (moving a document between servers is legitimate) and the shell pane.
  - Copies made outside the app, and the system clipboard's history (clipboard managers).
  - Reference discovery (suggesting a Reference Rule when a copied value finds a match in another Collection), which reuses the Copy Origin but is specified separately.

## Dependencies

- [X23](./X23-connection-families.md): Family members are **not** exempt. The warning names both Connections, and their Family when they share one.
- [W05](./W05-query-bar.md), [W04](./W04-query-builder-pane.md), [A03](./A03-stage-accordion.md): the query surfaces that get a paste hook.
- [W06](./W06-result-views.md): the result views whose copies record a Copy Origin.

## 1. Copy Origin

Renderer-only state, in a plain module `src/utils/copyOrigin.ts`. It is not React state, not persisted, and not sent over IPC.

```ts
interface CopyOrigin {
  connectionId: string;
  dbName: string;
  collection: string;
  text: string;                 // what was written to the clipboard
  distinctive: string[];        // §3, extracted once at copy time
}
```

- Only the **most recent** data-bearing copy is held. It has no expiry and is gone when the app quits.
- `copyToClipboard(text, successMessage?, origin?)` gains an optional `{connectionId, dbName, collection}`:
  - with it, the Copy Origin is replaced, but only when the write to the clipboard succeeded;
  - without it, the Copy Origin is cleared.
- **Data-bearing copies, which pass an origin**:
  - Value;
  - Document id;
  - Document (menu, ⌘C/⌘⇧C, the JSON view);
  - the selection bar's multi-document copy;
  - aggregation Output, whose origin is the pipeline's source Collection.
- **Copies that clear it**: field name, namespace, Database or Collection name, query, pipeline, stage, command, explain plan, connection string, "Copied your version" in the Document Editor.
- **Selected text in a result view**: a `copy` event listener on each result view's container records the selection with the Focused Tab's Connection, Database and Collection when the selection is non-empty. `copyShortcutOf` already leaves this case to the browser, and the listener only observes it.

## 2. Query surfaces

A paste on any of these runs detection: the **Filter Bar**, a **Query Builder** value input, **sort**, **projection**, and an **aggregation stage body**. CodeMirror surfaces hook `EditorView.domEventHandlers({ paste })`, and plain inputs use `onPaste`. Both read `event.clipboardData.getData('text/plain')`, which needs no clipboard permission. The handler never calls `preventDefault`, so the paste always lands.

## 3. Detection

A paste is a Cross-Connection Paste when all of these hold:

1. The warning preference is on.
2. A Copy Origin is held, and its `connectionId` differs from the Focused Tab's. The same Connection with a different Collection never matches.
3. At least one of the Copy Origin's **distinctive values** appears in the pasted text.

**Distinctive values** are extracted from the copied text. Each is a value that would be unlikely to repeat across servers:

- a 24-character hex ObjectId, however it's written: `ObjectId("…")`, `{"$oid": "…"}` or bare;
- a UUID, in canonical 8-4-4-4-12 form;
- a string of at least 6 characters;
- an integer or decimal of at least 6 digits.

Booleans, `null`, and strings or numbers shorter than that are never distinctive, so `"ok"` or `3` never warns. Extraction uses linear-time patterns only: no nested quantifiers (CLAUDE.md). It also caps the copied text it scans at 256 KB, and the number of values it keeps at 1,000.

## 4. The warning

- An **inline strip** under the surface that received the paste, not a toast, reading: "Copied from **A** · `shop.orders`. This tab is on **B**." When A and B are in the same Family, it adds "(both in *Client deployments*)".
- It has a **Dismiss** button and a link to **Settings** to turn the warning off.
- It stays until it's dismissed, the tab's next Run finishes, or the tab closes. One strip per tab: a second Cross-Connection Paste replaces it.
- If that next Run returns **no documents**, the strip doesn't go away. It switches to the warning colour and reads "No results, and this value was copied from **A**." It then stays until dismissed.
- The strip is `role="status"`, its Dismiss button is a native button reachable by keyboard (X19), and Escape inside the strip dismisses it with `stopPropagation()`.

## 5. Preference

`app_state` key `warnings.crossConnectionPaste`, a boolean, `true` by default, read and written through `api.prefs`. It appears in Settings as **Warn when pasting a value copied from another connection**.

## 6. Acceptance criteria

- Each data-bearing copy kind records a Copy Origin, and each other in-app copy clears it.
- Copying selected text inside a result view records a Copy Origin for the Focused Tab.
- Pasting a distinctive value copied on Connection A into any of the five query surfaces of a tab on Connection B shows the strip, and the pasted text lands unchanged.
- The same paste on a tab of Connection A, whatever its Collection, shows nothing.
- A paste into the Document Editor or the shell pane shows nothing.
- A short value or boolean copied on A and pasted on B shows nothing.
- Two members of one Family get the warning, and it names the Family.
- The strip clears on Dismiss or after the next Run. If that Run returns no documents, it switches to the empty-result wording instead and stays.
- With the preference off, nothing shows.
- Nothing about a Copy Origin is written to disk or sent to main.

## 7. Test cases

### Unit
- `copy-origin.spec.ts`:
  - replace on a successful copy with an origin;
  - clear on a copy without one;
  - no change on a failed clipboard write.
- `distinctive-values.spec.ts`:
  - each ObjectId spelling, a UUID, and the 6-character boundaries;
  - booleans, null and short values excluded;
  - the size caps.
  - A property test checks that, for any generated ObjectId, the bare, `$oid` and `ObjectId("…")` forms all extract the same hex.
- `cross-connection-paste.spec.ts`: the detection rules in §3 as a pure function. Covers the same Connection, a different Connection, the preference off, and no match.

### Component
- One test per query surface: a paste event with a mocked Copy Origin from another Connection shows the strip, and the event isn't prevented.
- `result-view-copy-origin.spec.tsx`: a `copy` event with a selection records the origin, and one without a selection doesn't.
- `paste-warning-strip.spec.tsx`, with a stateful wrapper so the Run result round-trips through props:
  - Dismiss, and Escape with `stopPropagation`, proved by a parent spy;
  - cleared after a Run with results;
  - the emphasised wording after an empty Run.

### E2E
- `x25-cross-connection-paste.e2e.ts`: two Connections to two `mongodb-memory-server` instances. Copy a document id from Table view on A, paste it into the Filter Bar of a tab on B, see the strip, Run, and see the empty-result wording. The same paste on A shows nothing.
