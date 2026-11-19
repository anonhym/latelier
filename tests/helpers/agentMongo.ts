import { MongoClient, type Collection, type Db, type Document, type MongoClientOptions } from 'mongodb';
import { MongoPool } from '../../electron/mongo/MongoPool';
import { connectionReader } from '../../electron/mongo/ConnectionService';
import { SecretsVault } from '../../electron/secrets/SecretsVault';
import { createSafeStorageMock } from './safeStorageMock';
import type { PoolFactoryContext } from './agentHarness';

/** The agent client is the only one the pool builds with a pool of two (the user's own is sized by the Connection). */
const AGENT_POOL_SIZE = 2;

export interface CommandRecord {
  name: string;
  command: Document;
}

export type HoldMode = 'before' | 'after';

/**
 * Parks an Agent cursor's first read until the test lets it go, so a test can
 * change the world while an operation is in flight with no timing involved.
 * `before` parks before the driver reads, `after` parks once the driver has
 * returned a document, which is the late-arriving result X27 §10 discards.
 */
export class CursorHold {
  mode: HoldMode = 'after';
  armed = false;
  entered = 0;
  /** When set, a `before` read throws this once it is let go, as a driver does on a closed client. */
  failWith: Error | null = null;
  private waiters: Array<{ count: number; resolve: () => void }> = [];
  private released: Promise<void> = Promise.resolve();
  private open: (() => void) | null = null;

  arm(mode: HoldMode = 'after'): void {
    this.mode = mode;
    this.armed = true;
    this.entered = 0;
    this.released = new Promise<void>((resolve) => {
      this.open = resolve;
    });
  }

  /** Lets every parked read go and stops parking new ones. */
  release(): void {
    this.armed = false;
    this.open?.();
    this.open = null;
  }

  /** Resolves once `count` reads are parked. */
  waitEntered(count: number): Promise<void> {
    if (this.entered >= count) return Promise.resolve();
    return new Promise<void>((resolve) => this.waiters.push({ count, resolve }));
  }

  async park(): Promise<void> {
    this.entered += 1;
    for (const w of this.waiters.filter((x) => this.entered >= x.count)) w.resolve();
    this.waiters = this.waiters.filter((x) => this.entered < x.count);
    await this.released;
  }
}

type AnyFn = (...args: unknown[]) => unknown;

/** A proxy that forwards everything to `target` with `this` bound to it, so a class with private fields still works. */
function forward<T extends object>(target: T, override: (prop: string | symbol) => unknown): T {
  return new Proxy(target, {
    get(t, prop) {
      const custom = override(prop);
      if (custom !== undefined) return custom;
      const value = Reflect.get(t, prop, t) as unknown;
      return typeof value === 'function' ? (value as AnyFn).bind(t) : value;
    },
  });
}

/** One awaited driver call that parks like a cursor's first read: before it runs, or once it has answered. */
async function heldCall<T>(hold: CursorHold, run: () => Promise<T>): Promise<T> {
  const park = hold.armed;
  if (park && hold.mode === 'before') {
    await hold.park();
    if (hold.failWith) throw hold.failWith;
  }
  const result = await run();
  if (park && hold.mode === 'after') await hold.park();
  return result;
}

function holdCursor<C extends object>(cursor: C, hold: CursorHold): C {
  return forward(cursor, (prop) => {
    // The metadata tools read through these instead of iterating.
    if (prop === 'toArray' || prop === 'explain') {
      return (...args: unknown[]) => heldCall(hold, () => ((cursor as Record<string, AnyFn>)[prop] as AnyFn).apply(cursor, args) as Promise<unknown>);
    }
    if (prop !== Symbol.asyncIterator) return undefined;
    return () => {
      const iterator = (cursor as unknown as AsyncIterable<Document>)[Symbol.asyncIterator]();
      let first = true;
      return {
        async next() {
          const park = first && hold.armed;
          first = false;
          if (park && hold.mode === 'before') {
            await hold.park();
            if (hold.failWith) throw hold.failWith;
          }
          const result = await iterator.next();
          if (park && hold.mode === 'after') await hold.park();
          return result;
        },
        async return(value?: unknown) {
          return iterator.return ? iterator.return(value) : { done: true as const, value };
        },
        [Symbol.asyncIterator]() {
          return this;
        },
      };
    };
  });
}

