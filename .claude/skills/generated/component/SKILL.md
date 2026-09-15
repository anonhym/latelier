---
name: component
description: "Skill for the Component area of mongo-lab. 397 symbols across 131 files."
---

# Component

397 symbols | 131 files | Cohesion: 85%

## When to Use

- Working with code in `tests/`
- Understanding how EditDrawer, switchMode, installAtelierMock work
- Modifying component-related functionality

## Key Files

| File | Symbols |
|------|---------|
| `tests/component/workspace-tab-groups.spec.tsx` | mountTwoConnections, mountInterleaved, mountThreeConnections, mountWithUnresolved, mountWithDormant (+10) |
| `tests/component/query-bar-advanced-resync.spec.tsx` | b, makeState, makeMeta, tabA, tabB (+7) |
| `tests/component/connection-switcher.spec.tsx` | LocationProbe, mount, openSwitcher, openExpandedTable, conn (+5) |
| `tests/component/add-to-filter-menu.spec.tsx` | mountWith, makeState, makeActions, makeMeta, mount (+3) |
| `tests/component/builder-drag-merge-replace.spec.tsx` | mountWith, makeCollectionTab, updateSpy, list, rowEl (+2) |
| `tests/component/workspace-palette-connection-commands.spec.tsx` | conn, list, renderTwoConnectionsFocusedOnStaging, ContextProbe, ToggleButton (+2) |
| `tests/component/workspace-shell.spec.tsx` | openPicker, collectionTab, list, listCollections, coll (+2) |
| `tests/component/connection-palette-switch.spec.tsx` | NavigationTypeSpy, app, collectionTab, list, tabsList (+2) |
| `tests/component/table-view.spec.tsx` | emptyState, emptyActions, emptyMeta, renderTable, renderStatefulTable (+2) |
| `tests/component/query-bar-explain.spec.tsx` | mountWorkspace, mountWith, makeCollectionTab, list, update (+1) |

## Entry Points

Start here when exploring this area:

- **`EditDrawer`** (Function) — `src/pages/Workspace/EditDrawer.tsx:24`
- **`switchMode`** (Function) — `src/pages/Workspace/EditDrawer.tsx:153`
- **`installAtelierMock`** (Function) — `tests/helpers/atelierMock.ts:19`
- **`unused`** (Function) — `tests/helpers/atelierMock.ts:20`
- **`collectionTabFixture`** (Function) — `tests/helpers/atelierMock.ts:213`

## Key Symbols

| Symbol | Type | File | Line |
|--------|------|------|------|
| `EditDrawer` | Function | `src/pages/Workspace/EditDrawer.tsx` | 24 |
| `switchMode` | Function | `src/pages/Workspace/EditDrawer.tsx` | 153 |
| `installAtelierMock` | Function | `tests/helpers/atelierMock.ts` | 19 |
| `unused` | Function | `tests/helpers/atelierMock.ts` | 20 |
| `collectionTabFixture` | Function | `tests/helpers/atelierMock.ts` | 213 |
| `multiConnectionMock` | Function | `tests/helpers/atelierMock.ts` | 259 |
| `render` | Function | `tests/helpers/render.tsx` | 41 |
| `useRegisterCommands` | Function | `src/commands/useRegisterCommands.ts` | 12 |
| `App` | Function | `src/App.tsx` | 30 |
| `useTheme` | Function | `src/ThemeContext.tsx` | 29 |
| `toggle` | Function | `src/ThemeContext.tsx` | 84 |
| `usePaletteApi` | Function | `src/commands/CommandPalette.tsx` | 68 |
| `CommandPaletteRoot` | Function | `src/commands/CommandPalette.tsx` | 369 |
| `ConnectionPaletteCommands` | Function | `src/commands/ConnectionPaletteCommands.tsx` | 21 |
| `GlobalCommands` | Function | `src/commands/GlobalCommands.tsx` | 10 |
| `usePaletteContext` | Function | `src/commands/PaletteContext.tsx` | 11 |
| `PaletteContextProvider` | Function | `src/commands/PaletteContext.tsx` | 43 |
| `Splash` | Function | `src/components/Splash.tsx` | 12 |
| `ConnectionDisconnectDialog` | Function | `src/features/connections/ConnectionDisconnectDialog.tsx` | 13 |
| `ConnectionManager` | Function | `src/pages/ConnectionManager.tsx` | 80 |

## Execution Flows

| Flow | Type | Steps |
|------|------|-------|
| `ResultBar → IsExactSentinel` | cross_community | 8 |
| `ScriptTabInner → CollectionWorkspaceProvider` | cross_community | 6 |
| `ResultBar → IsPlainDocument` | cross_community | 6 |
| `Workspace → IsIpcError` | cross_community | 5 |
| `EditDrawer → PlainNumber` | cross_community | 5 |
| `EditDrawer → IsoDate` | cross_community | 5 |
| `EditDrawer → UnsupportedSyntax` | cross_community | 5 |
| `ConnectionManager → IsIpcError` | cross_community | 4 |
| `ConnectionManager → Notify` | intra_community | 4 |
| `NewConnection → UseTroubleshooting` | cross_community | 4 |

## Connected Areas

| Area | Connections |
|------|-------------|
| Workspace | 33 calls |
| Pages | 6 calls |
| Connections | 4 calls |
| Aggregation | 4 calls |
| Hints | 3 calls |
| Views | 3 calls |
| Troubleshooting | 1 calls |
| Sources | 1 calls |

## How to Explore

1. `context({name: "EditDrawer"})` — see callers and callees
2. `query({search_query: "component"})` — find related execution flows
3. Read key files listed above for implementation details
4. `explain({target: "<file or symbol>"})` — persisted taint findings (source→sink data flows), when indexed with `--pdg`
