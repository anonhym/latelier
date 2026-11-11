import type { PaletteObject } from '../../commands/types';
import type { WorkspaceTabsState } from '../../state/workspaceTabs';
import type { NavigatorDialogRequest } from './DbCollectionNavigator';
import { requestTab } from './tabRequest';
import { notify } from '../../theme/notifications';

/**
 * A collection as a palette object (X07 §13.4). Each action calls what the
 * navigator's collection menu or the tab itself calls; none is reimplemented.
 */
export function collectionObject(args: {
  connectionId: string;
  db: string;
  coll: string;
  isView: boolean;
  connectionName: string | undefined;
  /** The live tab state, read when an action runs. */
  tabs: () => WorkspaceTabsState;
  showStructure: (tabId: string, section: 'Indexes' | 'Schema') => void;
  requestDialog: (request: NavigatorDialogRequest) => void;
  /** Whether the Connection is dormant, read when an action runs. */
  dormant: () => boolean;
  /** Whether tab `tabId` has a find in flight, read when an action runs. */
  running: (tabId: string) => boolean;
}): PaletteObject {
  const { connectionId, db, coll, isView, tabs, showStructure, requestDialog } = args;
  const input = { connectionId, dbName: db, collection: coll };
  const openReusing = () => tabs().openCollection({ ...input, reuseExisting: true });
  // Worded like `doc.insert`'s reason on a view.
  const onView = (what: string) => () => (isView ? `This is a view, so ${what}` : null);
  const dialog = (kind: NavigatorDialogRequest['dialog']) => () => requestDialog({ ...input, dialog: kind });
  return {
    // Connection-qualified, so the same namespace on another Connection is
    // not "recent". The id of the v1 row, so a stored MRU still names it.
    id: `tab.open:${connectionId}:${db}:${coll}`,
    kind: 'collection',
    name: `${db}.${coll}`,
    subtitle: args.connectionName,
    actions: [
      { id: 'open', verb: 'open', title: 'Open', perform: async () => void (await openReusing()) },
      {
        id: 'open-new-tab',
        verb: 'open',
        title: 'Open in new tab',
        alternate: true,
        perform: async () => void (await tabs().openCollection(input)),
      },
      // Query… and Filter by field… go here.
      { id: 'aggregate', verb: 'aggregate', title: 'Aggregate', perform: async () => void (await tabs().openAggregation(input)) },
      { id: 'schema', verb: 'schema', title: 'Schema', perform: async () => showStructure((await openReusing()).id, 'Schema') },
      { id: 'indexes', verb: 'indexes', title: 'Indexes', perform: async () => showStructure((await openReusing()).id, 'Indexes') },
      {
        id: 'export',
        verb: 'export',
        title: 'Export…',
        // The tab's own Export dialog, under its menu item's rule: only a
        // settled result with documents exports. Anything else says why, once,
        // and queues nothing.
        perform: async () => {
          const tab = await openReusing();
          // A dormant tab shows its Connect pane, not the result bar.
          if (args.dormant()) {
            notify.info(`Connect to ${args.connectionName ?? 'the connection'} first, then export.`);
            return;
          }
          if ((tab.state.activeView ?? 'documents') !== 'documents') tabs().setActiveView(tab.id, 'documents');
          const run = tab.state.lastRun;
          if (!run || run.error || args.running(tab.id)) notify.info('Run the query, then choose Export again');
          else if (run.documents.length === 0) notify.info('The query matched no documents, so there is nothing to export.');
          else requestTab('export', tab.id);
        },
      },
      {
        id: 'import',
        verb: 'import',
        title: 'Import…',
        disabledReason: onView("documents can't be imported here"),
        perform: dialog('import'),
      },
      {
        id: 'rename',
        verb: 'rename',
        title: 'Rename…',
        disabledReason: onView("it can't be renamed here"),
        perform: dialog('rename'),
      },
      {
        id: 'drop',
        verb: 'delete',
        title: 'Drop collection…',
        destructive: true,
        disabledReason: onView("it can't be dropped here"),
        perform: dialog('drop'),
      },
    ],
  };
}
