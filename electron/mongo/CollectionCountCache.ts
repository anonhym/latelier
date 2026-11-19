/** The storage figures `listCollections` reads for one collection. */
export interface CachedCollectionStats {
  documentCount?: number;
  sizeBytes?: number;
  indexCount?: number;
  lastModified?: string;
}

/**
 * Last-read collection figures, per connection, kept in memory for the life of
 * the app session. A names-only listing shows them (marked cached) instead of
 * paying one `$collStats` per collection again. Never persisted: a figure that
 * outlives the session would read as current when it is days old.
 */
export class CollectionCountCache {
  private byConnection = new Map<string, Map<string, CachedCollectionStats>>();

  private static key(dbName: string, collection: string): string {
    return `${dbName}\u0000${collection}`;
  }

  get(connectionId: string, dbName: string, collection: string): CachedCollectionStats | undefined {
    return this.byConnection.get(connectionId)?.get(CollectionCountCache.key(dbName, collection));
  }

  set(connectionId: string, dbName: string, collection: string, stats: CachedCollectionStats): void {
    let perConnection = this.byConnection.get(connectionId);
    if (!perConnection) {
      perConnection = new Map();
      this.byConnection.set(connectionId, perConnection);
    }
    perConnection.set(CollectionCountCache.key(dbName, collection), stats);
  }

  /** A collection that no longer exists keeps no figures. */
  deleteMissing(connectionId: string, dbName: string, present: ReadonlySet<string>): void {
    const perConnection = this.byConnection.get(connectionId);
    if (!perConnection) return;
    const prefix = `${dbName}\u0000`;
    for (const key of [...perConnection.keys()]) {
      if (key.startsWith(prefix) && !present.has(key.slice(prefix.length))) perConnection.delete(key);
    }
  }

  /** The connection was deleted or now points somewhere else: nothing cached is its. */
  clearConnection(connectionId: string): void {
    this.byConnection.delete(connectionId);
  }
}
