---
name: state
description: "Skill for the State area of mongo-lab. 19 symbols across 3 files."
---

# State

19 symbols | 3 files | Cohesion: 94%

## When to Use

- Working with code in `src/`
- Understanding how useWorkspaceTabs, refresh, openCollection work
- Modifying state-related functionality

## Key Files

| File | Symbols |
|------|---------|
| `src/state/workspaceTabs.ts` | useWorkspaceTabs, refresh, openCollection, openAggregation, openScript (+11) |
| `src/state/connections.ts` | mapRuntimeStatus, off |
| `tests/component/workspace-tabs-noop.spec.tsx` | hook |

## Entry Points

Start here when exploring this area:

- **`useWorkspaceTabs`** (Function) — `src/state/workspaceTabs.ts:141`
- **`refresh`** (Function) — `src/state/workspaceTabs.ts:169`
- **`openCollection`** (Function) — `src/state/workspaceTabs.ts:187`
- **`openAggregation`** (Function) — `src/state/workspaceTabs.ts:225`
- **`openScript`** (Function) — `src/state/workspaceTabs.ts:234`

## Key Symbols

| Symbol | Type | File | Line |
|--------|------|------|------|
| `useWorkspaceTabs` | Function | `src/state/workspaceTabs.ts` | 141 |
| `refresh` | Function | `src/state/workspaceTabs.ts` | 169 |
| `openCollection` | Function | `src/state/workspaceTabs.ts` | 187 |
| `openAggregation` | Function | `src/state/workspaceTabs.ts` | 225 |
| `openScript` | Function | `src/state/workspaceTabs.ts` | 234 |
| `close` | Function | `src/state/workspaceTabs.ts` | 243 |
| `closeForConnection` | Function | `src/state/workspaceTabs.ts` | 251 |
| `closeForNamespace` | Function | `src/state/workspaceTabs.ts` | 277 |
| `retargetCollection` | Function | `src/state/workspaceTabs.ts` | 307 |
| `scheduleFlush` | Function | `src/state/workspaceTabs.ts` | 378 |
| `patchCollectionState` | Function | `src/state/workspaceTabs.ts` | 396 |
| `patchCollectionStateWith` | Function | `src/state/workspaceTabs.ts` | 423 |
| `setActiveView` | Function | `src/state/workspaceTabs.ts` | 458 |
| `patchAggregationState` | Function | `src/state/workspaceTabs.ts` | 465 |
| `patchScriptState` | Function | `src/state/workspaceTabs.ts` | 501 |
| `off` | Function | `src/state/connections.ts` | 96 |
| `hook` | Function | `tests/component/workspace-tabs-noop.spec.tsx` | 93 |
| `isNoOpPatch` | Function | `src/state/workspaceTabs.ts` | 131 |
| `mapRuntimeStatus` | Function | `src/state/connections.ts` | 8 |

## Execution Flows

| Flow | Type | Steps |
|------|------|-------|
| `Workspace → IsIpcError` | cross_community | 5 |

## Connected Areas

| Area | Connections |
|------|-------------|
| Connections | 1 calls |
| Views | 1 calls |

## How to Explore

1. `context({name: "useWorkspaceTabs"})` — see callers and callees
2. `query({search_query: "state"})` — find related execution flows
3. Read key files listed above for implementation details
4. `explain({target: "<file or symbol>"})` — persisted taint findings (source→sink data flows), when indexed with `--pdg`
