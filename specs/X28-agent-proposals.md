# X28 — Agent Proposals: an Agent suggests a Reference Rule, the user decides

> **Status: Accepted.** Nothing has shipped.

## Purpose

An Agent exploring a database often works out how its collections relate (`orders.customerId` holds a `customers._id`) and then can only say so in its chat, where the finding is lost. L'Atelier already has the place for that knowledge, the Reference Rule ([X05](./X05-document-references.md)), and a way to suggest one inline, the discovery strip ([X26](./X26-reference-discovery.md)). X28 lets an Agent file a **Proposal** for a Reference Rule. A Proposal changes nothing: it waits until the user adds the rule, sets it aside or declines it. This is the first time an Agent can ask for a change to **app** state. It still never changes a database.

## Threat model

[X27](./X27-agent-access.md)'s threat model stands: an Agent does what its prompt tells it, and documents it reads can steer it. Here that means a Proposal may be wrong or hostile.

**What a hostile Reference Rule could do, and why it is acceptable once a user accepted it:**

- Following a reference runs a `find` by the target field on the user's own client, with the user's own permissions, and shows the result to the user. The Agent never sees it. A rule pointing at a sensitive collection shows the user data they can already read, on their own click.
- A rule on an unindexed target field makes each followed reference a collection scan. That is the existing cost of any badly chosen rule, which the user can already create by hand. The check in §5 shows whether the relation holds before the user decides.
- A rule saved for a Family applies to Connections the Agent was never given. So "Save for" defaults to this Connection only (§6).

**Defended against:**

- **Applying without the user.** No tool creates a rule. Only a user's click on Add Reference Rule does, through main (§6).
- **Flooding.** At most 20 open Proposals per Agent Token (§4.1). A repeat of an open pair returns the existing Proposal. A declined pair is refused for good. The X30 toasts fold beyond three.
- **Persuasion.** The Agent's reason is at most 500 characters, shown as plain text in a style marked as the Agent's own words, never as markup or a link (§5).
- **Reaching what was not shared.** A Proposal is filed only on a shared, open Connection (X27 §2), and never names a §7.4 namespace.

## Scope

### In

- One Proposal kind: a Reference Rule.
- Two Agent tools, `propose_reference_rule` and `get_proposal`.
- A table and a migration.
- Accept, set aside, decline. A read-only check of three sample documents.
- The inline strip on the source collection, reusing X26's strip. The rest of the UI, Needs you and toasts, is [X30](./X30-agents-mode.md)'s.

### Out

- Other kinds: a saved query, an index suggestion, a Family grouping. Each is its own decision.
- An Agent asking the user to run a script or an update. That is a later spec with its own threat model, because what it asks for would write to a database.
- Editing a Proposal before accepting it. The user accepts it as proposed and edits the rule afterwards in the Reference Rules editor.
- Anything an Agent can apply without a click.

## Dependencies

- [X27](./X27-agent-access.md): the gates (§2), the token and session identity (§16.2), the namespace denylist (§7.4), the envelope and error codes (§9), and the Agent Read Log (§11).
- [X05](./X05-document-references.md): `ReferenceRulesService.create` and the effective rule list.
- [X23](./X23-connection-families.md): rule owners, one Connection or a Family.
- [X26](./X26-reference-discovery.md): the pair key, the strip, and the Never list `refs.discovery.never`.
- [X30](./X30-agents-mode.md): where Proposals are listed and announced.
- [X21](./X21-encryption-at-rest.md): `ColumnCipher` for the Agent's reason.

## 1. Terms

- **Proposal**: a pending suggestion from an Agent to change app configuration. Iteration 1 has one kind, a Reference Rule.
- A Proposal is **open** while its status is `pending` or `later`.

## 2. Data model

