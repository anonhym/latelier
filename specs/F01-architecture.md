# F01 — Architecture & conventions

## Purpose

Lock the cross-cutting technical decisions so every other spec can reference them by name instead of re-deriving them. Anyone implementing any spec must read this one first.

## Scope

- **In**: process topology, folder layout, module boundaries, build pipeline, test stack, conventions (naming, types, logging, errors).
- **Out**: concrete schemas, specific IPC channels, UI layouts — those live in their own specs.

## Dependencies

None. This is the root.

## 1. Process topology

```
┌───────────────────────────────────────────────────────────────────┐
│                       Electron main process                        │
│                                                                   │
│  ┌────────────┐  ┌─────────────┐  ┌──────────────┐ ┌─────────────┐│
│  │ SQLite     │  │ SecretsVault│  │ MongoPool    │ │ IpcRouter   ││
│  │ (F02)      │  │ (F03)       │  │ (F05)        │ │ (F04)       ││
│  └────────────┘  └─────────────┘  └──────────────┘ └─────────────┘│
│         ▲                ▲                ▲              ▲        │
│         └────────────────┴────────────────┴──────────────┘        │
│                                 │                                  │
│                          ┌──────┴───────┐                          │
│                          │  Services    │                          │
│                          │ ConnectionSvc│                          │
│                          │ QuerySvc     │                          │
│                          │ AggregationS │                          │
│                          │ SavedSvc     │                          │
│                          │ StateSvc     │                          │
│                          └──────┬───────┘                          │
└─────────────────────────────────┼──────────────────────────────────┘
                                  │  contextBridge
                           window.atelier (F04)
                                  │
┌─────────────────────────────────┼──────────────────────────────────┐
│                        Renderer (React)                            │
│                                                                    │
│  pages/ ConnectionManager, NewConnection, Workspace, Aggregation   │
│  components/ Btn, Icons, DocTreeView, Builder, …                   │
│  state/ React context + hooks (NO direct Node imports)             │
└────────────────────────────────────────────────────────────────────┘
```

**Rules:**
- Renderer imports only: React, React DOM, React Router, local renderer code.
- Renderer NEVER imports from `electron/`, `mongodb`, `better-sqlite3`, `ssh2`, `fs`, `path`, `os`, or any main-only package.
- Main process modules are organized into **repositories** (pure DB access), **services** (business logic, can orchestrate multiple repos + external I/O), and **routers** (thin IPC adapters that map channel names to service calls and validate payloads).
- Services are instantiated once at app start and injected into the router.

## 2. Folder layout

```
mongo-lab/
├── electron/                  # main-process code (compiled by Vite)
│   ├── main.ts                # entry: creates window, wires services, router
│   ├── preload.ts             # contextBridge exposure (F04)
│   ├── ipc/
│   │   ├── router.ts          # registers all ipcMain.handle(...) bindings
│   │   ├── envelope.ts        # { ok, data, error } shape + helpers
│   │   └── validators.ts      # runtime validation (Zod)
│   ├── db/
│   │   ├── sqlite.ts          # opens DB, runs migrations
│   │   ├── migrations/        # 001-init.sql, 002-…, …
│   │   └── repositories/
│   │       ├── ConnectionRepo.ts
│   │       ├── SavedQueryRepo.ts
│   │       ├── RecentQueryRepo.ts
│   │       ├── WorkspaceTabRepo.ts
│   │       └── AppStateRepo.ts
│   ├── secrets/
│   │   └── SecretsVault.ts
│   ├── mongo/
│   │   ├── MongoPool.ts
│   │   ├── ConnectionService.ts
│   │   ├── QueryService.ts
│   │   ├── AggregationService.ts
│   │   └── ejson.ts           # EJSON ↔ plain wire helpers
│   ├── services/
│   │   ├── SavedQueryService.ts
│   │   ├── RecentQueryService.ts
│   │   ├── WorkspaceStateService.ts
│   │   └── AppStateService.ts
│   └── log.ts                 # winston or pino wrapper
│
├── src/                       # renderer
│   ├── main.tsx               # React entry
│   ├── App.tsx                # routes
│   ├── pages/                 # ConnectionManager, NewConnection, Workspace, Aggregation
│   ├── components/            # reusable UI
│   ├── state/                 # React context + hooks (theme, connections, tabs)
│   ├── api/
│   │   └── atelier.ts         # typed wrapper around window.atelier (auto-inferred from shared types)
│   ├── hooks/
│   ├── icons.tsx
│   ├── tokens.ts              # LIGHT/DARK theme tokens (exists)
│   ├── ThemeContext.tsx
│   └── utils/
│
├── shared/                    # types used by BOTH main and renderer
│   ├── types.ts               # Connection, SavedQuery, Cond, Stage, etc.
│   └── ipc.ts                 # IpcApi interface (contract)
│
├── specs/                     # this directory
├── tests/
│   ├── unit/                  # Vitest, runs in Node
│   ├── integration/           # Vitest with real SQLite + mongodb-memory-server
│   ├── component/             # Vitest + React Testing Library + mocked window.atelier
│   └── e2e/                   # Playwright + Electron
│
├── package.json
├── vite.config.ts
└── tsconfig*.json
```

`shared/` is included by both renderer (via TypeScript path alias `@shared/*`) and main. It must contain **types only** — no runtime code — so the renderer never drags in Node APIs through it.

## 3. Build pipeline

