import React from 'react';
import { ActionIcon, Badge, Box, Button, Group, Text, TextInput, Tooltip, UnstyledButton } from '@mantine/core';
import { I } from '../../../icons';
import { themeVars } from '../../../theme/themeVars';
import { SubmitButton } from '../../../components/SubmitButton';
import { api, getErrorMessage, isIpcError } from '../../../api/atelier';
import { confirmDeleteSaved } from '../savedActions';
import { consumeSavedRename, peekSavedRename, subscribeTabRequests } from '../tabRequest';
import { notify } from '../../../theme/notifications';
import { logFailure } from '../../../utils/rendererLog';
import type { SavedKind, SavedQuery, SavedQuerySummary } from '@shared/types';
import { queryPreview } from './recentRuns';
import { useListPreview } from './useListPreview';

const KIND_LABEL: Record<SavedKind, string> = {
  find: 'Find',
  aggregation: 'Aggregation',
  script: 'Script',
};

// Stable, so it runs once per mount: an inline ref would refocus on every render.
const focusOnMount = (el: HTMLInputElement | null) => el?.focus();

interface SavedTabProps {
  connectionId: string;
  dbName: string;
  collection: string;
  refreshKey?: number;
  onRunHere: (saved: SavedQuery) => void;
  /**
   * Opens a saved aggregation or script as its own top-level workspace tab.
   * Those kinds don't share a runtime surface with the Documents view, so
   * they can't run in place the way a find query does.
   */
  onOpenInTab: (saved: SavedQuerySummary) => void;
  /** The tab this list sits in, whose palette rename requests it takes. */
  tabId?: string;
  /** Called once a rename has landed, with the stored name. */
  onRenamed?: (saved: SavedQuerySummary, name: string) => void;
}

interface Editing {
  id: string;
  value: string;
  error: string | null;
  saving: boolean;
}