function holdCollection(collection: Collection, hold: CursorHold): Collection {
  return forward(collection, (prop) => {
    if (prop !== 'find' && prop !== 'aggregate' && prop !== 'listIndexes') return undefined;
    return (...args: unknown[]) => holdCursor((collection[prop] as AnyFn)(...args) as object, hold);
  });
}

function holdDb(db: Db, hold: CursorHold): Db {
  return forward(db, (prop) => {
    if (prop === 'collection') return (...args: unknown[]) => holdCollection((db.collection as AnyFn)(...args) as Collection, hold);
    if (prop === 'listCollections') return (...args: unknown[]) => holdCursor((db.listCollections as AnyFn)(...args) as object, hold);
    // `list_databases` runs `listDatabases` through `db('admin').command`.
    if (prop === 'command') return (...args: unknown[]) => heldCall(hold, () => (db.command as AnyFn)(...args) as Promise<unknown>);
    return undefined;
  });
}

function holdClient(client: MongoClient, hold: CursorHold, onClosed: () => void): MongoClient {
  return forward(client, (prop) => {
    if (prop === 'db') return (...args: unknown[]) => holdDb((client.db as AnyFn)(...args) as Db, hold);
    if (prop === 'close') {
      return async (...args: unknown[]) => {
        await (client.close as AnyFn)(...args);
        onClosed();
      };
    }
    return undefined;
  });
}

export interface AgentMongo {
  pool: MongoPool;
  hold: CursorHold;
  /** Every command the Agent client started, in order. */
  commands: CommandRecord[];
  /** The options of every client the pool built, user and Agent alike. */
  factoryCalls: MongoClientOptions[];
  /** Real clients the factory built, so a test can close them. */
  clients: MongoClient[];
  /** How many Agent clients have been built, and how many of those have closed since. */
  agentClients: { opened: number; closed: number };
  /** `makePool` for `createAgentHarness`. */
  makePool: (ctx: PoolFactoryContext) => MongoPool;
  close: () => Promise<void>;
}

/** A real `MongoPool` whose Agent clients are observable and holdable. Needs no cursor to be held unless a test arms `hold`. */
export function createAgentMongo(): AgentMongo {
  const hold = new CursorHold();
  const commands: CommandRecord[] = [];
  const factoryCalls: MongoClientOptions[] = [];
  const clients: MongoClient[] = [];
  const agentClients = { opened: 0, closed: 0 };
  const state: { pool: MongoPool | null } = { pool: null };

  const clientFactory = (uri: string, options: MongoClientOptions): MongoClient => {
    factoryCalls.push(options);
    const isAgent = options.maxPoolSize === AGENT_POOL_SIZE;
    const client = new MongoClient(uri, { ...options, monitorCommands: isAgent });
    clients.push(client);
    if (!isAgent) return client;
    agentClients.opened += 1;
    client.on('commandStarted', (event) => {
      commands.push({ name: event.commandName, command: event.command });
    });
    return holdClient(client, hold, () => {
      agentClients.closed += 1;
    });
  };

  return {
    get pool() {
      if (!state.pool) throw new Error('makePool has not run yet');
      return state.pool;
    },
    hold,
    commands,
    factoryCalls,
    clients,
    agentClients,
    makePool({ tmp, connRepo }) {
      const vault = new SecretsVault(tmp.db, createSafeStorageMock());
      state.pool = new MongoPool({ repo: connectionReader(connRepo, vault), vault, clientFactory });
      return state.pool;
    },
    async close() {
      hold.release();
      await state.pool?.disconnectAll();
      await Promise.all(clients.map((c) => c.close()));
    },
  };
}