A new append-only migration (the next free number, after [X27 §16.2](./X27-agent-access.md)'s, since `session_id` refers to its sessions) adds `agent_proposals`:

| Column | Notes |
| --- | --- |
| `id` | UUID |
| `kind` | `TEXT CHECK (kind IN ('reference_rule'))` |
| `status` | `TEXT CHECK (status IN ('pending','later','accepted','declined','expired','obsolete'))` |
| `token_id`, `token_name` | the proposing Agent, the name copied at write time |
| `session_id`, `client_name` | the session (X27 §16.2) and its client |
| `connection_id`, `connection_name` | the name copied at write time |
| `source_db`, `source_collection`, `source_field` | |
| `target_db`, `target_collection`, `target_field` | |
| `pair_key` | X26 §4's key: `connectionId\|srcDb.srcColl.srcField->tgtDb.tgtColl.tgtField` |
| `reason` | `BLOB` sealed by `ColumnCipher`: Agent-written text can carry values copied from documents |
| `created_at`, `decided_at`, `expires_at` | ISO-8601 |
| `rule_id` | the created rule, once accepted |
| `saved_for` | `TEXT CHECK (saved_for IN ('connection','family'))`, once accepted |

- No foreign keys, like the Agent Read Log: a Proposal outlives its token, session and Connection.
- A partial unique index on `(pair_key)` where the status is open: one open Proposal per pair.
- Database and collection names follow the Agent Read Log's treatment (X27 §11.2).
- **Retention**: decided Proposals (`accepted`, `declined`, `expired`, `obsolete`) are pruned 90 days after `decided_at`, by `MaintenanceService` in the log's pass.

## 3. Lifecycle

```
pending ──Add Reference Rule──▶ accepted
   │  ▲
 Not now  (reopened by the user)
   ▼  │
 later
pending / later ──Never for this pair──▶ declined
pending / later ──30 days after created──▶ expired
pending / later ──the source field gains an effective rule──▶ obsolete
```

- `expires_at` is `created_at` + 30 days. Expiry is applied when Proposals are listed and by `MaintenanceService`.
- **Obsolete.** When a Proposal is listed or shown and the Connection's effective rules already hold one for its source field, from any source, it becomes `obsolete` and leaves every list. That is X26 §4's suppression rule.
- A Proposal whose Connection was deleted becomes `expired` the next time Proposals are listed.
- The Agent's session ending does not touch a Proposal. A suggestion for app configuration stays valid when its author is gone.
- Unsharing the Connection, or turning Agent Access off, does not touch open Proposals either: accepting one needs neither.

## 4. Tools

X27 §8 says every tool is `readOnlyHint: true`. `propose_reference_rule` is the exception, and the only one: it writes a row to app state, never to a database.

### 4.1 `propose_reference_rule`

- **Input** (strict schema): `connectionId`, `sourceDb`, `sourceCollection`, `sourceField`, `targetDb`, `targetCollection`, `targetField?` (default `_id`), `reason` (1 to 500 characters).
- **Annotations**: `readOnlyHint: false`, `destructiveHint: false`, `idempotentHint: true`, `openWorldHint: false`.
- **Checks, in order**, each refusing with a §9.4 code:
  1. The three gates and the token (X27 §2): `ACCESS_OFF`, `NOT_SHARED`, `NOT_OPEN`. Like every tool that names a Connection, a call on a shared, closed Connection may first pause and ask the user to open it ([X29 §4](./X29-agent-access-mcp-2026.md)).
  2. Both namespaces against X27 §7.4: `NAMESPACE_DENIED`.
  3. Both field paths: 1 to 256 characters, dotted segments that are non-empty, do not start with `$`, and are not all digits (an array index names no field, X26 §1): `INVALID_INPUT`. Source and target the same field of the same collection: `INVALID_INPUT`.
  4. The pair key is on the Never list: the new code `PROPOSAL_DECLINED`, "The user declined this relation. Do not propose it again."
  5. The source field already has an effective rule: the new code `ALREADY_CONFIGURED`, naming no rule.
  6. An open Proposal for the same pair exists: no new row. The call succeeds and returns the existing Proposal's id and status.
  7. The token already has 20 open Proposals: the new code `PROPOSAL_LIMIT`.
- **Effect**: one `pending` row.
- **Returns**: the app-written text "Proposed. The user will review it in L'Atelier; nothing changes until they accept it." and the Proposal id. Names stay inside the X27 §9.3 envelope.
- The tool reads no documents. It does not check whether the relation holds: the user's check does that, on the user's side (§5).

### 4.2 `get_proposal`

- **Input**: `proposalId`. Read-only.
- **Returns** the status and, once accepted, whether the rule was saved for the Connection or its Family. Nothing else: not the rule's id, and not what other Agents proposed.
- A Proposal filed with another token reads as unknown (`INVALID_INPUT`), so an Agent cannot find out what exists.

Both calls write an Agent Read Log row like any tool call, with the arguments, the reason included, in the sealed `request_json`. The server's `instructions` describe both tools and say that a Proposal is a suggestion the user may decline.

## 5. Showing a Proposal

Every surface that shows a Proposal shows the same parts:

- The pair, as X26 writes it: **`orders.customerId` → `customers._id`**, with database names when the two databases differ.
- Who proposed it: the Agent's name and client ("laptop-claude · claude-code") and when.
- The reason, labelled "In the Agent's words", in a quoted style, as plain text. It is never rendered as Markdown or HTML, and nothing in it is a link.
- **The check.** Shown after the user opens the Proposal, never on the Agent's call. Main samples up to three source documents that have the field (`{ [sourceField]: { $exists: true } }`, `limit: 3`) and looks each value up in the target (`limit: 1`, `maxTimeMS` 2,000). It reads on the user's own client, and only while the Connection is open; otherwise it reads "Open {connection} to check this relation". It reports "3 of 3 sampled orders resolve", "1 of 3 …" or "No sampled order has `customerId`". It is read-only and never changes the Proposal.

## 6. Deciding

- **Add Reference Rule** (`agentProposals:accept` `{ id, savedFor }`). Main loads the stored Proposal, checks again that it is open, that the Connection exists, and that the source field still has no effective rule, then calls `ReferenceRulesService.create` with the stored pair and default projection and template. The renderer chooses only `savedFor`; it cannot change the pair.
  - **"Save for" defaults to this Connection only.** This differs on purpose from X26 §5, which defaults to the Family: the Agent was given this one Connection, and a Family rule would reach Connections it never saw. When the Connection is in a Family, the Family is one choice away.
  - When the check found no resolving sample, the button reads **Add anyway**. It is never disabled by the check.
  - The Proposal becomes `accepted` with `rule_id` and `saved_for`, and a toast names the rule.
- **Not now** (`agentProposals:later` `{ id }`): `pending` becomes `later`. It leaves the strip and toasts and stays in Needs you under Later until it expires. A `later` Proposal can be reopened to `pending` (`agentProposals:reopen` `{ id }`).
- **Never for this pair** (`agentProposals:decline` `{ id }`): `declined`. Main appends the pair key to X26's `refs.discovery.never` (its caps and oldest-out rule apply), so neither discovery nor any Agent offers the pair again.

What the Agent learns through `get_proposal` is the status: `pending`, `later`, `accepted`, `declined`, `expired` or `obsolete`.

## 7. On the collection: the strip

On a collection tab's Documents view, an open `pending` Proposal whose source namespace is that tab's, on the tab's Connection, shows in X26's strip under the Filter Bar:

- "**laptop-claude** proposes a Reference Rule: **`orders.customerId` → `customers._id`**", the reason as in §5, the check, and **Add Reference Rule** (or Add anyway), **Not now**, **Never for this pair**. A Family member also gets **Save for the Family**.
- X26 allows one strip per tab. A discovery suggestion from the user's own copy takes it first; the Proposal waits in Needs you and comes back when the strip is free. Several Proposals for one tab show one at a time, oldest first.
- Escape acts as Not now and calls `stopPropagation()`, as in X26.

Needs you and the toasts are [X30 §6 and §8](./X30-agents-mode.md).

## 8. IPC

Through the 5-file contract, with a `registerAgentProposalsChannels` call in `electron/main.ts`:

- `agentProposals:list` `{ status?: 'open' | 'decided', connectionId?, sessionId?, limit }` → Proposals with the reason decrypted for display
- `agentProposals:check` `{ id }` → the §5 check result
- `agentProposals:accept` `{ id, savedFor: 'connection' | 'family' }`
- `agentProposals:later`, `agentProposals:reopen`, `agentProposals:decline` `{ id }`
- `agentProposals:event` (push): a Proposal was added or changed status

No channel takes a secret. `agentProposals:accept` adds no power the renderer lacked, since `refs:create` already accepts any pair.

## 9. Acceptance criteria

- `propose_reference_rule` creates one `pending` row and never a Reference Rule. No path creates a rule from a Proposal except `agentProposals:accept`.
- Each refusal in §4.1 returns its code. A Proposal on a shared Connection that is not open is refused `NOT_OPEN` and makes a Connection request (X27 §16.6).
- A repeat of an open pair returns the same id and adds no row. A token with 20 open Proposals is refused `PROPOSAL_LIMIT`.
- A pair on the Never list is refused `PROPOSAL_DECLINED`, and Never for this pair adds the key to `refs.discovery.never`.
- Accept uses the stored pair, defaults to this Connection, and refuses a Proposal that is no longer open or whose source field gained a rule.
- `get_proposal` reports the status to the proposing token only.
- Proposals expire after 30 days, become obsolete when a rule covers the source field, and are pruned 90 days after a decision.
- The reason is stored sealed, capped at 500 characters, and rendered as plain text with no markup or link.
- The check reads at most three source and three target documents, on the user's client, only while the Connection is open, and never changes the Proposal.
- Every call to either tool writes an Agent Read Log row.
- The strip shows a pending Proposal on its source collection, yields to an X26 discovery suggestion, and Escape stops propagation.

## 10. Test cases

**Unit**

- `agent-proposal-input.spec.ts`: field path rules (empty segment, `$` prefix, numeric segment, 256 characters), same-field refusal, reason length.
- `agent-proposal-lifecycle.spec.ts`: each transition in §3, expiry with an injected clock, obsolete on an effective rule, deleted Connection.
- `pair-key.spec.ts` (extend X26's): the Proposal's key equals X26's for the same pair.

**Integration**

- `agent-proposals.spec.ts`, through an in-process MCP client:
  - each §4.1 check and its code, in order;
  - dedupe and the 20 cap;
  - `get_proposal` across two tokens;
  - accept for the Connection and for the Family through `ReferenceRulesService`;
  - decline writes the Never key, and a re-proposal is refused;
  - the reason is encrypted at rest;
  - pruning;
  - a log row per call.
- `agent-proposal-check.spec.ts` (`mongodb-memory-server`): 3 of 3, 1 of 3, no field, and a closed Connection that is never connected.

**Component**

- `agent-proposal-strip.spec.tsx`, with a stateful wrapper: the strip shows a pending Proposal on its source tab; Add calls `agentProposals.accept` with `savedFor: 'connection'` by default; Add anyway after an empty check; Not now and Never; yields to a discovery suggestion; Escape with `stopPropagation`, proved by a parent spy; a reason holding `<b>` and a URL renders as literal text.

**E2E**

- An Agent proposes `orders.customerId → customers._id` through the built bridge. The strip appears on `orders`; Add Reference Rule creates the rule; the next `get_proposal` returns `accepted`; and following a reference in `orders` opens the customer.

## 11. Definition of done

All eight gates in `CLAUDE.md` § Definition of done apply: a migration, IPC, main-process code and UI. The new pure modules (input validation, the lifecycle) join `stryker.config.json`'s `mutate` list at 90% or higher.
