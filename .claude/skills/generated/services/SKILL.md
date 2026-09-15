---
name: services
description: "Skill for the Services area of mongo-lab. 68 symbols across 21 files."
---

# Services

68 symbols | 21 files | Cohesion: 80%

## When to Use

- Working with code in `electron/`
- Understanding how withTransaction, registerTabsChannels, redactSecrets work
- Modifying services-related functionality

## Key Files

| File | Symbols |
|------|---------|
| `electron/services/ReferenceRulesService.ts` | delete, singularize, pluralize, detectCandidateFieldsFromDocs, walk (+7) |
| `electron/services/WorkspaceStateService.ts` | list, get, openScript, openDefault, update (+6) |
| `electron/services/DiagnosticService.ts` | list, build, serialize, appMetadata, redactedConnections (+3) |
| `electron/db/repositories/WorkspaceTabRepo.ts` | setPinned, retargetCollection, deleteById, findById, list (+2) |
| `electron/services/AppStateService.ts` | set, delete, subscribe, emit |
| `electron/db/repositories/ReferenceRulesRepo.ts` | deleteById, listForCollection, update |
| `tests/integration/mongo-handlers.spec.ts` | fakeRuntime, connect, status |
| `electron/db/repositories/RecentQueryRepo.ts` | findById, deleteOlderThan |
| `electron/services/RecentQueryService.ts` | get, rowToRecentQuery |
| `electron/log.ts` | redactSecrets, walk |

## Entry Points

Start here when exploring this area:

- **`withTransaction`** (Function) — `electron/db/sqlite.ts:40`
- **`registerTabsChannels`** (Function) — `electron/ipc/handlers/tabs.ts:102`
- **`redactSecrets`** (Function) — `electron/log.ts:26`
- **`detectCandidateFieldsFromDocs`** (Function) — `electron/services/ReferenceRulesService.ts:60`
- **`walk`** (Function) — `electron/services/ReferenceRulesService.ts:64`

## Key Symbols

| Symbol | Type | File | Line |
|--------|------|------|------|
| `NotFoundError` | Class | `electron/errors.ts` | 39 |
| `withTransaction` | Function | `electron/db/sqlite.ts` | 40 |
| `registerTabsChannels` | Function | `electron/ipc/handlers/tabs.ts` | 102 |
| `redactSecrets` | Function | `electron/log.ts` | 26 |
| `detectCandidateFieldsFromDocs` | Function | `electron/services/ReferenceRulesService.ts` | 60 |
| `walk` | Function | `electron/services/ReferenceRulesService.ts` | 64 |
| `printjson` | Function | `electron/services/ScriptService.ts` | 154 |
| `findById` | Method | `electron/db/repositories/RecentQueryRepo.ts` | 95 |
| `deleteById` | Method | `electron/db/repositories/ReferenceRulesRepo.ts` | 158 |
| `deleteById` | Method | `electron/db/repositories/SavedQueryRepo.ts` | 109 |
| `setPinned` | Method | `electron/db/repositories/WorkspaceTabRepo.ts` | 82 |
| `retargetCollection` | Method | `electron/db/repositories/WorkspaceTabRepo.ts` | 93 |
| `deleteById` | Method | `electron/db/repositories/WorkspaceTabRepo.ts` | 105 |
| `findById` | Method | `electron/db/repositories/WorkspaceTabRepo.ts` | 109 |
| `list` | Method | `electron/db/repositories/WorkspaceTabRepo.ts` | 113 |
| `setActiveExclusive` | Method | `electron/db/repositories/WorkspaceTabRepo.ts` | 138 |
| `reorder` | Method | `electron/db/repositories/WorkspaceTabRepo.ts` | 153 |
| `get` | Method | `electron/services/RecentQueryService.ts` | 112 |
| `delete` | Method | `electron/services/ReferenceRulesService.ts` | 147 |
| `delete` | Method | `electron/services/SavedQueryService.ts` | 58 |

## Execution Flows

| Flow | Type | Steps |
|------|------|-------|
| `RegisterTabsChannels → ParseState` | cross_community | 4 |
| `RegisterTabsChannels → WithTransaction` | cross_community | 4 |
| `RegisterPrefsChannels → Delete` | cross_community | 4 |
| `RegisterPrefsChannels → Emit` | cross_community | 4 |
| `RegisterRefsChannels → ListForCollection` | cross_community | 3 |
| `RegisterTabsChannels → List` | intra_community | 3 |
| `RegisterTabsChannels → FindMatching` | cross_community | 3 |
| `RegisterTabsChannels → UpdateState` | cross_community | 3 |
| `RegisterSavedChannels → NotFoundError` | cross_community | 3 |
| `RegisterConnChannels → NotFoundError` | cross_community | 3 |

## Connected Areas

| Area | Connections |
|------|-------------|
| Mongo | 17 calls |
| Repositories | 10 calls |

## How to Explore

1. `context({name: "withTransaction"})` — see callers and callees
2. `query({search_query: "services"})` — find related execution flows
3. Read key files listed above for implementation details
4. `explain({target: "<file or symbol>"})` — persisted taint findings (source→sink data flows), when indexed with `--pdg`
