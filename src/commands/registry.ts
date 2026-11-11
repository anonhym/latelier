import { prepareCommand, prunePrepared } from './rank';
import type { Command } from './types';

type Listener = () => void;

interface Entry {
  cmd: Command;
  /** Per-registration token so unregister only deletes its own row, not a successor. */
  token: symbol;
}

class Registry {
  private entries = new Map<string, Entry>();
  private listeners = new Set<Listener>();
  private warnedIds = new Set<string>();
  private cachedList: Command[] | null = null;
  private prunePending = false;

  list(): Command[] {
    // Cached so `useSyncExternalStore` sees a stable identity when nothing
    // changed; invalidated on every notify() below.
    if (!this.cachedList) {
      this.cachedList = Array.from(this.entries.values(), (e) => e.cmd);
    }
    return this.cachedList;
  }

  add(commands: Command[]): () => void {
    const token = Symbol();
    for (const cmd of commands) {
      if (this.entries.has(cmd.id) && !this.warnedIds.has(cmd.id)) {
        if (import.meta.env.DEV) {
          console.warn(
            `[commandRegistry] duplicate command id "${cmd.id}" — replacing existing entry.`,
          );
        }
        this.warnedIds.add(cmd.id);
      }
      // Text that does not change between keystrokes is prepared once, here.
      prepareCommand(cmd);
      this.entries.set(cmd.id, { cmd, token });
    }
    this.notify();
    return () => {
      for (const cmd of commands) {
        if (this.entries.get(cmd.id)?.token === token) {
          this.entries.delete(cmd.id);
        }
      }
      this.notify();
    };
  }

  subscribe(cb: Listener): () => void {
    this.listeners.add(cb);
    return () => {
      this.listeners.delete(cb);
    };
  }

  /** Test-only: drop everything. */
  _resetForTests(): void {
    this.entries.clear();
    this.warnedIds.clear();
    this.notify();
  }

  /**
   * Forgets the cached preparations of ids no longer registered. Deferred to a
   * microtask: a re-registration unregisters the old batch and adds the new one
   * in the same commit, and pruning in between would throw the work away.
   */
  private schedulePrune(): void {
    if (this.prunePending) return;
    this.prunePending = true;
    queueMicrotask(() => {
      this.prunePending = false;
      prunePrepared((id) => this.entries.has(id));
    });
  }

  private notify(): void {
    this.schedulePrune();
    this.cachedList = null;
    for (const cb of this.listeners) cb();
  }
}

export const commandRegistry = new Registry();
