---
name: pages
description: "Skill for the Pages area of mongo-lab. 105 symbols across 23 files."
---

# Pages

105 symbols | 23 files | Cohesion: 77%

## When to Use

- Working with code in `src/`
- Understanding how IndexesTab, loadDatabases, loadCollections work
- Modifying pages-related functionality

## Key Files

| File | Symbols |
|------|---------|
| `src/pages/IndexesTab.tsx` | humanBytes, humanCount, humanTtl, renderKey, indexBadges (+16) |
| `src/pages/UsersTab.tsx` | RoleBadge, shortMech, isSelfRow, UsersTab, loadDatabases (+12) |
| `tests/e2e/pages/ConnectionSwitcherPage.ts` | item, ensureOpen, waitClosed, disconnect, waitVisible (+12) |
| `src/pages/DetailPanel.tsx` | humanBytes, humanDuration, KVRow, OverviewCard, OverviewTab (+7) |
| `tests/e2e/pages/WorkspacePage.ts` | constructor, dbRow, collectionRow, tabByName, waitForDb (+1) |
| `src/pages/ConnectionManager.tsx` | fetchTabCount, openDeleteConfirm, openDisconnectConfirm, perform, handleDelete (+1) |
| `src/pages/Workspace.tsx` | restoreBuilderWidth, toggleBuilder, expandBuilder, toggleBuilderWithFocus, handler |
| `tests/e2e/helpers/uiSeed.ts` | seedConnection, chooseInSwitcher, seedActiveConnection, seedActiveConnectionWithDocs |
| `src/pages/SettingsModal.tsx` | handleResetHints, handleExportDiagnostic |
| `tests/e2e/pages/NewConnectionPage.ts` | clickTab, selectAuthMechanism |

## Entry Points

Start here when exploring this area:

- **`IndexesTab`** (Function) — `src/pages/IndexesTab.tsx:108`
- **`loadDatabases`** (Function) — `src/pages/IndexesTab.tsx:145`
- **`loadCollections`** (Function) — `src/pages/IndexesTab.tsx:159`
- **`loadIndexes`** (Function) — `src/pages/IndexesTab.tsx:175`
- **`onPickDb`** (Function) — `src/pages/IndexesTab.tsx:232`

## Key Symbols

| Symbol | Type | File | Line |
|--------|------|------|------|
| `ConnectionSwitcherPage` | Class | `tests/e2e/pages/ConnectionSwitcherPage.ts` | 14 |
| `IndexesTab` | Function | `src/pages/IndexesTab.tsx` | 108 |
| `loadDatabases` | Function | `src/pages/IndexesTab.tsx` | 145 |
| `loadCollections` | Function | `src/pages/IndexesTab.tsx` | 159 |
| `loadIndexes` | Function | `src/pages/IndexesTab.tsx` | 175 |
| `onPickDb` | Function | `src/pages/IndexesTab.tsx` | 232 |
| `onPickCollection` | Function | `src/pages/IndexesTab.tsx` | 244 |
| `UsersTab` | Function | `src/pages/UsersTab.tsx` | 73 |
| `loadDatabases` | Function | `src/pages/UsersTab.tsx` | 109 |
| `loadUsers` | Function | `src/pages/UsersTab.tsx` | 123 |
| `onPickDb` | Function | `src/pages/UsersTab.tsx` | 156 |
| `expectStatusDot` | Function | `tests/e2e/helpers/uiAsserts.ts` | 20 |
| `seedConnection` | Function | `tests/e2e/helpers/uiSeed.ts` | 37 |
| `seedActiveConnection` | Function | `tests/e2e/helpers/uiSeed.ts` | 77 |
| `seedActiveConnectionWithDocs` | Function | `tests/e2e/helpers/uiSeed.ts` | 138 |
| `groupTabsByConnection` | Function | `src/pages/Workspace/tabGroups.ts` | 58 |
| `groups` | Function | `src/pages/Workspace/TabStrip.tsx` | 144 |
| `fetchTabCount` | Function | `src/pages/ConnectionManager.tsx` | 102 |
| `openDeleteConfirm` | Function | `src/pages/ConnectionManager.tsx` | 116 |
| `openDisconnectConfirm` | Function | `src/pages/ConnectionManager.tsx` | 123 |

## Execution Flows

| Flow | Type | Steps |
|------|------|-------|
| `OnSave → UnsupportedSyntax` | cross_community | 7 |
| `OnSave → DropTrailingComma` | cross_community | 6 |
| `OnSave → StripAcornPosition` | cross_community | 5 |
| `Body → Success` | cross_community | 5 |
| `CollectionsTab → IsIpcError` | cross_community | 4 |
| `Handler → RestoreBuilderWidth` | intra_community | 4 |
| `OnClick → Success` | cross_community | 3 |

## Connected Areas

| Area | Connections |
|------|-------------|
| Connections | 12 calls |
| Workspace | 12 calls |
| Component | 9 calls |
| Views | 2 calls |
| Aggregation | 1 calls |

## How to Explore

1. `context({name: "IndexesTab"})` — see callers and callees
2. `query({search_query: "pages"})` — find related execution flows
3. Read key files listed above for implementation details
4. `explain({target: "<file or symbol>"})` — persisted taint findings (source→sink data flows), when indexed with `--pdg`