- **Vite** builds the renderer to `dist/`.
- **vite-plugin-electron** (already installed) builds `electron/main.ts` → `dist-electron/main.js` and `electron/preload.ts` → `dist-electron/preload.js`.
- `tsc -b` type-checks both projects via `tsconfig.app.json` (renderer) and a new `tsconfig.electron.json` (main).
- `tsconfig.json` references both projects so a single `tsc -b` checks everything.
- Path aliases: `@shared/*` → `./shared/*`, `@/*` → `./src/*`.
- `npm run electron:dev` runs Vite + Electron in watch mode. `npm run electron:build` produces an installer via `electron-builder`.

## 4. Module boundaries & conventions

### Naming
- Services: `XxxService` (e.g., `ConnectionService`). Expose methods, not direct state.
- Repositories: `XxxRepo`. Pure SQL wrappers, synchronous where possible (`better-sqlite3` is sync).
- IDs: always string UUIDs (`crypto.randomUUID()`). Never autoincrement integers for user-visible rows.
- Timestamps: stored as ISO-8601 strings in SQLite (`TEXT`).
- Enums: TypeScript string-literal unions, mirrored as `TEXT CHECK(...)` in SQL.

### Errors
- All main-side code throws `AppError` subclasses (`ValidationError`, `NotFoundError`, `ConflictError`, `MongoError`, `SystemError`). Each carries a `code` (string, stable) and a `message` (human). The IPC envelope translates them to `{ ok: false, error: { code, message, details } }`.
- Renderer never sees a raw `Error`. It switches on `error.code` for UX branching.

### Logging
- A single `log.ts` in main exposes `log.debug|info|warn|error(tag, msg, data?)`. Sinks: stderr + `userData/logs/mongolab.<date>.log` (rotated daily, 7-day retention).
- No `console.log` in shipped code.

### Types
- `strict: true` everywhere. No `any` in committed code; `unknown` is acceptable at boundaries with immediate narrowing.
- Shared types live in `shared/types.ts`. Main and renderer both import from `@shared/types`.

## 5. Test stack

### Unit (`tests/unit/`)
- **Framework**: Vitest.
- **Target**: pure functions and classes with zero external I/O (URI parser, MQL compiler, query builder reducer, EJSON round-trip).
- **Run**: `npm run test:unit`.

### Integration (`tests/integration/`)
- **Framework**: Vitest.
- **Target**: main-process services against real SQLite (temp file) and `mongodb-memory-server` for Mongo-touching code.
- **Fixtures**: `tests/helpers/db.ts` creates a fresh DB per test. `tests/helpers/mongo.ts` spins up an ephemeral Mongo.
- **Run**: `npm run test:integration`.

### Component (`tests/component/`)
- **Framework**: Vitest + `@testing-library/react` + jsdom.
- **Target**: React components with a mocked `window.atelier`. Each test provides a stub bridge.
- **Run**: `npm run test:component`.

### E2E (`tests/e2e/`)
- **Framework**: Playwright with Electron driver (`_electron.launch`).
- **Target**: full flows (create connection → save → open workspace → run query → view result).
- **Data**: each test launches a fresh userData dir via `ELECTRON_USER_DATA_DIR=...`. App is pointed at a throwaway `mongodb-memory-server` started by the test harness.
- **Run**: `npm run test:e2e`.

`npm test` runs unit + integration + component. E2E runs in CI on a separate job.

## 6. IPC conventions

See F04 for the full contract. Highlights:
- Channel names use `domain:verb` (e.g., `conn:list`, `query:find`, `saved:create`).
- Every channel returns `Promise<Envelope<T>>`.
- Renderer awaits and unwraps via a helper that throws on `ok: false`, letting callers `try/catch` and branch on `error.code`.

## 7. Dependency additions required

```json
{
  "dependencies": {
    "better-sqlite3": "^11.x",
    "mongodb": "^6.x",
    "bson": "^6.x",
    "zod": "^3.x"
  },
  "devDependencies": {
    "@types/better-sqlite3": "^7.x",
    "vitest": "^2.x",
    "@testing-library/react": "^16.x",
    "@testing-library/user-event": "^14.x",
    "jsdom": "^25.x",
    "playwright": "^1.x",
    "@playwright/test": "^1.x",
    "mongodb-memory-server": "^10.x"
  }
}
```

`better-sqlite3` is a native module — `electron-builder` config must mark it as `asarUnpack: ["**/better-sqlite3/**"]`.

> **Amended.** This originally also required `electron-rebuild` in `postinstall`. `better-sqlite3` 13 is an N-API addon whose prebuilt binaries are keyed by platform-arch alone, so one binary serves both the system Node and Electron ABIs. The rebuild step, the `postinstall` hook, and the whole ABI flip were deleted. `asarUnpack` is still required — the binary cannot be loaded from inside an asar archive.

## 8. Acceptance criteria

- [ ] Renderer bundle does not contain any Node-only dependency (verify via `vite build --report`).
- [ ] `tsc -b` passes for both projects with `strict: true`.
- [ ] `npm run test:unit`, `test:integration`, `test:component`, `test:e2e` each execute at least one spec-defined test.
- [ ] Running the app produces a `mongolab.<date>.log` file in the userData directory.

## 9. Test cases

This spec itself has no runtime code to test. Compliance is enforced by lint rules and a CI check:

1. **No-leak test**: a unit test that runs `vite build` and asserts `dist/assets/*.js` contains neither `"better-sqlite3"` nor `"mongodb"` nor `"ssh2"`.
2. **Shared types purity test**: a unit test that imports every file in `shared/**.ts` and asserts `Object.keys(require.cache).filter(k => k.includes('node_modules/mongodb'))` is empty.
