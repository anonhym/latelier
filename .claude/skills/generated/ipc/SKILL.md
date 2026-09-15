---
name: ipc
description: "Skill for the Ipc area of mongo-lab. 8 symbols across 3 files."
---

# Ipc

8 symbols | 3 files | Cohesion: 100%

## When to Use

- Working with code in `electron/`
- Understanding how success, toIpcError, isTrustedSender work
- Modifying ipc-related functionality

## Key Files

| File | Symbols |
|------|---------|
| `electron/ipc/envelope.ts` | success, toIpcError, safeString |
| `electron/ipc/router.ts` | compactField, summarizeRequest, register |
| `electron/ipc/senderGuard.ts` | isTrustedSender, handle |

## Entry Points

Start here when exploring this area:

- **`success`** (Function) — `electron/ipc/envelope.ts:4`
- **`toIpcError`** (Function) — `electron/ipc/envelope.ts:17`
- **`isTrustedSender`** (Function) — `electron/ipc/senderGuard.ts:25`
- **`register`** (Method) — `electron/ipc/router.ts:68`
- **`handle`** (Method) — `electron/ipc/senderGuard.ts:59`

## Key Symbols

| Symbol | Type | File | Line |
|--------|------|------|------|
| `success` | Function | `electron/ipc/envelope.ts` | 4 |
| `toIpcError` | Function | `electron/ipc/envelope.ts` | 17 |
| `isTrustedSender` | Function | `electron/ipc/senderGuard.ts` | 25 |
| `register` | Method | `electron/ipc/router.ts` | 68 |
| `handle` | Method | `electron/ipc/senderGuard.ts` | 59 |
| `safeString` | Function | `electron/ipc/envelope.ts` | 57 |
| `compactField` | Function | `electron/ipc/router.ts` | 25 |
| `summarizeRequest` | Function | `electron/ipc/router.ts` | 52 |

## How to Explore

1. `context({name: "success"})` — see callers and callees
2. `query({search_query: "ipc"})` — find related execution flows
3. Read key files listed above for implementation details
4. `explain({target: "<file or symbol>"})` — persisted taint findings (source→sink data flows), when indexed with `--pdg`
