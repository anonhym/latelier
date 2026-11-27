# X29 — Agents mode: a sidebar for Agents and their sessions

> **Status: Accepted.** Nothing has shipped. The design was reviewed and approved in Claude Design on 2026-11-27 (canvas "Atelier — Agents, first class", page "Agents mode").

## Purpose

[X27](./X27-agent-access.md) let Agents read shared Connections, but in the app they were scattered over seven places: a Settings section, a status-bar control, four Share menus and a token window. None of them answered what a user asks: which Connections can an Agent reach, which Agent is this, what did it do, and does it want something from me. X29 gives Agents one place. The sidebar switches between **Databases**, today's navigator, and **Agents**, which lists only Agents and their sessions. Each item opens in one Agents tab: Home, an Agent, a session. In Databases mode, requests that need the user still arrive as toasts, and a badge on the switch keeps the count.

## Scope

### In

- The sidebar mode switch, the Agents sidebar and the Agents tab.
- **Home**: what needs you, which Connections Agents can reach, setup on first run, all activity.
- **Session page**: who it is, what it asks, what it did.
- **Agent page**: the token's sessions, copying its setup again, renaming and revoking it.
- **Connect an Agent**: the guided copy-paste-connect panel on X27 §16.8.
- **Setup & capabilities**: the Agent Access switch, the bridge, troubleshooting, and what Agents can and cannot do.
- Toasts and the badge in Databases mode.
- Agent calls in a collection's History popover.
- Settings → Agent Access reduced to a pointer.
- The command palette entries and the `agents.share` hint.

### Out

- **An Agent asking the user to run a script or an update.** It is drawn on the canvas as future work. It needs its own spec and threat model, because what it asks for writes to a database: an Agent steered by text in the data could ask for something harmful. When it comes, it reuses Needs you and the toasts below.
- OS notifications outside the app window.
- Sharing below the Connection (X27 §1).
- Anything that lets an Agent act without a click: X27's and X28's rules are unchanged.

## Dependencies

- [X27](./X27-agent-access.md), §16 in particular: sessions, Connection requests, the log channels, the setup copy.
- [X28](./X28-agent-proposals.md): Proposals, their strip and their channels.
- [W01 §14](./W01-workspace-shell.md): the shell bands, the tab strip, the keyboard table. §15 there points here.
- [W02](./W02-db-collection-navigator.md): the Databases sidebar, unchanged apart from the shared marker (§10).
- [W09](./W09-saved-queries.md), [W10](./W10-recent-preview.md): the Saved | History popover.
- [X06](./X06-feature-hints.md): the `agents.share` hint.
- [X07](./X07-command-palette.md): palette commands.

## 1. Terms

- **Agents mode**: the sidebar showing Agents instead of databases.
- **Agents tab**: the one workspace tab that shows Agents pages.
- **Needs you**: the list of open requests from Agents: Connection requests (X27 §16.6) and `pending` Proposals (X28). A `later` Proposal is listed apart, under Later, and is not counted.
- **Session**: one Agent client connection (X27 §16.2), live or ended.

X27 §1's terms are kept in every string. "MCP" appears only where the user must match a client's own wording ("Add L'Atelier to Claude Code (MCP)").

## 2. The mode switch

- A two-segment control at the top of the sidebar, above the navigator's filter: **Databases** | **Agents**, `role="tablist"` with arrow keys and one tab stop. The Agents segment carries the plug icon and a badge with the Needs you count, hidden at zero. The badge's accessible text is "{n} Agent requests".
- It is always shown, whether Agent Access is on or not. It replaces the status bar's "Agents off" as the way into the feature: on first run, Home is the setup.
- The mode is stored in `app_state` under `sidebar.mode` (`'databases' | 'agents'`), added to the renderer's `prefs` allowlist (`electron/ipc/prefKeys.ts`) with that enum schema. It survives relaunch.
- **⌘⇧A** switches modes and moves focus into the sidebar. It is not bound anywhere today (checked on 2026-11-27). Like W01 §14.11's keys, it does not fire under an open dialog, and it is listed in the cheat sheet and the switch's tooltip.
- Switching to Agents opens the Agents tab, or focuses it, on the page it last showed in this run, otherwise Home. Switching to Databases focuses the tab that was focused before. Choosing a tab in the strip never changes the mode.

## 3. The Agents sidebar

From top to bottom:

