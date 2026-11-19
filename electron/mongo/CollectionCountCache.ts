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
  private generations = new Map<string, number>();

  private static key(dbName: string, collection: string): string {
    return `${dbName}\u0000${collection}`;
  }

  get(connectionId: string, dbName: string, collection: string): CachedCollectionStats | undefined {
    return this.byConnection.get(connectionId)?.get(CollectionCountCache.key(dbName, collection));
  }

  /**
   * Bumped every time the connection is cleared. A reader that started before
   * a clear passes the value it saw back to `set`, so figures read from the
   * old server cannot be stored under the repointed connection.
   */
  generation(connectionId: string): number {
    return this.generations.get(connectionId) ?? 0;
  }

  set(
    connectionId: string,
    dbName: string,
    collection: string,
    stats: CachedCollectionStats,
    readAtGeneration?: number,
  ): void {
    if (readAtGeneration !== undefined && readAtGeneration !== this.generation(connectionId)) return;
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
    this.generations.set(connectionId, this.generation(connectionId) + 1);
  }
}
