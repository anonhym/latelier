---
name: mongo
description: "Skill for the Mongo area of mongo-lab. 242 symbols across 62 files."
---

# Mongo

242 symbols | 62 files | Cohesion: 80%

## When to Use

- Working with code in `electron/`
- Understanding how isUniqueConstraintError, registerAppChannels, registerCollectionAdminChannels work
- Modifying mongo-related functionality

## Key Files

| File | Symbols |
|------|---------|
| `electron/mongo/MongoPool.ts` | findById, isReadOnly, assertWritable, getClient, getDb (+15) |
| `electron/mongo/AggregationService.ts` | run, previewUpToStage, cancel, runAndSave, explain (+12) |
| `electron/mongo/ejson.ts` | ejsonParse, ejsonStringify, ejsonEncode, ejsonEncodeArrayJson, parseEjsonField (+10) |
| `electron/services/ScriptService.ts` | run, use, cancel, releaseToken, wrapSource (+9) |
| `electron/mongo/ConnectionService.ts` | list, get, create, update, delete (+9) |
| `electron/mongo/DocumentService.ts` | assertNonEmptyFilter, insert, insertMany, replace, updateOne (+8) |
| `electron/db/repositories/ConnectionRepo.ts` | insert, update, deleteById, findById, findByName (+6) |
| `electron/mongo/UserService.ts` | list, get, create, update, drop (+6) |
| `electron/mongo/dbProxy.ts` | makeDbProxy, readOnlyDenied, pipelineHasWriteStage, getDb, get (+3) |
| `electron/services/SavedQueryService.ts` | list, get, create, update, duplicate (+3) |

## Entry Points

Start here when exploring this area:

- **`isUniqueConstraintError`** (Function) — `electron/db/sqliteErrors.ts:7`
- **`registerAppChannels`** (Function) — `electron/ipc/handlers/app.ts:33`
- **`registerCollectionAdminChannels`** (Function) — `electron/ipc/handlers/collectionAdmin.ts:39`
- **`registerDocChannels`** (Function) — `electron/ipc/handlers/doc.ts:32`
- **`registerIndexChannels`** (Function) — `electron/ipc/handlers/indexes.ts:35`

## Key Symbols

| Symbol | Type | File | Line |
|--------|------|------|------|
| `AppError` | Class | `electron/errors.ts` | 20 |
| `ValidationError` | Class | `electron/errors.ts` | 32 |
| `ConflictError` | Class | `electron/errors.ts` | 46 |
| `SystemError` | Class | `electron/errors.ts` | 65 |
| `MongoOpError` | Class | `electron/errors.ts` | 72 |
| `ReadOnlyConnectionError` | Class | `electron/errors.ts` | 58 |
| `ConnectionRepo` | Class | `electron/db/repositories/ConnectionRepo.ts` | 49 |
| `ConnectionService` | Class | `electron/mongo/ConnectionService.ts` | 28 |
| `MetaService` | Class | `electron/mongo/MetaService.ts` | 37 |
| `DocumentService` | Class | `electron/mongo/DocumentService.ts` | 64 |
| `isUniqueConstraintError` | Function | `electron/db/sqliteErrors.ts` | 7 |
| `registerAppChannels` | Function | `electron/ipc/handlers/app.ts` | 33 |
| `registerCollectionAdminChannels` | Function | `electron/ipc/handlers/collectionAdmin.ts` | 39 |
| `registerDocChannels` | Function | `electron/ipc/handlers/doc.ts` | 32 |
| `registerIndexChannels` | Function | `electron/ipc/handlers/indexes.ts` | 35 |
| `registerMetaChannels` | Function | `electron/ipc/handlers/meta.ts` | 20 |
| `registerMshellChannels` | Function | `electron/ipc/handlers/mshell.ts` | 19 |
| `registerPrefsChannels` | Function | `electron/ipc/handlers/prefs.ts` | 22 |
| `registerQueryChannels` | Function | `electron/ipc/handlers/query.ts` | 42 |
| `registerRecentChannels` | Function | `electron/ipc/handlers/recent.ts` | 26 |

## Execution Flows

| Flow | Type | Steps |
|------|------|-------|
| `RegisterAggChannels → FindById` | cross_community | 7 |
| `RegisterAggChannels → SystemError` | cross_community | 6 |
| `RegisterIndexChannels → FindById` | cross_community | 6 |
| `RegisterQueryChannels → SystemError` | intra_community | 5 |
| `RegisterQueryChannels → CountByConnection` | cross_community | 5 |
| `RegisterQueryChannels → DeleteOldestByConnection` | cross_community | 5 |
| `RegisterDocChannels → SystemError` | intra_community | 5 |
| `RegisterMshellChannels → FindById` | cross_community | 5 |
| `RegisterMshellChannels → Status` | cross_community | 5 |
| `RegisterUserChannels → FindById` | cross_community | 5 |

## Connected Areas

| Area | Connections |
|------|-------------|
| Services | 23 calls |
| Secrets | 6 calls |
| Integration | 6 calls |
| Repositories | 4 calls |
| Electron | 2 calls |

## How to Explore

1. `context({name: "isUniqueConstraintError"})` — see callers and callees
2. `query({search_query: "mongo"})` — find related execution flows
3. Read key files listed above for implementation details
4. `explain({target: "<file or symbol>"})` — persisted taint findings (source→sink data flows), when indexed with `--pdg`
