---
name: integration
description: "Skill for the Integration area of mongo-lab. 55 symbols across 27 files."
---

# Integration

55 symbols | 27 files | Cohesion: 86%

## When to Use

- Working with code in `tests/`
- Understanding how createTempDb, makeConnection, makeReader work
- Modifying integration-related functionality

## Key Files

| File | Symbols |
|------|---------|
| `tests/integration/script-service.spec.ts` | setup, abortableSleep, toArray, forEach, next (+2) |
| `tests/integration/conn-handlers.spec.ts` | stubSvc, setupWith, fakeConnection, get, create (+2) |
| `tests/integration/mongo-pool.spec.ts` | clientFactory, makeFake, makeFakeLog, push |
| `tests/helpers/db.ts` | loadMigrationsFromDisk, createTempDb |
| `tests/helpers/mongo.ts` | makeConnection, makeReader |
| `tests/integration/collection-admin-service.spec.ts` | setup, setupGuard |
| `tests/integration/index-service.spec.ts` | setup, setupGuard |
| `tests/integration/user-service.spec.ts` | setup, setupGuard |
| `tests/integration/recent-handlers.spec.ts` | createShim, setup |
| `tests/integration/user-handlers.spec.ts` | stubSvc, setupWith |

## Entry Points

Start here when exploring this area:

- **`createTempDb`** (Function) — `tests/helpers/db.ts:32`
- **`makeConnection`** (Function) — `tests/helpers/mongo.ts:34`
- **`makeReader`** (Function) — `tests/helpers/mongo.ts:66`
- **`createSafeStorageMock`** (Function) — `tests/helpers/safeStorageMock.ts:6`
- **`createRouter`** (Function) — `electron/ipc/router.ts:66`

## Key Symbols

| Symbol | Type | File | Line |
|--------|------|------|------|
| `CollectionAdminService` | Class | `electron/mongo/CollectionAdminService.ts` | 18 |
| `IndexService` | Class | `electron/mongo/IndexService.ts` | 45 |
| `MongoPool` | Class | `electron/mongo/MongoPool.ts` | 125 |
| `UserService` | Class | `electron/mongo/UserService.ts` | 35 |
| `SecretsVault` | Class | `electron/secrets/SecretsVault.ts` | 31 |
| `PreviewFieldsRepo` | Class | `electron/db/repositories/PreviewFieldsRepo.ts` | 11 |
| `PreviewFieldsService` | Class | `electron/services/PreviewFieldsService.ts` | 8 |
| `createTempDb` | Function | `tests/helpers/db.ts` | 32 |
| `makeConnection` | Function | `tests/helpers/mongo.ts` | 34 |
| `makeReader` | Function | `tests/helpers/mongo.ts` | 66 |
| `createSafeStorageMock` | Function | `tests/helpers/safeStorageMock.ts` | 6 |
| `createRouter` | Function | `electron/ipc/router.ts` | 66 |
| `loadMigrationsFromDisk` | Function | `tests/helpers/db.ts` | 10 |
| `setup` | Function | `tests/integration/collection-admin-service.spec.ts` | 40 |
| `setupGuard` | Function | `tests/integration/collection-admin-service.spec.ts` | 320 |
| `setup` | Function | `tests/integration/document-service.spec.ts` | 52 |
| `setup` | Function | `tests/integration/index-service.spec.ts` | 65 |
| `setupGuard` | Function | `tests/integration/index-service.spec.ts` | 235 |
| `setup` | Function | `tests/integration/script-service.spec.ts` | 652 |
| `setup` | Function | `tests/integration/user-service.spec.ts` | 84 |

## Connected Areas

| Area | Connections |
|------|-------------|
| Mongo | 7 calls |
| Electron | 4 calls |
| Db | 1 calls |
| Services | 1 calls |

## How to Explore

1. `context({name: "createTempDb"})` — see callers and callees
2. `query({search_query: "integration"})` — find related execution flows
3. Read key files listed above for implementation details
4. `explain({target: "<file or symbol>"})` — persisted taint findings (source→sink data flows), when indexed with `--pdg`
