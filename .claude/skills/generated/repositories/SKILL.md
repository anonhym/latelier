---
name: repositories
description: "Skill for the Repositories area of mongo-lab. 14 symbols across 4 files."
---

# Repositories

14 symbols | 4 files | Cohesion: 73%

## When to Use

- Working with code in `electron/`
- Understanding how insert, updateState, findMatching work
- Modifying repositories-related functionality

## Key Files

| File | Symbols |
|------|---------|
| `electron/db/repositories/WorkspaceTabRepo.ts` | insert, updateState, findMatching, nextPosition |
| `electron/services/WorkspaceStateService.ts` | openCollection, openAggregation, parseState, mergeState |
| `electron/db/repositories/RecentQueryRepo.ts` | insert, countByConnection, deleteOldestByConnection |
| `electron/services/RecentQueryService.ts` | recordFind, recordAggregation, evictIfNeeded |

## Entry Points

Start here when exploring this area:

- **`insert`** (Method) — `electron/db/repositories/WorkspaceTabRepo.ts:97`
- **`updateState`** (Method) — `electron/db/repositories/WorkspaceTabRepo.ts:101`
- **`findMatching`** (Method) — `electron/db/repositories/WorkspaceTabRepo.ts:117`
- **`nextPosition`** (Method) — `electron/db/repositories/WorkspaceTabRepo.ts:130`
- **`openCollection`** (Method) — `electron/services/WorkspaceStateService.ts:66`

## Key Symbols

| Symbol | Type | File | Line |
|--------|------|------|------|
| `insert` | Method | `electron/db/repositories/WorkspaceTabRepo.ts` | 97 |
| `updateState` | Method | `electron/db/repositories/WorkspaceTabRepo.ts` | 101 |
| `findMatching` | Method | `electron/db/repositories/WorkspaceTabRepo.ts` | 117 |
| `nextPosition` | Method | `electron/db/repositories/WorkspaceTabRepo.ts` | 130 |
| `openCollection` | Method | `electron/services/WorkspaceStateService.ts` | 66 |
| `openAggregation` | Method | `electron/services/WorkspaceStateService.ts` | 121 |
| `insert` | Method | `electron/db/repositories/RecentQueryRepo.ts` | 91 |
| `countByConnection` | Method | `electron/db/repositories/RecentQueryRepo.ts` | 158 |
| `deleteOldestByConnection` | Method | `electron/db/repositories/RecentQueryRepo.ts` | 163 |
| `recordFind` | Method | `electron/services/RecentQueryService.ts` | 45 |
| `recordAggregation` | Method | `electron/services/RecentQueryService.ts` | 81 |
| `evictIfNeeded` | Method | `electron/services/RecentQueryService.ts` | 134 |
| `parseState` | Function | `electron/services/WorkspaceStateService.ts` | 307 |
| `mergeState` | Function | `electron/services/WorkspaceStateService.ts` | 319 |

## Execution Flows

| Flow | Type | Steps |
|------|------|-------|
| `RegisterQueryChannels → CountByConnection` | cross_community | 5 |
| `RegisterQueryChannels → DeleteOldestByConnection` | cross_community | 5 |
| `RegisterTabsChannels → ParseState` | cross_community | 4 |
| `RegisterTabsChannels → WithTransaction` | cross_community | 4 |
| `RegisterQueryChannels → Insert` | cross_community | 4 |
| `RegisterTabsChannels → FindMatching` | cross_community | 3 |
| `RegisterTabsChannels → UpdateState` | cross_community | 3 |

## Connected Areas

| Area | Connections |
|------|-------------|
| Services | 6 calls |

## How to Explore

1. `context({name: "insert"})` — see callers and callees
2. `query({search_query: "repositories"})` — find related execution flows
3. Read key files listed above for implementation details
4. `explain({target: "<file or symbol>"})` — persisted taint findings (source→sink data flows), when indexed with `--pdg`
