import { distinctiveValues } from './distinctiveValues';

/** Where a copied value came from: the Connection, Database and Collection of the tab it was copied in. */
export interface CopySource {
  connectionId: string;
  dbName: string;
  collection: string;
}

/** A `CopySource` that may also name the field the copied text came from. */
export interface CopyOriginSource extends CopySource {
  /** Dotted path of the field in the Collection's documents; see `sourceFieldPathOf`. */
  fieldPath?: string;
}

/** The most recent data-bearing copy made in the app. */
export interface CopyOrigin extends CopySource {
  /** What was written to the clipboard. */
  text: string;
  /** `distinctiveValues(text)`, extracted once at copy time. */
  distinctive: string[];
  /** The field the text was copied from, when it is one field of one document. */
  fieldPath?: string;
  /** Grows with every recorded copy, so a later copy of the same text is a different copy. */
  seq: number;
}

// Renderer memory only: never persisted, never sent to main, gone on quit.
let current: CopyOrigin | null = null;
// Never reset: a cleared origin and the next one must not share a `seq`.
let lastSeq = 0;

/** The remembered copy, or null. */
export function getCopyOrigin(): CopyOrigin | null {
  return current;
}

/** Replace the remembered copy with `text`, copied from `source`. */
export function recordCopyOrigin(source: CopyOriginSource, text: string): void {
  lastSeq += 1;
  current = {
    connectionId: source.connectionId,
    dbName: source.dbName,
    collection: source.collection,
    text,
    distinctive: distinctiveValues(text),
    ...(source.fieldPath === undefined ? {} : { fieldPath: source.fieldPath }),
    seq: lastSeq,
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

/**
 * The path a rule can name as its source field, or undefined. A path through
 * an array carries an element index (`items.0.sku`), which no rule's source
 * field spells, so it names no field.
 */
export function sourceFieldPathOf(path: string): string | undefined {
  if (path === '') return undefined;
  return path.split('.').some((segment) => /^\d+$/.test(segment)) ? undefined : path;
}

/** `origin` with the field the copied text came from, or undefined when there is no origin. */
export function withFieldPath(origin: CopySource | undefined, path: string): CopyOriginSource | undefined {
  if (origin === undefined) return undefined;
  const fieldPath = sourceFieldPathOf(path);
  const source = copySourceOf(origin);
  return fieldPath === undefined ? source : { ...source, fieldPath };
}
