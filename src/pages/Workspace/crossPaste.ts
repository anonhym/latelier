import React, { use } from 'react';
import { api } from '../../api/atelier';
import { logFailure } from '../../utils/rendererLog';
import { getCopyOrigin } from '../../utils/copyOrigin';
import { isCrossConnectionPaste } from '../../utils/crossConnectionPaste';
import { CROSS_PASTE_PREF_KEY, showPasteWarning } from '../../state/pasteWarning';
import { CollectionWorkspaceContext } from './context';
import { armReferenceDiscovery } from './referenceDiscovery';

export interface CrossPasteTarget {
  /** The tab the paste landed in. */
  tabId: string;
  /** The Connection of that tab. */
  connectionId: string;
  /** Which of the tab's query surfaces received it. */
  surface: string;
  /**
   * The tab's Database and Collection. Given by the Collection tab's surfaces,
   * whose pastes can start a reference discovery; omitted by the others.
   */
  dbName?: string;
  collection?: string;
}

/**
 * Judge a paste into a query surface and, when it is a Cross-Connection
 * Paste, show the tab's warning. It only observes: the caller never prevents
 * the paste, and the preference is read after the paste has already landed.
 * The Copy Origin is read now, so a copy made while the preference is being
 * read cannot change what the warning names.
 */
export function checkCrossConnectionPaste(target: CrossPasteTarget, pasted: string): void {
  // A paste within one Connection is no Cross-Connection Paste, and is exactly a discovery's case.
  if (target.dbName !== undefined && target.collection !== undefined) {
    armReferenceDiscovery(
      { tabId: target.tabId, connectionId: target.connectionId, dbName: target.dbName, collection: target.collection },
      pasted,
    );
  }
  const origin = getCopyOrigin();
  if (
    origin === null ||
    !isCrossConnectionPaste({ origin, focusedConnectionId: target.connectionId, pasted, enabled: true })
  ) {
    return;
  }
  const from = { connectionId: origin.connectionId, dbName: origin.dbName, collection: origin.collection };
  api.prefs
    .get<boolean>(CROSS_PASTE_PREF_KEY)
    .then((enabled) => {
      if (enabled !== false) showPasteWarning(target.tabId, target.surface, from);
    })
    .catch((err: unknown) => logFailure('reading the paste warning setting', err));
}

/**
 * The `onPaste` handler of a query surface inside a workspace. Outside one
 * (a bare render) there is no tab to warn on, so it does nothing.
 */
export function useCrossPaste(surface: string): React.ClipboardEventHandler {
  const ctx = use(CollectionWorkspaceContext);
  const tabId = ctx?.meta.tabId;
  const connectionId = ctx?.meta.connectionId;
  const dbName = ctx?.meta.dbName;
  const collection = ctx?.meta.collection;
  return React.useCallback(
    (e) => {
      if (tabId === undefined || connectionId === undefined) return;
      checkCrossConnectionPaste(
        { tabId, connectionId, surface, dbName, collection },
        e.clipboardData.getData('text/plain'),
      );
    },
    [tabId, connectionId, surface, dbName, collection],
  );
}
