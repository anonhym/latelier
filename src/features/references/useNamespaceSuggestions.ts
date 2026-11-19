import React from 'react';
import { api } from '../../api/atelier';

/** Typing in the database box settles this long before its collections are requested. */
const COLLECTIONS_DEBOUNCE_MS = 300;

export interface NamespaceSuggestions {
  /** The connection's database names; empty until loaded or when the list failed. */
  databases: string[];
  /** The collection names of the database named by the `dbName` argument. */
  collections: string[];
  /** The databases list could not be read, usually a missing privilege. */
  databasesFailed: boolean;
  /** The collections list of the current database could not be read. */
  collectionsFailed: boolean;
}

type Loaded = { names: string[] } | { failed: true };

/**
 * Names to suggest for a rule's target database and collection: the
 * connection's databases (loaded once) and the typed database's collections
 * (loaded once per name, after the typing settles). The suggestions are only a
 * convenience, so a failed list is reported as a flag for an inline hint and
 * typing a name by hand keeps working.
 */
export function useNamespaceSuggestions(connectionId: string, dbName: string): NamespaceSuggestions {
  // Results are keyed by connection (and database), so one that lands after the
  // user moved on is stored under its own key and read only for that key.
  const [databasesByConn, setDatabasesByConn] = React.useState<Record<string, Loaded>>({});
  const [collectionsByKey, setCollectionsByKey] = React.useState<Record<string, Loaded>>({});
  const requested = React.useRef(new Set<string>());
  const mounted = React.useRef(true);
  const db = dbName.trim();
  const collectionsKey = `${connectionId}\n${db}`;

  React.useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  React.useEffect(() => {
    api.meta.listDatabases({ connectionId }).then(
      (list) => {
        if (mounted.current) setDatabasesByConn((c) => ({ ...c, [connectionId]: { names: list.map((d) => d.name) } }));
      },
      () => {
        if (mounted.current) setDatabasesByConn((c) => ({ ...c, [connectionId]: { failed: true } }));
      },
    );
  }, [connectionId]);

  React.useEffect(() => {
    if (db === '' || requested.current.has(collectionsKey)) return;
    const timer = setTimeout(() => {
      requested.current.add(collectionsKey);
      api.meta.listCollections({ connectionId, dbName: db, includeStats: false }).then(
        (list) => {
          if (mounted.current) setCollectionsByKey((c) => ({ ...c, [collectionsKey]: { names: list.map((x) => x.name) } }));
        },
        () => {
          if (mounted.current) setCollectionsByKey((c) => ({ ...c, [collectionsKey]: { failed: true } }));
        },
      );
    }, COLLECTIONS_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [connectionId, db, collectionsKey]);

  // Keys are user text: read only own properties.
  const dbs = Object.hasOwn(databasesByConn, connectionId) ? databasesByConn[connectionId] : undefined;
  const colls = Object.hasOwn(collectionsByKey, collectionsKey) ? collectionsByKey[collectionsKey] : undefined;
  return {
    databases: dbs !== undefined && 'names' in dbs ? dbs.names : [],
    collections: colls !== undefined && 'names' in colls ? colls.names : [],
    databasesFailed: dbs !== undefined && 'failed' in dbs,
    collectionsFailed: colls !== undefined && 'failed' in colls,
  };
}