export function SavedTab({
  connectionId,
  dbName,
  collection,
  refreshKey,
  onRunHere,
  onOpenInTab,
  tabId,
  onRenamed,
}: SavedTabProps) {
  const T = themeVars;
  const [items, setItems] = React.useState<SavedQuerySummary[]>([]);
  const [loading, setLoading] = React.useState(false);
  const [err, setErr] = React.useState<string | null>(null);
  const [deleting, setDeleting] = React.useState(false);
  // Whether a list has landed: a rename request waits for it.
  const [loaded, setLoaded] = React.useState(false);
  const [editing, setEditing] = React.useState<Editing | null>(null);
  const [search, setSearch] = React.useState('');
  const rows = React.useMemo(() => {
    const needle = search.trim().toLowerCase();
    return needle
      ? items.filter((i) => `${i.name}\n${i.description ?? ''}`.toLowerCase().includes(needle))
      : items;
  }, [items, search]);

  const load = React.useCallback(async () => {
    setLoading(true);
    setErr(null);
    try {
      const list = await api.saved.list({ connectionId, dbName, collection });
      setItems(list);
      setLoaded(true);
    } catch (e) {
      setErr(getErrorMessage(e, 'Failed to load saved queries'));
      // A rename asked of a list that could not load is dropped, not kept for a later Refresh.
      if (tabId) consumeSavedRename(tabId);
    } finally {
      setLoading(false);
    }
  }, [connectionId, dbName, collection, tabId]);

  React.useEffect(() => {
    queueMicrotask(() => { void load(); });
  }, [load, refreshKey]);

  const startRename = (item: SavedQuerySummary) =>
    setEditing({ id: item.id, value: item.name, error: null, saving: false });

  // Closing the input hands the focus back to the name it replaced, once that is rendered.
  const listRef = React.useRef<HTMLDivElement>(null);
  const refocusRef = React.useRef<string | null>(null);
  const stopEditing = (id: string) => {
    refocusRef.current = id;
    setEditing(null);
  };
  React.useLayoutEffect(() => {
    const id = refocusRef.current;
    if (!id || editing) return;
    refocusRef.current = null;
    listRef.current?.querySelector<HTMLElement>(`[data-saved-name="${CSS.escape(id)}"]`)?.focus();
  }, [editing]);

  // The palette's Rename… (X07 §13.4): the same inline input, once the list has the entry.
  const renameRequest = React.useSyncExternalStore(subscribeTabRequests, () =>
    tabId ? peekSavedRename(tabId) : null,
  );
  // The palette lists afresh on each open, this list only on a refresh: an
  // entry it lacks is looked for once more before it is called gone.
  const relistedRef = React.useRef(false);
  React.useEffect(() => {
    if (!tabId || !renameRequest || !loaded || loading) return;
    const target = items.find((i) => i.id === renameRequest);
    if (!target && !relistedRef.current) {
      relistedRef.current = true;
      void load();
      return;
    }
    relistedRef.current = false;
    consumeSavedRename(tabId);
    if (!target) {
      notify.info('That saved query no longer exists.');
      return;
    }
    // The request comes from outside React (the palette's store) and may be
    // waiting when this list mounts, so it lands here, once.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    startRename(target);
  }, [tabId, renameRequest, loaded, loading, items, load]);

  // W09 §8: Enter submits, Escape cancels, a taken name keeps the input open.
  const commitRename = async () => {
    if (!editing || editing.saving) return;
    const item = items.find((i) => i.id === editing.id);
    const name = editing.value.trim();
    if (!item || name === '' || name === item.name) {
      stopEditing(editing.id);
      return;
    }
    setEditing({ ...editing, saving: true, error: null });
    try {
      const updated = await api.saved.update({ id: item.id, patch: { name } });
      setItems((prev) => prev.map((i) => (i.id === item.id ? { ...i, name: updated.name, updatedAt: updated.updatedAt } : i)));
      stopEditing(item.id);
      onRenamed?.(item, updated.name);
    } catch (e) {
      const error =
        isIpcError(e) && e.code === 'CONFLICT'
          ? `“${name}” is already saved on ${collection}.`
          : getErrorMessage(e, 'Rename failed');
      setEditing((cur) => (cur?.id === item.id ? { ...cur, saving: false, error } : cur));
    }
  };

  const handlePrimary = async (summary: SavedQuerySummary) => {
    if (summary.kind !== 'find') {
      onOpenInTab(summary);
      return;
    }
    try {
      const full = await api.saved.get({ id: summary.id });
      onRunHere(full);
    } catch (e) {
      setErr(getErrorMessage(e, 'Failed to load query'));
    }
  };

  // W05 §9.6: ↑↓ in the search box move the highlight, Enter loads it. The
  // list carries summaries only, so the highlighted entry's text is fetched
  // once and kept: `undefined` is not fetched yet, `null` has nothing to show.
  const list = useListPreview(rows, (item) => void handlePrimary(item));
  const [previews, setPreviews] = React.useState<Record<string, string | null>>({});
  const activeId = list.active?.id;
  const activePreview = activeId === undefined ? undefined : previews[activeId];
  React.useEffect(() => {
    if (activeId === undefined || activePreview !== undefined) return undefined;
    let current = true;
    void api.saved
      .get({ id: activeId })
      .then((full) => queryPreview(full.payload))
      .catch((err: unknown) => {
        // The entry still loads on Enter; only its preview is missing.
        logFailure('loading a saved query preview', err);
        return null;
      })
      .then((text) => {
        if (current) setPreviews((prev) => ({ ...prev, [activeId]: text }));
      });
    return () => {
      current = false;
    };
  }, [activeId, activePreview]);

  // N4.7 — this used to be a hand-rolled `role="alertdialog"` overlay
  // with its own backdrop, its own Escape listener and its own focus
  // behaviour, one tab away from the drawer's Reset, which already used the
  // modal manager. `confirmDestructive` is that same manager; Escape, the
  // backdrop and focus trapping come with it rather than being re-implemented.
  const requestDelete = async (target: SavedQuerySummary) => {
    const proceed = await confirmDeleteSaved(target);
    if (!proceed) return;
    setDeleting(true);
    try {
      await api.saved.delete({ id: target.id });
      setItems((prev) => prev.filter((i) => i.id !== target.id));
    } catch (e) {
      setErr(getErrorMessage(e, 'Failed to delete'));
    } finally {
      setDeleting(false);
    }
  };

  return (
    <div ref={listRef}>
      {/* W15 §13.5 — the header survives loading, error and empty.
          This view used to early-return a bare centered message, so anyone
          switching here while it loaded got an unlabelled blank panel. */}
      <Group
        gap={themeVars.gapXs}
        wrap="nowrap"
        px={10}
        pt={10}
        pb={6}
        fz={T.fsXs}
        fw={700}
        c={T.textMuted}
        style={{ letterSpacing: 0.6, textTransform: 'uppercase' }}
      >
        <span style={{ flex: 1 }}>Saved · {collection}</span>
        <SubmitButton
          variant="default"
          size="compact-xs"
          h={18}
          px={6}
          fz={T.fsXs}
          c={loading ? undefined : T.textMuted}
          onClick={() => void load()}
          submitting={loading}
          aria-label="Refresh saved queries"
        >
          Refresh
        </SubmitButton>
      </Group>

      <TextInput
        size="xs"
        mx={10}
        mb={6}
        // The popover opens on this box, so the list is under the keyboard at once.
        ref={focusOnMount}
        leftSection={I.search}
        placeholder="Search saved queries"
        aria-label="Search saved queries"
        value={search}
        onChange={(e) => {
          setSearch(e.currentTarget.value);
          list.highlight(0);
        }}
        onKeyDown={list.onKeyDown}
      />

      {loading && (
        <Text fz={T.fsSm} c={T.textMuted} px={10} pt={4} pb={10}>
          Loading…
        </Text>
      )}

      {!loading && err && (
        <Text fz={T.fsSm} c={T.warn} px={10} pt={4} pb={10}>
          {err}
        </Text>
      )}

      {!loading && !err && items.length === 0 && (
        <Text fz={T.fsSm} c={T.textMuted} px={10} pt={4} pb={10}>
          Nothing saved yet. Use Save in the toolbar above to keep one here.
        </Text>
      )}

      {!loading && !err && items.length > 0 && rows.length === 0 && (
        <Text fz={T.fsSm} c={T.textMuted} px={10} pt={4} pb={10}>
          No saved query matches this search.
        </Text>
      )}

      {!loading && !err && rows.map((item, index) => (
        <Group
          key={item.id}
          gap={themeVars.gapXs}
          wrap="nowrap"
          px={10}
          py={7}
          fz={T.fsSm}
          data-highlighted={item === list.active || undefined}
          onMouseEnter={() => list.highlight(index)}
          style={{
            borderBottom: `1px solid ${T.border}`,
            background: item === list.active ? T.accentSoft : undefined,
          }}
        >
          {/* Kind label. `Badge` with this size/variant/color is the
              existing small-badge pattern in this file's siblings
              (ColumnChooser, PreviewPicker, QueryBar's advanced-count
              badge) — reused rather than hand-rolled, since SavedTab now
              lists every kind and needs to tell a find, an aggregation
              and a script apart at a glance. */}
          <Badge size="xs" variant="light" color="violet" style={{ flexShrink: 0 }}>
            {KIND_LABEL[item.kind]}
          </Badge>
          <Box style={{ flex: 1, overflow: 'hidden' }}>
            {editing?.id === item.id ? (
              <TextInput
                size="xs"
                autoFocus
                aria-label={`New name for "${item.name}"`}
                value={editing.value}
                error={editing.error}
                // Read-only, not disabled, while it saves: a disabled input drops the focus.
                readOnly={editing.saving}
                onChange={(e) => {
                  const value = e.currentTarget.value;
                  setEditing((cur) => (cur ? { ...cur, value, error: null } : cur));
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    void commitRename();
                  } else if (e.key === 'Escape') {
                    // The list sits in a drawer and a tab that answer Escape too.
                    e.stopPropagation();
                    stopEditing(item.id);
                  }
                }}
              />
            ) : (
              <UnstyledButton
                onClick={() => startRename(item)}
                data-saved-name={item.id}
                aria-label={`Rename "${item.name}"`}
                title="Click to rename"
                style={{ display: 'block', maxWidth: '100%' }}
              >
                <Text fw={600} c={T.text} truncate="end" fz={T.fsSm}>
                  {item.name}
                </Text>
              </UnstyledButton>
            )}
            <Text fz={T.fsXs} c={T.textGhost} mt={1}>
              {new Date(item.updatedAt).toLocaleDateString()}
            </Text>
            {item.description && (
              <Text title={item.description} fz={T.fsXs} c={T.textGhost} mt={1} truncate="end">
                {item.description}
              </Text>
            )}
          </Box>
          <Tooltip label={item.kind === 'find' ? 'Run here' : 'Open in a new tab'} withArrow openDelay={400}>
            <Button
              variant="light"
              size="compact-xs"
              h={20}
              px={7}
              fz={T.fsXs}
              leftSection={item.kind === 'find' ? I.play : undefined}
              onClick={() => void handlePrimary(item)}
              aria-label={
                item.kind === 'find'
                  ? `Run "${item.name}" in this tab`
                  : `Open "${item.name}" in a new tab`
              }
            >
              {item.kind === 'find' ? 'Run' : '↗ Open'}
            </Button>
          </Tooltip>
          {/* W15 §13.5 — a tooltip is not an accessible name for an
              icon-only button; the aria-label says which query it deletes. */}
          <Tooltip label="Delete" withArrow openDelay={400}>
            <ActionIcon
              variant="default"
              size={22}
              c={deleting ? undefined : T.red}
              onClick={() => void requestDelete(item)}
              disabled={deleting}
              aria-label={`Delete "${item.name}"`}
            >
              {I.trash}
            </ActionIcon>
          </Tooltip>
        </Group>
      ))}

      {/* The highlighted entry's query, whole: read before it is loaded. Live,
          so moving the highlight with the keyboard reads it out. */}
      {!loading && !err && list.active && (
        <div
          data-testid="saved-preview"
          aria-live="polite"
          style={{
            position: 'sticky',
            bottom: 0,
            maxHeight: 120,
            overflowY: 'auto',
            padding: '6px 10px',
            borderTop: `1px solid ${T.border}`,
            background: T.surfaceRaised,
            color: activePreview ? T.text : T.textGhost,
            fontFamily: '"JetBrains Mono", monospace',
            fontSize: T.fsXs,
            whiteSpace: 'pre-wrap',
            overflowWrap: 'anywhere',
          }}
        >
          {activePreview === undefined ? 'Loading…' : (activePreview ?? 'no stored query')}
        </div>
      )}
    </div>
  );
}