1. **Home**, with the Needs you badge.
2. A header, **Agents**, with a gear button, "Setup & capabilities" (§7).
3. One row per Agent Token, by name, sorted with `localeCompare`: a key icon, the name, and at the right "{n} live", "last seen {relative}" or "never connected". It expands to its sessions:
   - the live sessions, newest first: a green dot, the client's name, and a second line with the folder's last segment and the time since it connected ("shop-api · 34 min"), with a badge when the session has open requests. A session with no folder shows the client's version instead;
   - then up to five ended sessions, dimmed, "ended · today 09:12–09:40", and **Show all** when there are more, which opens the Agent page.
4. At the bottom, **+ Connect an Agent** (§6).

- The list is a `role="tree"` with the navigator's keyboard model ([W02](./W02-db-collection-navigator.md)): arrows move, Right and Left expand and collapse, Enter opens.
- Expansion is kept in memory for the run. An Agent with a live session starts expanded.
- An Agent row's menu: **Copy setup again…**, **Rename…**, **Revoke…** (§5.3).
- With no Agent yet, the sidebar shows Home and the Connect button only.
- Client names and folders are untrusted text (X27 §16.5): rendered as text, cut with an ellipsis, with the full value in the tooltip.

## 4. The Agents tab

- One tab, labelled "Agents · {page}" (Home, the Agent's name, or "{Agent} · {folder or client}" for a session), with the plug as its kind icon. The breadcrumb ([W01 §14.2](./W01-workspace-shell.md)) reads `Agents › {page}`, or `Agents › {Agent} › {session}`.
- Opening any sidebar item shows it in this tab. There is never a second Agents tab.
- It is a **renderer-only tab**. It is never sent to `tabs:*` or stored in `workspace_tabs`: every row there belongs to a Connection by foreign key, and the Agents tab has none. So:
  - it is always **last** in the strip and cannot be dragged; the stored tabs keep their own `position` values, unaffected by it;
  - it answers to ⌘W and ⌘⌥←/→ like any tab, and ⌘1–⌘9 count it where it is drawn, last;
  - after a relaunch it is absent until the user switches to Agents mode or uses the Agents sidebar. If it was focused at quit, the last focused stored tab is restored as the Focused Tab.
- Closing it leaves the mode as it is. The next switch to Agents, or a click in the Agents sidebar, opens it again.

## 5. Pages

### 5.1 Home

- **Header**: "Agents", one status line ("Agent Access is on · 3 live sessions from 2 Agents", "Agent Access is off", "Bridge not installed"), and **All activity** and **+ Connect an Agent**.
- **Setup.** While Agent Access is off, or no Connection is shared, or no session has ever been recorded, a checklist comes first: **Turn on Agent Access** (X27 §3.1's main dialog), **Share a Connection** (scrolls to the table below), **Connect an Agent** (§6). Each step is ticked from real state; the last ticks when the first session is recorded. It shows whenever one of the three is not true, so turning Agent Access off later brings it back with the other steps already ticked.
- **Needs you** (§8): every open request from every session, newest first, with Later collapsed below.
- **Connections Agents can reach**: every saved Connection, shared ones first, then by name with `localeCompare`. Columns:
  - the Connection, with its status dot and the last privilege result as a pill: read-only, can write or cannot verify (X27 §3.3);
  - **Shared**, a switch. Turning it on calls `agentAccess:set-shared`, so main's dialog and privilege check run as today. Turning it off is immediate;
  - **Status**: "Open · reachable", "Not open", "Open · not shared" or "Closed · not shared";
  - **Used now by**: the live sessions that called it in the last five minutes;
  - **Last Agent call**: a relative time, or "refused · {relative}";
  - an action: **Open** on a shared Connection that is not open.

  A row with an open Connection request is tinted with the warning colour and names the Agent that asked. Under the table: "An Agent sees a Connection only while it is shared and open."
- **All activity**: the whole Agent Read Log in this tab, as the session page's Activity (§5.2) with filters for Agent, Connection and outcome.

### 5.2 Session page

- **Identity**, each value with where it comes from:
  - **Agent**: the token's name, "your name for this token, checked at connect";
  - **Client**: name and version, "as the client reports it";
  - **Folder**: the display form, "reported by the bridge", or "not reported" for a bridge speaking protocol 1;
  - **Session**: a short id, the time it connected, and "live" or "ended {time} · {reason}";
  - **Reached**: a pill per Connection this session called, a refused one in the warning style with its code in words ("refused, not open").
- Pills for the call count and the refusal count.
- **End this session** (`agentAccess:end-session`) closes that one session; the client may reconnect. **Revoke {Agent}…** asks in an app dialog and calls `agentAccess:revoke-token`, which ends every session of that token. Both are absent on an ended session.
- **Needs you** for this session.
- **Activity**: `agentAccess:list-calls` for the session, newest first, appended live from `agentAccess:call-event`. Columns: time, tool, target, result (`50 docs · 38 ms`, `refused · not open`, `truncated · bytes`). A refused row has the warning tint. **Refused only** filters; paging loads older rows on scroll. A row opens a detail panel:
  - the request as sent, as JSON text, with the limits applied and the outcome;
  - **Open as query** on an `ok` row of `find`, `count` or `aggregate` whose request was not cut at 16 KiB. It opens a collection tab with the filter, sort and projection, or the pipeline, in place and **does not run it**: it would run with the user's permissions, so the user reads it and presses Run;
  - **Copy** on every row. A refused or cut request gets Copy only, because a document can steer an Agent into asking for `$out` or `$merge`, and that must never be one click from running.
- An ended session's page shows the same sections, read-only.

### 5.3 Agent page

- The token's name, when it was created and last used, and its sessions, live and ended, with **Show more** paging through `agentAccess:list-sessions`.
- **Copy setup again…** runs X27 §16.8's `copy-setup` for a chosen client. The confirm says the token will be regenerated and live sessions will end.
- **Rename…** (`agentAccess:rename-token` `{ id, name }`, 1 to 64 characters, as `agent_tokens.name`). The Read Log keeps the name each row was written with.
- **Revoke…**, as on the session page.

## 6. Connect an Agent

A panel in the Agents tab, from + Connect an Agent, the checklist, or the palette.

1. **Name and client.** A name ("Work laptop") and a client: Claude Code (command), Claude Code (JSON), Claude Desktop, Cursor. These are the `SnippetClient` values main already builds (`electron/agent/snippets.ts`).
2. **Copy the setup.** One button calls `agentAccess:connect-client`. Main asks its one-question confirm, creates the token and writes the setup to the clipboard (X27 §16.8). Only when the call resolves does step 1 turn green, with "Copied to your clipboard at 11:02", and a toast says "{client} setup copied. It contains the Agent Token for “{name}”. Paste it into {client} now." Cancel leaves the step as it was. After a first success the panel holds the new token's id, and pressing Copy again calls `agentAccess:copy-setup` on it (a regenerate), so a second press never creates a second Agent with the same name.
3. **Paste it.** Where the setup goes for that client, and the setup itself with `YOUR_TOKEN` in place of the token, from `AgentAccessState.snippetTemplates` (main builds one per client with the placeholder, as it builds `claudeCodeCommand` today; never a token).
4. **Wait for the connection.** "Waiting for {client} to connect…" turns into "Connected: {client name} {version}", with a link to the session, when the first session with that token arrives.

The wording of where to paste for Claude Desktop and Cursor is checked against the current clients when this is built (manual test). Until then it names the client's MCP settings without a menu path.

Losing the clipboard means **Copy setup again**: the token is never on screen and never in the renderer.

## 7. Setup & capabilities

The gear in the Agents sidebar header opens it in the Agents tab:

- **Agent Access**: the switch (X27 §3.1's main dialog to turn on; off is immediate) and one status line.
- **Bridge**: installed or not, its path, and **Remove bridge** (refused while Agent Access is on, as today).
- **Troubleshooting**, collapsed: the socket path and, on Windows, X27 §4.3's pipe caveat in plain words.
- **What an Agent can do**: the tools in groups. Explore: list Connections, databases, collections and indexes, collection schema. Read: find, count, aggregate. Check: explain. Relations: list and suggest references. Propose: a Reference Rule. Then the limits from X27 §6.4 and §9.2 as a short table.
- **What an Agent never does**: write to a database, see a host, URI or credential, open a Connection, run `$out` or `$merge`, read `admin`, `local`, `config` or `system.*`.
- **Prompts that work**: three examples ("Which collections in Local dev reference customers?", "How many orders failed yesterday on Local dev?", "Propose Reference Rules for shop.orders").

## 8. Needs you

One list model, used on Home, on a session page and by the toasts:

| Kind | Sentence | Actions |
| --- | --- | --- |
| Connection request | "**{Agent}** asked for **{Connection}**. It is shared, but not open, so the call was refused." Meta: client · folder · time · `{tool} on {db.collection}` | **Open {Connection}** (the user's ordinary connect action) · **Not now** (`agentAccess:dismiss-request`) |
| Proposal (`pending`) | "**{Agent}** proposes a Reference Rule `{source} → {target}`" Meta: client · folder · time | **Review** (opens it in the session page, with X28 §5's reason and check) · **Decline** (X28's Never for this pair, after an app confirm) |

- Newest first. Later Proposals sit under a collapsed **Later ({n})**, each with **Review** and **Move back**.
- The badge counts Connection requests and `pending` Proposals only.
- An empty list says "Nothing needs you. Agents never write; when one needs something, it shows here."

## 9. In a collection's History

Agent calls on a collection appear in its Saved | History popover ([W10 §6](./W10-recent-preview.md)), beside the user's own runs:

- A segmented filter, **All · Mine · Agents**, defaulting to All.
- Agent rows come from `agentAccess:list-calls` filtered to the tab's Connection, database and collection: finds and counts in the Documents history, aggregations in the Aggregation history. They merge with the user's rows by time. Nothing is written to `recent_queries` (X27 §6.3).
- Each Agent row carries a chip, "Agent · {client name}", and its tooltip names the Agent and session.
- Agent rows offer **Load**, which fills the editor without running, never "Run here". Refused and cut rows offer Copy only, for the reason in §5.2.
- The footer links to the session pages: "All Agent activity on {collection}" opens All activity filtered to it.

## 10. Databases mode

### 10.1 Toasts

- A toast for each **new** Needs you item: one per Connection request (a later refusal of the same pair updates it, never adds one) and one per new `pending` Proposal. Ordinary Agent calls never toast.
- Newest on top, bottom right, above the status bar. Each shows the sentence of §8 and two actions:
  - Connection request: **Open {Connection}**, **View session**;
  - Proposal: **Review** (switches to Agents mode on it), **Later** (hides the toast; the item stays in Needs you).
- A request toast **stays until acted on or dismissed** (✕). Dismissing hides the toast only; the badge keeps the item.
- From the fourth open request toast, they fold into one: "{n} Agent requests" with **Open Agents**.
- In Agents mode no toast is shown: the item appears in the list in place.
- The region is `role="region"` with `aria-label="Agent requests"`; each toast is `role="status"` and never takes focus.

### 10.2 What moves out of Databases mode

- **The status-bar Agents control** (X27 §12.2) is removed. The status bar holds the Connection only ([W01 §14.6](./W01-workspace-shell.md)). The switch's badge replaces its count.
- **Share actions**: the navigator root's context menu keeps **Share with Agents…** and **Stop sharing with Agents**, the one in-context place. The Switcher, Connections table and Server Tab entries are removed. Home's table is where sharing is managed.
- **The shared marker** moves before the Connection's name on the navigator root and the Tab Group header, so the row's hover buttons no longer cover it. It uses the plug icon everywhere (the navigator's Share action used a link icon). Its tooltip gives the last privilege result. The Switcher's rows and the Connections table show it too.

## 11. Settings → Agent Access

Reduced to the switch, one status line and **Open Agents**, which switches to Agents mode on Setup & capabilities. The token table, setup steps, shared list and can/cannot copy move to §5–§7.

## 12. Palette and hint

- [X07](./X07-command-palette.md) commands: **Agents: Home**, **Agents: Connect an Agent**, **Agents: All activity**, **Agents: Setup & capabilities**, and **Toggle Agents sidebar** (⌘⇧A).
- [X06](./X06-feature-hints.md)'s `agents.share` hint is anchored to the mode switch instead of the removed status-bar control. It shows under the same condition (a collection tab of an open Connection, Agent Access off, nothing shared) and its Set up action switches to Agents mode on Home.

## 13. IPC

On top of X27 §16.9 and X28 §8, through the 5-file contract:

- `agentAccess:end-session` `{ sessionId }`: closes one live session, recorded with X27 §16.2's `end_reason` `user-ended`.
- `agentAccess:rename-token` `{ id, name }`.
- `AgentAccessState.snippetTemplates`: `Record<SnippetClient, string>`, each built by main with `YOUR_TOKEN`. Never a token.
- The `sidebar.mode` preference on the existing `prefs` channels.

No channel carries a secret, and the `SECRET_INPUT` allowlist is unchanged.

## 14. What this supersedes

- X27 §11.3 and §12.1–§12.3: the read count, the Settings section, the status-bar control, and the Share entries listed in §10.2.
- X27 §5.2's token window, through X27 §16.8.
- W01 §14 gains the mode switch, the Agents tab kind and ⌘⇧A ([W01 §15](./W01-workspace-shell.md)).

## 15. Decisions recorded

Settled at the canvas review on 2026-11-27, with the proposed defaults:

- Agents pages open in **one reused tab**, not in a main area that replaces the tabs.
- A request toast **stays until acted on or dismissed**.
- Requests to run a script or an update come **later, in their own spec**.
- An accepted Proposal is saved for **this Connection only** by default (X28 §6).
- The setup is cleared from the clipboard **after five minutes** if unchanged (X27 §16.8).
- History's filter defaults to **All**.
- The costs: a migration for sessions (X27 §16.2) and a bridge change for the folder (X27 §16.3).

## 16. Acceptance criteria

- The switch shows Databases and Agents with the Needs you count, survives relaunch, and ⌘⇧A toggles it except under a dialog.
- Agents mode lists Agents with their live sessions and up to five ended ones, and opens each in the single Agents tab. The Agents tab is never written to `workspace_tabs`.
- Home lists every saved Connection with its shared, open and privilege state. The switch shares through main's dialog. A shared Connection that an Agent asked for shows the request and an Open button that uses the ordinary connect action.
- The setup checklist ticks each step from real state, shows while any step is not true, and is absent while all three are.
- A session page shows the Agent, the client as reported, the folder as reported (or "not reported"), the Connections reached, and its Activity, live.
- Open as query fills a tab without running, only for an `ok`, uncut `find`, `count` or `aggregate`. Refused and cut requests offer Copy only.
- Connect an Agent reports "copied" only after main resolves, never shows a token, and turns to "Connected" on the token's first session.
- In Databases mode each new request toasts once, stays until acted on or dismissed, and folds into one from the fourth. In Agents mode nothing toasts.
- The status-bar Agents control is gone. The Switcher, Connections table and Server Tab have no Share entries. The navigator root keeps them, and the marker sits before the name.
- A collection's History lists that collection's Agent calls with a chip, filters All · Mine · Agents, and Agent rows Load without running.
- Every Agent-supplied string renders as text only.

## 17. Test cases

**Unit**

- `needs-you.spec.ts`: merging Connection requests and Proposals, the badge count (Later excluded), ordering.
- `agent-toasts.spec.ts`: one toast per new item, updates in place, the fold from the fourth, none in Agents mode.
- `prefKeys.spec.ts` (extend): `sidebar.mode` accepts the two values only.

**Component** (mocked `window.atelier`)

- `agents-mode-switch.spec.tsx`: the badge, ⌘⇧A, inert under a dialog, focus moves into the sidebar.
- `agents-sidebar.spec.tsx`: Agents, live and ended sessions, Show all, the tree keyboard model, a long hostile client name rendered as text.
- `agents-home.spec.tsx`: the checklist ticking, the Connections table rows and states, the switch calling `set-shared`, the request tint and its Open.
- `agents-session-page.spec.tsx`: identity sources, the folder "not reported", live append, Refused only, Open as query rules, End and Revoke.
- `agents-connect-panel.spec.tsx`: "copied" only after resolve, cancel leaves step 1, a second Copy calls `copy-setup` on the same token, "Connected" on the first session, no token in the DOM.
- `history-agent-rows.spec.tsx`: merged rows, the chip, the filter, Load without run, Copy only on refused rows.
- `agents-tab.spec.tsx`: one tab only, always last, never sent to `tabs:*`, counted last by ⌘1–⌘9; ⌘W closes it and leaves the mode; focused at quit, the last focused stored tab is restored.

**E2E**

- Turn on, share, connect through the panel with a stubbed confirm, start the built bridge with the copied setup's token, and see the session appear in the sidebar, its calls in Activity, and the checklist complete.
- With a shared Connection closed, an Agent's call raises a toast in Databases mode; Open connects it; the request leaves Needs you.

## 18. Definition of done

All eight gates in `CLAUDE.md` § Definition of done apply. Run the `spec-compliance-reviewer` agent against this spec, X27 §16 and X28 in the PR that ships them, and update each status line there.
