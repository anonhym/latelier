import React from 'react';
import { ActionIcon, Button, Group, Menu, SegmentedControl, Tooltip } from '@mantine/core';
import { themeVars } from '../../theme/themeVars';
import { I } from '../../icons';
import { useElementWidth } from '../../hooks/useElementWidth';
import type { ResultViewMode } from '@shared/types';
import { useCollectionWorkspace } from './context';
import { api } from '../../api/atelier';
import { notify } from '../../theme/notifications';
import { DEFAULT_VIEW_PREF_KEY } from '../../state/workspaceTabs';
import { FieldsControl } from './FieldsControl';
import { ExportDialog } from './ExportDialog';
import { consumeTabRequest, tabRequested, subscribeTabRequests } from './tabRequest';
import { ImportDialog } from './ImportDialog';
import { canvasHeaderLayout } from './toolbarLayout';
import { ResultStatus } from './StatusBar';
import { runUndo, useLatestUndo } from './undoStore';
import { formatShortcut } from '../../commands/shortcutLabel';
import { isMacRenderer } from '../../utils/platform';

const VIEWS: ResultViewMode[] = ['Table', 'Tree', 'JSON'];

/**
 * The canvas header (W06 §8.1), a 28px row above the results:
 *
 *   [Table|Tree|JSON]                     Fields · References · ⋯ · + Insert
 *
 * The count, plan badge and pager are the status bar's (`ResultStatus`,
 * portalled from here so they read the same tab). Reads everything off the
 * collection-workspace context, so any provider can render it.
 */
interface ResultBarProps {
  /** Reference rules sit beside Fields: both shape how this collection's
   * documents read. Only the workspace tab passes it; previews have no rules. */
  references?: { count: number; onOpen: () => void };
}

