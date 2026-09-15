---
name: electron
description: "Skill for the Electron area of mongo-lab. 86 symbols across 8 files."
---

# Electron

86 symbols | 8 files | Cohesion: 96%

## When to Use

- Working with code in `electron/`
- Understanding how closeDatabase, cleanup, filePath work
- Modifying electron-related functionality

## Key Files

| File | Symbols |
|------|---------|
| `electron/preload.ts` | invoke, call, parseFindResult, parseAggResult, list (+57) |
| `electron/log.ts` | todayStamp, filePath, write, debug, info (+4) |
| `electron/main.ts` | boundsAreOnScreen, backgroundForTheme, contentSecurityPolicy, hardenWindow, createWindow (+3) |
| `electron/db/repositories/AppStateRepo.ts` | get, AppStateRepo |
| `electron/services/AppStateService.ts` | get, AppStateService |
| `electron/db/sqlite.ts` | closeDatabase |
| `tests/helpers/db.ts` | cleanup |
| `tests/integration/app-state-service.spec.ts` | svc |

## Entry Points

Start here when exploring this area:

- **`closeDatabase`** (Function) — `electron/db/sqlite.ts:32`
- **`cleanup`** (Function) — `tests/helpers/db.ts:41`
- **`filePath`** (Function) — `electron/log.ts:100`
- **`write`** (Function) — `electron/log.ts:102`
- **`debug`** (Function) — `electron/log.ts:121`

## Key Symbols

| Symbol | Type | File | Line |
|--------|------|------|------|
| `AppStateRepo` | Class | `electron/db/repositories/AppStateRepo.ts` | 12 |
| `AppStateService` | Class | `electron/services/AppStateService.ts` | 9 |
| `closeDatabase` | Function | `electron/db/sqlite.ts` | 32 |
| `cleanup` | Function | `tests/helpers/db.ts` | 41 |
| `filePath` | Function | `electron/log.ts` | 100 |
| `write` | Function | `electron/log.ts` | 102 |
| `debug` | Function | `electron/log.ts` | 121 |
| `info` | Function | `electron/log.ts` | 122 |
| `warn` | Function | `electron/log.ts` | 123 |
| `error` | Function | `electron/log.ts` | 124 |
| `createLogger` | Function | `electron/log.ts` | 83 |
| `get` | Method | `electron/db/repositories/AppStateRepo.ts` | 29 |
| `get` | Method | `electron/services/AppStateService.ts` | 19 |
| `invoke` | Function | `electron/preload.ts` | 10 |
| `call` | Function | `electron/preload.ts` | 14 |
| `parseFindResult` | Function | `electron/preload.ts` | 23 |
| `parseAggResult` | Function | `electron/preload.ts` | 31 |
| `list` | Function | `electron/preload.ts` | 40 |
| `get` | Function | `electron/preload.ts` | 41 |
| `create` | Function | `electron/preload.ts` | 42 |

## Connected Areas

| Area | Connections |
|------|-------------|
| Mongo | 1 calls |
| Db | 1 calls |
| Services | 1 calls |
| Integration | 1 calls |

## How to Explore

1. `context({name: "closeDatabase"})` — see callers and callees
2. `query({search_query: "electron"})` — find related execution flows
3. Read key files listed above for implementation details
4. `explain({target: "<file or symbol>"})` — persisted taint findings (source→sink data flows), when indexed with `--pdg`
