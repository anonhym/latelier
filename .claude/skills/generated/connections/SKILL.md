---
name: connections
description: "Skill for the Connections area of mongo-lab. 71 symbols across 17 files."
---

# Connections

71 symbols | 17 files | Cohesion: 72%

## When to Use

- Working with code in `src/`
- Understanding how isIpcError, disconnectConnection, invalidateSampleSchemaCache work
- Modifying connections-related functionality

## Key Files

| File | Symbols |
|------|---------|
| `src/features/connections/ConnectionForm.tsx` | toInput, toUpdate, Label, Field, Input (+26) |
| `src/features/connections/ConnectionSwitcher.tsx` | ConnectionRow, ConnectionSwitcher, optionId, handleOpenChange, close (+8) |
| `src/features/connections/ConnectionExpandedTable.tsx` | formatConnectionType, DetailField, ConnectionDetailRow, ConnectionExpandedTable, rowId (+1) |
| `src/pages/ConnectionManager.tsx` | confirmDisconnect, confirmDelete, TitleBar |
| `src/pages/Workspace/useConnectionDialogs.ts` | requestDisconnect, confirmDisconnectConnection, confirmDeleteConnection |
| `src/features/connections/ConnectionFormModal.tsx` | ConnectionFormModal, requestClose, onCancel |
| `src/pages/Workspace/ScriptTab.tsx` | runScript, onTabKeyDown |
| `src/api/atelier.ts` | isIpcError |
| `src/features/connections/disconnectConnection.ts` | disconnectConnection |
| `src/features/fieldSuggestions/sources/sampleSchemaSource.ts` | invalidateSampleSchemaCache |

## Entry Points

Start here when exploring this area:

- **`isIpcError`** (Function) — `src/api/atelier.ts:23`
- **`disconnectConnection`** (Function) — `src/features/connections/disconnectConnection.ts:10`
- **`invalidateSampleSchemaCache`** (Function) — `src/features/fieldSuggestions/sources/sampleSchemaSource.ts:107`
- **`confirmDisconnect`** (Function) — `src/pages/ConnectionManager.tsx:173`
- **`confirmDelete`** (Function) — `src/pages/ConnectionManager.tsx:189`

## Key Symbols

| Symbol | Type | File | Line |
|--------|------|------|------|
| `isIpcError` | Function | `src/api/atelier.ts` | 23 |
| `disconnectConnection` | Function | `src/features/connections/disconnectConnection.ts` | 10 |
| `invalidateSampleSchemaCache` | Function | `src/features/fieldSuggestions/sources/sampleSchemaSource.ts` | 107 |
| `confirmDisconnect` | Function | `src/pages/ConnectionManager.tsx` | 173 |
| `confirmDelete` | Function | `src/pages/ConnectionManager.tsx` | 189 |
| `onRunToStage` | Function | `src/pages/Workspace/Aggregation/AggregationTab.tsx` | 275 |
| `requestDisconnect` | Function | `src/pages/Workspace/useConnectionDialogs.ts` | 75 |
| `confirmDisconnectConnection` | Function | `src/pages/Workspace/useConnectionDialogs.ts` | 97 |
| `confirmDeleteConnection` | Function | `src/pages/Workspace/useConnectionDialogs.ts` | 171 |
| `TitleBarBackLink` | Function | `src/components/TitleBarBackLink.tsx` | 11 |
| `ConnectionForm` | Function | `src/features/connections/ConnectionForm.tsx` | 802 |
| `ConnectionFormModal` | Function | `src/features/connections/ConnectionFormModal.tsx` | 14 |
| `requestClose` | Function | `src/features/connections/ConnectionFormModal.tsx` | 23 |
| `onCancel` | Function | `src/features/connections/ConnectionFormModal.tsx` | 35 |
| `NewConnection` | Function | `src/pages/NewConnection.tsx` | 7 |
| `ConnectionExpandedTable` | Function | `src/features/connections/ConnectionExpandedTable.tsx` | 202 |
| `rowId` | Function | `src/features/connections/ConnectionExpandedTable.tsx` | 215 |
| `ConnectionSwitcher` | Function | `src/features/connections/ConnectionSwitcher.tsx` | 306 |
| `optionId` | Function | `src/features/connections/ConnectionSwitcher.tsx` | 330 |
| `handleOpenChange` | Function | `src/features/connections/ConnectionSwitcher.tsx` | 528 |

## Execution Flows

| Flow | Type | Steps |
|------|------|-------|
| `OnRunToStage → UnsupportedSyntax` | cross_community | 7 |
| `OnRunToStage → DropTrailingComma` | cross_community | 6 |
| `OnRunToStage → StripAcornPosition` | cross_community | 5 |
| `NewConnection → Error` | cross_community | 5 |
| `NewConnection → IsIpcError` | cross_community | 5 |
| `NewConnection → Set` | cross_community | 5 |
| `Body → Error` | cross_community | 5 |
| `Workspace → IsIpcError` | cross_community | 5 |
| `ConnectionManager → IsIpcError` | cross_community | 4 |
| `DialogStack → IsIpcError` | cross_community | 4 |

## Connected Areas

| Area | Connections |
|------|-------------|
| Workspace | 3 calls |
| Component | 2 calls |
| Commands | 2 calls |
| Views | 1 calls |
| Aggregation | 1 calls |
| Sources | 1 calls |

## How to Explore

1. `context({name: "isIpcError"})` — see callers and callees
2. `query({search_query: "connections"})` — find related execution flows
3. Read key files listed above for implementation details
4. `explain({target: "<file or symbol>"})` — persisted taint findings (source→sink data flows), when indexed with `--pdg`
