import { distinctiveValues } from './distinctiveValues';

/** Where a copied value came from: the Connection, Database and Collection of the tab it was copied in. */
export interface CopySource {
  connectionId: string;
  dbName: string;
  collection: string;
}

/** The most recent data-bearing copy made in the app. */
export interface CopyOrigin extends CopySource {
  /** What was written to the clipboard. */
  text: string;
  /** `distinctiveValues(text)`, extracted once at copy time. */
  distinctive: string[];
}

// Renderer memory only: never persisted, never sent to main, gone on quit.
let current: CopyOrigin | null = null;

/** The remembered copy, or null. */
export function getCopyOrigin(): CopyOrigin | null {
  return current;
}

/** Replace the remembered copy with `text`, copied from `source`. */
export function recordCopyOrigin(source: CopySource, text: string): void {
  current = {
    connectionId: source.connectionId,
    dbName: source.dbName,
    collection: source.collection,
    text,
    distinctive: distinctiveValues(text),
  };
}

/** Forget the remembered copy. */
export function clearCopyOrigin(): void {
  current = null;
}

/** The `CopySource` of a workspace's identity, dropping the rest of it. */
export function copySourceOf(meta: CopySource): CopySource {
  return { connectionId: meta.connectionId, dbName: meta.dbName, collection: meta.collection };
}