export function ResultBar({ references }: ResultBarProps = {}) {
  const T = themeVars;
  const { state, actions, meta } = useCollectionWorkspace();
  const docCount = state.lastRun?.documents.length ?? null;
  const view = state.view;
  const isReadOnly = !!meta.isReadOnly;
  // A view runs queries but takes no writes.
  const isView = !!meta.isView;
  const [exportOpen, setExportOpen] = React.useState(false);
  const [importOpen, setImportOpen] = React.useState(false);

  // The palette's Export… on this tab: the palette has already checked the
  // tab has documents to export, so this only opens the dialog, once.
  const requested = React.useSyncExternalStore(subscribeTabRequests, () => tabRequested('export', meta.tabId));
  React.useEffect(() => {
    if (!requested) return;
    consumeTabRequest('export', meta.tabId);
    // Acts on an external one-shot request, once.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setExportOpen(true);
  }, [requested, meta.tabId]);

  const undo = useLatestUndo(meta);
  const [barRef, barWidth] = useElementWidth<HTMLDivElement>();
  const layout = canvasHeaderLayout(barWidth, references !== undefined);

  // Choosing a view also makes it the default for tabs opened afterwards (W06 §8.1).
  const chooseView = (v: ResultViewMode) => {
    actions.patch({ view: v });
    void api.prefs.set(DEFAULT_VIEW_PREF_KEY, v).catch(() => {
      // This tab's view already persisted via patch; only the default for new tabs is lost.
      notify.error('Could not save the default view', { id: 'pref-save-failed' });
    });
  };

  return (
    <Group
      ref={barRef}
      data-testid="result-bar"
      gap={layout.iconControls ? 6 : 8}
      wrap="nowrap"
      style={{
        height: 28,
        boxSizing: 'border-box',
        padding: '0 14px',
        borderBottom: `1px solid ${T.border}`,
        background: T.surface,
        flexShrink: 0,
        fontSize: T.fsSm,
        color: T.textMuted,
        whiteSpace: 'nowrap',
      }}
    >
      <SegmentedControl
        size="xs"
        value={view}
        onChange={(v) => chooseView(v as ResultViewMode)}
        data={VIEWS.map((v) => ({ label: v, value: v }))}
        styles={{ label: { paddingBlock: 1 } }}
        style={{ flexShrink: 0 }}
      />
      <ResultStatus />

      <Group gap={layout.iconControls ? 6 : 8} wrap="nowrap" style={{ flexShrink: 0, marginLeft: 'auto' }}>
        {/* Fields control — one control for all three views; each view reads
            the same per-tab `columnConfig`. */}
        <FieldsControl iconOnly={layout.iconControls} />

        {references && (
          <Tooltip label={`Manage reference rules for this collection (${references.count})`} withArrow>
            {layout.iconControls ? (
              <ActionIcon
                data-hint-anchor="refs.configure"
                variant="default"
                size={22}
                onClick={references.onOpen}
                aria-label={`References (${references.count})`}
              >
                {I.link}
              </ActionIcon>
            ) : (
              <Button
                data-hint-anchor="refs.configure"
                variant="default"
                size="compact-xs"
                leftSection={I.link}
                onClick={references.onOpen}
              >
                References ({references.count})
              </Button>
            )}
          </Tooltip>
        )}

        {/* Bulk and data actions on the result set. `⋯`, not "Documents": that
            was also the name of the view it sat in. Hidden for read-only
            consumers so there's nothing to short-circuit at the leaf. */}
        {!isReadOnly && (
          <Menu position="bottom-end" shadow="md" width={210}>
            <Tooltip label="More actions" withArrow>
              <Menu.Target>
                <ActionIcon variant="subtle" color="gray" size={22} aria-label="More actions">
                  {I.more}
                </ActionIcon>
              </Menu.Target>
            </Tooltip>
            <Menu.Dropdown>
              {!isView && (
                <>
                  <Menu.Label>Bulk actions</Menu.Label>
                  <Menu.Item leftSection={I.edit} onClick={() => actions.openUpdateAll()}>
                    Update matching…
                  </Menu.Item>
                  <Menu.Item color="red" leftSection={I.trash} onClick={() => actions.openDeleteAll()}>
                    Delete matching…
                  </Menu.Item>
                </>
              )}
              <Menu.Label>Data</Menu.Label>
              <Menu.Item
                leftSection={I.download}
                disabled={docCount === null || docCount === 0}
                onClick={() => setExportOpen(true)}
              >
                Export…
              </Menu.Item>
              {!isView && (
                <Menu.Item leftSection={I.upload} onClick={() => setImportOpen(true)}>
                  Import…
                </Menu.Item>
              )}
              {/* X13 §13: while this collection's newest undo is still held. */}
              {undo && (
                <>
                  <Menu.Divider />
                  <Menu.Item
                    leftSection={I.undo}
                    rightSection={<span style={{ fontSize: T.fsXs, color: T.textMuted }}>{formatShortcut('⌘Z', isMacRenderer())}</span>}
                    onClick={() => void runUndo(undo)}
                  >
                    {undo.label}
                  </Menu.Item>
                </>
              )}
            </Menu.Dropdown>
          </Menu>
        )}

        {/* Insert — an outline button: filled, it was the loudest control in a
            read-mostly view. The aria-label stays `Insert document`. */}
        {!isReadOnly && !isView && (
          <Tooltip label="Insert a new document into this collection" withArrow>
            {layout.iconControls ? (
              <ActionIcon variant="default" size={22} onClick={() => actions.openInsert()} aria-label="Insert document">
                {I.plus}
              </ActionIcon>
            ) : (
              <Button
                variant="default"
                size="compact-xs"
                leftSection={I.plus}
                onClick={() => actions.openInsert()}
                aria-label="Insert document"
              >
                Insert
              </Button>
            )}
          </Tooltip>
        )}

        {exportOpen && <ExportDialog onClose={() => setExportOpen(false)} />}
        {importOpen && (
          <ImportDialog
            connectionId={meta.connectionId}
            dbName={meta.dbName}
            collection={meta.collection}
            onClose={() => setImportOpen(false)}
            onImported={(report) => {
              if (report.inserted > 0) actions.run();
            }}
            onPartialImport={() => actions.run()}
          />
        )}
      </Group>
    </Group>
  );
}
