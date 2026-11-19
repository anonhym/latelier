import React from 'react';
import { IconDots, IconPin, IconPinFilled } from '@tabler/icons-react';
import { Button, Checkbox, Group, Modal, Table, Text, TextInput, VisuallyHidden } from '@mantine/core';
import { ContextMenu, type ContextMenuState } from '../../components/ContextMenu';
import { connectionRowMenu } from './connectionRowMenu';
import { themeVars } from '../../theme/themeVars';
import { I } from '../../icons';
import { api, getErrorMessage } from '../../api/atelier';
import { notifyConnectionsChanged } from '../../state/connections';
import { notifyReferenceRulesChanged } from '../references/useReferenceRules';
import { notifyRowSummaryChanged } from '../rowSummary/useRowSummary';
import { notify } from '../../theme/notifications';
import { tlsWarning } from '../../utils/hostLocality';
import { relativeTime } from '../../utils/relativeTime';
import { useRovingHighlight } from '../../hooks/useRovingHighlight';
import { STATUS_PRESENTATION, matchesConnectionQuery } from './connectionStatus';
import { RowActionIcon } from './RowActionIcon';
import { sortPinnedFirst } from '../../state/connectionPins';
import { usePinnedConnections } from '../../state/usePinnedConnections';
import { useConnectionTransfer } from './ConnectionTransferProvider';
import { ConnectionExportDialog } from './ConnectionExportDialog';
import { ConnectionDeleteDialog } from './ConnectionDeleteDialog';
import { AddToFamilyDialog, LeaveFamilyDialog } from './FamilyDialogs';
import { plural } from './familyCopy';
import { FamilyView } from './FamilyView';
import { ApplyFamilyExportDialog } from './ApplyFamilyExportDialog';
import type { Connection, ConnectionFamily, ConnectionSummary } from '@shared/types';

// the header row is built from this list (rather than each `Table.Th`
// hand-written) so the empty-state row's and the detail row's `colSpan` —
// derived below as `COLUMN_HEADERS.length` — cannot drift out of sync with
// however many columns actually exist: adding or removing an entry here
// updates both the header and every `colSpan` in the same edit.
const COLUMN_HEADERS = ['Name', 'Family', 'Host', 'Status', 'Last used', 'Actions'] as const;

// A fixed width for the trailing Actions column, reserved whether or not the
// row is selected — see the comment on that `Table.Td` for why a shrink-to-
// fit width caused a table-wide reflow on selection.
const ACTIONS_COLUMN_WIDTH = 150;
const CHECK_COLUMN_WIDTH = 32;

export interface ConnectionExpandedTableProps {
  connections: ConnectionSummary[];
  /** The Switcher's search text at the moment `⌘E` / "Manage all" was pressed. */
  initialQuery: string;
  /**
   * The Switcher trigger that opened this table — the TitleBar's compact
   * trigger and the empty state's CTA button can both be on screen at once
   * (see `ConnectionSwitcher.tsx`), so "the" trigger only makes sense as
   * whichever one the user actually used. Focus returns here on close (see
   * the effect below); `null` if the caller didn't have one to hand (e.g. a
   * future non-Switcher entry point) — closing then leaves focus wherever
   * the browser default lands, same as before this table tracked openers.
   */
  returnFocusTo: HTMLElement | null;
  onClose: () => void;
  /** Connect to (and make active) the selected Connection. Closes the table. */
  onConnect: (id: string) => void;
  /**
   * The deep "Collections & indexes" management screen. Closes the table.
   * the row action reads "Manage", matching the popover's own
   * vocabulary for the same destination.
   */
  onManage: (id: string) => void;
  onEdit: (id: string) => void;
  onDelete: (id: string) => void;
  /** Drops a row's live client; the caller owns confirming and closing its tabs. Closes the table. */
  onDisconnect: (id: string) => void;
  /** The full single-Connection form, from "+ New". Closes the table. */
  onAdd: () => void;
  /** The Import Wizard at its file source, from "Import". Closes the table. */
  onImport: () => void;
  /** Open tabs across these Connections, for the batch delete's copy; `null` while unknown. */
  tabCountFor: (ids: string[]) => number | null;
  /** The checked rows' batch delete, after its confirmation. The table stays open. */
  onDeleteMany: (ids: string[]) => Promise<void>;
}

/** What is stacked on the table; the table keeps its own Escape only when nothing is. */
type Stacked =
  | 'export'
  | { deleting: string[]; tabCount: number }
  | { addToFamily: string[] }
  | { leaveFamily: string[] }
  | { family: string }
  /** The apply dialog; `returnTo` is the Family view it was opened from, shown again when it closes. */
  | { applyExport: { familyId: string | null; returnTo: string | null } }
  | null;

/**
 * Renders the Family view once the family is in the loaded list, so a rename
 * (which reloads the list) shows its new name; a family that is gone closes it.
 */
function FamilyViewHost({ family, connections, onClose, onChanged, onApplyExport }: {
  family: ConnectionFamily | null;
  connections: ConnectionSummary[];
  onClose: () => void;
  onChanged: () => void;
  onApplyExport: (family: ConnectionFamily) => void;
}) {
  if (!family) return null;
  const exportFamily = async () => {
    try {
      const res = await api.families.export({ familyId: family.id });
      if (!res.saved) return;
      notify.success(
        res.ruleCount === 0 && res.rowSummaryCount === 0
          ? `Saved an empty export: "${family.name}" shares nothing yet.`
          : `Exported ${plural(res.ruleCount, 'rule')} and ${plural(res.rowSummaryCount, 'row summary')} from "${family.name}".`,
      );
    } catch (e) {
      notify.error(getErrorMessage(e, 'Could not write the family export'));
    }
  };
  return (
    <FamilyView
      family={family}
      connections={connections}
      onClose={onClose}
      onRenamed={onChanged}
      onDeleted={() => {
        onChanged();
        onClose();
      }}
      onExport={() => void exportFamily()}
      onApplyExport={onApplyExport}
    />
  );
}

function formatConnectionType(t: ConnectionSummary['connectionType']): string {
  return t === 'srv' ? 'SRV' : 'Standard';
}

function DetailField({ label, value, warn }: { label: string; value: string; warn?: boolean }) {
  const T = themeVars;
  return (
    <Text size="xs" c="dimmed">
      <span style={{ color: T.textMuted }}>{label}</span>
      {' · '}
      {/* The value text states the weakness itself; the colour only reinforces it. */}
      {warn ? <span style={{ color: T.redText, fontWeight: 600 }}>{value}</span> : value}
    </Text>
  );
}

/**
 * The row's inline detail. Configuration only — `api.conn.get`, not a
 * live-server fetch — so opening a row never depends on that Connection
 * being reachable. Live stats (version, storage, ops/sec) are what
 * "Collections & indexes" — the deep management screen — is for; duplicating
 * that here would mean a second serverInfo poller for a table row.
 *
 * `cachedDetail`/`onFetched` are the parent table's cache, keyed by
 * connection id (a row unmounts on collapse, so any state here alone is lost
 * the moment the user closes it) — re-opening a row already viewed this
 * session, e.g. while comparing two similarly-named Connections, reuses the
 * fetched config instead of round-tripping IPC and flashing "Loading…"
 * again. A failed fetch is deliberately not cached, so re-opening retries it.
 */
function ConnectionDetailRow({
  connectionId,
  cachedDetail,
  onFetched,
}: {
  connectionId: string;
  cachedDetail: Connection | undefined;
  onFetched: (connectionId: string, detail: Connection) => void;
}) {
  const [detail, setDetail] = React.useState<Connection | null>(cachedDetail ?? null);
  const [failed, setFailed] = React.useState(false);

  React.useEffect(() => {
    if (cachedDetail) return;
    let cancelled = false;
    void (async () => {
      try {
        const c = await api.conn.get(connectionId);
        if (!cancelled) {
          onFetched(connectionId, c);
          setDetail(c);
        }
      } catch {
        if (!cancelled) setFailed(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [connectionId, cachedDetail, onFetched]);

  if (failed) {
    return (
      <Text size="xs" c="dimmed" aria-live="polite">
        Couldn&apos;t load connection details.
      </Text>
    );
  }
  if (!detail) {
    return (
      <Text size="xs" c="dimmed" aria-live="polite">
        Loading…
      </Text>
    );
  }
  const tlsIsWeak =
    tlsWarning({
      enabled: detail.tls.enabled,
      verify: detail.tls.verify,
      host: detail.host,
      viaSshTunnel: Boolean(detail.ssh?.enabled),
    }) !== null;
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', columnGap: themeVars.gapXl, rowGap: themeVars.gapXs }}>
      <DetailField label="Default DB" value={detail.defaultDb || '—'} />
      <DetailField
        label="Auth"
        value={detail.authUsername ? `${detail.authMech} · ${detail.authUsername}` : detail.authMech}
      />
      <DetailField label="Auth DB" value={detail.authDatabase || '—'} />
      <DetailField
        label="TLS"
        value={
          detail.tls.enabled
            ? detail.tls.verify
              ? 'Enabled, verified'
              : 'Enabled, unverified'
            : tlsIsWeak
              ? 'Disabled, plaintext to a remote host'
              : 'Disabled'
        }
        warn={tlsIsWeak}
      />
      <DetailField
        label="SSH tunnel"
        value={detail.ssh?.enabled ? `${detail.ssh.username ?? '—'}@${detail.ssh.host ?? '—'}` : 'None'}
      />
    </div>
  );
}

/**
 * the expanded surface the ADR 0001 prototype findings added: `⌘E` or
 * the popover footer's "Manage all" button opens this in place of the popover
 * (never both — ADR 0001), for comparing similarly-named Connections or
 * reading/managing several in a row without the popover's 300px squeeze.
 *
 * Same search, same match semantics (name + host) as the popover — this is
 * the same tool at a larger size, not a different screen. Selecting a row
 * both reveals its detail inline (accordion-style, so the table keeps its
 * full width — no split panel) and renders Connect, Pin and the row's `⋯`
 * menu on that row (replacing an earlier select-then-travel-to-a-footer
 * design); there is no separate "selection" concept layered on top of
 * "expanded".
 *
 * Connect and the menu's actions route back through `Workspace`'s existing
 * handlers (`openConnection`, `openConnectionScreen`, `openEditConnectionModal`,
 * `openDeleteConnectionModal`) — the same ones the popover uses — rather than
 * parallel implementations, so the two surfaces can never disagree about
 * what "delete this Connection" does.
 *
 * Rows carry the popover's full roving-highlight contract, brought here
 * later: arrow keys move a single highlight without moving focus off
 * the search field, `aria-activedescendant` points at it, and Enter
 * selects/toggles the highlighted row's inline detail — the same one-gesture
 * contract as `ConnectionSwitcher.tsx`, reaching a row's own actions directly
 * rather than a shared set of controls elsewhere on the page. The highlight
 * is deliberately a separate thing from "selected" (what the row actions act
 * on): arrowing past a row shouldn't pop its detail open or render its
 * actions on your behalf, any more than arrowing through the popover
 * connects to a Connection before you press Enter — only an explicit Enter
 * (or a click) commits.
 *
 * Focus returns to `returnFocusTo` — the Switcher trigger that opened this
 * table — when this closes with nothing else opening in its place (Escape,
 * the header's close button, or clicking outside) — for the same reason
 * `ConnectionSwitcher` does it for the popover: without it, closing lands a
 * keyboard user at `<body>`, the top of the Data View's tab order. Mantine
 * `Modal`'s own `returnFocus` can't help — by the time this mounts, the
 * popover's "Manage all" button that would have been its target is already gone
 * (closing the popover is what opened this, per ADR 0001).
 *
 * This is wired to `Modal`'s own `onClose`, not a plain unmount effect,
 * because several actions here (a row's menu, the header's Add / Import,
 * Export) also unmount this table — straight into another
 * modal or a navigation, in the same commit. An unmount-keyed effect would
 * fire there too and race that other surface's own focus claim (its
 * `FocusTrap`, if it's a modal) for a coin-flip winner; `onClose` only ever
 * fires from an actual "just close" gesture, so those handoffs never touch
 * it.
 */
export function ConnectionExpandedTable({
  connections,
  initialQuery,
  returnFocusTo,
  onClose,
  onConnect,
  onManage,
  onEdit,
  onDelete,
  onDisconnect,
  onAdd,
  onImport,
  tabCountFor,
  onDeleteMany,
}: ConnectionExpandedTableProps) {
  const T = themeVars;
  const baseId = React.useId();
  const rowId = (connectionId: string) => `${baseId}-row-${connectionId}`;
  const [query, setQuery] = React.useState(initialQuery);
  const [selectedId, setSelectedId] = React.useState<string | null>(null);
  // C13 §8 — "checked" (batch actions) is a separate thing from "selected"
  // (the row whose detail is open).
  const [checked, setChecked] = React.useState<ReadonlySet<string>>(new Set());
  const [stacked, setStacked] = React.useState<Stacked>(null);
  const [menu, setMenu] = React.useState<ContextMenuState | null>(null);
  // Family names are read off each row; the list itself feeds the picker and the Family view.
  const [families, setFamilies] = React.useState<ConnectionFamily[]>([]);
  const reloadFamilies = React.useCallback(async () => {
    try {
      setFamilies(await api.families.list());
    } catch (e) {
      notify.error(getErrorMessage(e, 'Could not load the families'));
    }
  }, []);
  React.useEffect(() => {
    queueMicrotask(() => void reloadFamilies());
  }, [reloadFamilies]);
  const familyChanged = React.useCallback(() => {
    notifyConnectionsChanged();
    // Membership decides which shared rules and Row Summary a Connection uses, so the mounted readers re-ask.
    notifyReferenceRulesChanged();
    notifyRowSummaryChanged();
    void reloadFamilies();
  }, [reloadFamilies]);
  // Paste URIs opens the app's one Import Wizard, which stacks on this table
  // without being part of it.
  const transfer = useConnectionTransfer();
  const searchRef = React.useRef<HTMLInputElement>(null);
  const [detailCache, setDetailCache] = React.useState<Record<string, Connection>>({});
  const cacheDetail = React.useCallback((connectionId: string, detail: Connection) => {
    setDetailCache((prev) => (prev[connectionId] ? prev : { ...prev, [connectionId]: detail }));
  }, []);

  const { pinnedIds, togglePin } = usePinnedConnections(connections);
  const filtered = React.useMemo(
    () => sortPinnedFirst(connections, pinnedIds).filter((c) => matchesConnectionQuery(c, query)),
    [connections, pinnedIds, query],
  );

  // `resetKey: query` — a new search is a new list, same as the popover.
  const { index: highlightIndex, setIndex: setHighlightIndex, move: moveHighlight } =
    useRovingHighlight(filtered.length, query);
  const highlightedId = filtered[highlightIndex]?.id;
  // Pinning moves a row; the keyboard highlight follows it rather than landing
  // on whichever row took its old index.
  const followPinRef = React.useRef<string | null>(null);
  React.useEffect(() => {
    const id = followPinRef.current;
    if (id === null) return;
    followPinRef.current = null;
    const at = filtered.findIndex((c) => c.id === id);
    if (at >= 0) setHighlightIndex(at);
  }, [filtered, setHighlightIndex]);
  // Only rows on screen: a search never leaves a hidden row checked (see the
  // search field), and a Connection deleted elsewhere simply drops out.
  const checkedIds = filtered.filter((c) => checked.has(c.id)).map((c) => c.id);
  const checkedInFamily = filtered.filter((c) => checked.has(c.id) && c.familyId);
  const allChecked = filtered.length > 0 && checkedIds.length === filtered.length;
  const none = checkedIds.length === 0;
  const toggleChecked = (id: string) =>
    setChecked((prev) => {
      const next = new Set(prev);
      if (!next.delete(id)) next.add(id);
      return next;
    });

  const requestDeleteChecked = () => {
    const tabCount = tabCountFor(checkedIds);
    if (tabCount === null) return;
    setStacked({ deleting: checkedIds, tabCount });
  };
  const confirmDeleteChecked = async (ids: string[]) => {
    setStacked(null);
    await onDeleteMany(ids);
    // Only what was deleted: a row checked meanwhile stays checked.
    setChecked((prev) => new Set([...prev].filter((id) => !ids.includes(id))));
    // The bar that held focus may be gone with the checks.
    searchRef.current?.focus();
  };

  // Runs before this table unmounts (`onClose` fires synchronously from the
  // gesture; the parent's resulting state update unmounts on the next
  // render), so the trigger is still on screen to receive it.
  const handleClose = () => {
    onClose();
    returnFocusTo?.focus();
  };

  const rows = filtered.map((c, i) => {
    const open = selectedId === c.id;
    const isHighlighted = i === highlightIndex;
    const presentation = STATUS_PRESENTATION[c.status];
    // A click both commits the selection (what the row actions act on, and
    // whether the detail row is open) and moves the roving highlight to
    // match — so an arrow press right after a click continues from where
    // the mouse just was, instead of from wherever `⌘E` last left it.
    const toggle = () => {
      setSelectedId(open ? null : c.id);
      setHighlightIndex(i);
    };
    return (
      <React.Fragment key={c.id}>
        <Table.Tr
          id={rowId(c.id)}
          // `aria-selected` requires a `grid`/`treegrid` container to
          // mean anything to assistive tech — this is a plain `table`.
          // `aria-expanded` is what a row that discloses more content
          // underneath it actually is.
          aria-expanded={open}
          onClick={toggle}
          style={{
            cursor: 'pointer',
            // the roving highlight now shares the popover's row-edge
            // band idiom (a background + inset left edge) instead of an
            // inset outline, which was the only place in the app using that
            // device. Highlight wins the background over "open" and "active"
            // — it is the row the keyboard is on right now.
            background: isHighlighted
              ? T.accentSoft
              : open
                ? T.accentSoft
                : c.status === 'connected'
                  ? T.surfaceActive
                  : undefined,
            boxShadow: isHighlighted ? `inset 3px 0 0 ${T.accent}` : undefined,
          }}
        >
          {/* Clicks here belong to the checkbox, not to the row's own
              open/close toggle. */}
          <Table.Td style={{ width: CHECK_COLUMN_WIDTH }} onClick={(e) => e.stopPropagation()}>
            <Checkbox
              size="xs"
              aria-label={`Check ${c.name}`}
              checked={checked.has(c.id)}
              onChange={() => toggleChecked(c.id)}
            />
          </Table.Td>
          <Table.Td style={{ whiteSpace: 'nowrap' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: T.gapSm }}>
              <span style={{ color: T.textGhost, display: 'flex', flexShrink: 0 }}>
                {open ? I.chevD : I.chevR}
              </span>
              <span
                aria-hidden
                style={{
                  width: 8,
                  height: 8,
                  borderRadius: '50%',
                  background: c.color,
                  flexShrink: 0,
                }}
              />
              {/* Capped so a very long name can't crush Host to nothing. */}
              <span
                title={c.name}
                style={{
                  fontWeight: 600,
                  color: T.text,
                  maxWidth: 240,
                  minWidth: 0,
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                }}
              >
                {c.name}
              </span>
              {pinnedIds.has(c.id) && (
                <span aria-hidden title="Pinned" style={{ display: 'flex', color: T.textMuted, flexShrink: 0 }}>
                  <IconPinFilled size={11} />
                </span>
              )}
              {/* X16.4 — a marker per *connected* Connection, not one
                  per active one: several can be open at once (§4.6). */}
              {c.status === 'connected' && (
                <span aria-label="Connected" style={{ display: 'flex', color: T.accent, flexShrink: 0 }}>
                  {I.check}
                </span>
              )}
              {/* Runtime-only and cleared on disconnect: shown while connected. */}
              {c.status === 'connected' && c.serverVersion && (
                <span
                  title={`MongoDB ${c.serverVersion}`}
                  style={{ fontSize: T.fsXs, color: T.textMuted, fontFamily: 'ui-monospace, monospace', flexShrink: 0 }}
                >
                  v{c.serverVersion}
                </span>
              )}
            </div>
          </Table.Td>
          {/* Type (SRV / Standard) folds in as a dimmed suffix rather
              than its own column: five short columns for the widest surface
              in the app was the complaint, and Type never needed a header of
              its own to be legible next to the host. */}
          {/* maxWidth: 0 + width: 100% is the table-cell idiom for "take the
              leftover width, then ellipsize": the other cells stay one line
              (nowrap) and this long host gives way instead of wrapping. */}
          <Table.Td style={{ whiteSpace: 'nowrap' }} onClick={(e) => e.stopPropagation()}>
            {c.familyId && c.familyName ? (
              <Button
                size="compact-xs"
                variant="subtle"
                title={`Open the ${c.familyName} family`}
                onClick={() => setStacked({ family: c.familyId! })}
              >
                {c.familyName}
              </Button>
            ) : null}
          </Table.Td>
          <Table.Td
            title={`${c.host}:${c.port} · ${formatConnectionType(c.connectionType)}`}
            style={{
              fontFamily: 'ui-monospace, monospace',
              color: T.textMuted,
              maxWidth: 0,
              width: '100%',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}
          >
            {c.host}:{c.port}
            <Text span size="xs" c="dimmed"> · {formatConnectionType(c.connectionType)}</Text>
          </Table.Td>
          <Table.Td style={{ whiteSpace: 'nowrap' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: themeVars.gapXs }}>
              <span
                aria-hidden
                style={{
                  width: 6,
                  height: 6,
                  borderRadius: '50%',
                  background: presentation.band,
                  flexShrink: 0,
                }}
              />
              <span style={{ color: T.textMuted }}>{presentation.label}</span>
            </div>
          </Table.Td>
          <Table.Td style={{ color: T.textMuted, whiteSpace: 'nowrap' }}>{relativeTime(c.lastUsedAt, 'Never')}</Table.Td>
          {/* Connect, Pin and the row's `⋯` render here, on the selected
              row only, matching the popover's own "act on the highlighted
              row" grammar. `stopPropagation` on every click is
              load-bearing: the `<tr>`'s own `onClick` is `toggle`, so without
              it, clicking Connect would also collapse the detail row
              underneath the modal that is opening.

              A fixed `width` (not the shrink-to-fit `width: 1` this column
              used at first), matching the header's own width, is load-bearing
              too: this cell is empty on every row but the selected one, so
              without a reserved width the whole table's auto layout reflows
              — the actions column snapping from ~0 to full width, and every
              other column shifting with it — the moment a row is selected. */}
          <Table.Td style={{ width: ACTIONS_COLUMN_WIDTH, whiteSpace: 'nowrap' }}>
            {open && (
              <Group gap={T.gapXs} justify="flex-end" wrap="nowrap">
                <Button
                  size="compact-xs"
                  variant="filled"
                  onClick={(e) => { e.stopPropagation(); onConnect(c.id); }}
                >
                  Connect
                </Button>
                <RowActionIcon
                  // One name, with the state in aria-pressed: a flipping name would read as a double negative.
                  label={`Pin ${c.name}`}
                  tooltip={`${pinnedIds.has(c.id) ? 'Unpin' : 'Pin'} ${c.name}`}
                  pressed={pinnedIds.has(c.id)}
                  onClick={() => {
                    followPinRef.current = c.id;
                    // Cleared once settled: pinning a row already on top moves nothing.
                    void togglePin(c.id).finally(() => {
                      followPinRef.current = null;
                    });
                  }}
                >
                  {pinnedIds.has(c.id) ? <IconPinFilled size={13} /> : <IconPin size={13} />}
                </RowActionIcon>
                {/* The same menu as a Switcher row, so the two surfaces list the same actions. */}
                <RowActionIcon
                  label={`Actions for ${c.name}`}
                  onClick={(e) => {
                    const rect = e.currentTarget.getBoundingClientRect();
                    setMenu({
                      x: rect.left,
                      y: rect.bottom,
                      items: connectionRowMenu(c, {
                        onManage,
                        onEdit,
                        onDisconnect,
                        onDelete,
                        onAddToFamily: (id) => setStacked({ addToFamily: [id] }),
                        onLeaveFamily: (id) => setStacked({ leaveFamily: [id] }),
                      }),
                      returnFocusTo: e.currentTarget,
                    });
                  }}
                >
                  <IconDots size={14} />
                </RowActionIcon>
              </Group>
            )}
          </Table.Td>
        </Table.Tr>
        {open && (
          <Table.Tr>
            <Table.Td colSpan={COLUMN_HEADERS.length + 1} style={{ background: T.surfaceRaised, paddingLeft: 38 + CHECK_COLUMN_WIDTH }}>
              <div style={{ padding: '6px 0' }}>
                <ConnectionDetailRow
                  connectionId={c.id}
                  cachedDetail={detailCache[c.id]}
                  onFetched={cacheDetail}
                />
              </div>
            </Table.Td>
          </Table.Tr>
        )}
      </React.Fragment>
    );
  });

  return (
    <>
    <Modal
      opened
      onClose={handleClose}
      title="Connections"
      size="xl"
      centered
      // Mantine closes every open modal on a window-level Escape, so a dialog
      // stacked on this one would take the table down with it.
      closeOnEscape={stacked === null && !transfer.isOpen}
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: T.gapMd }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: themeVars.gapSm }}>
          <TextInput
            // Not `autoFocus`: this Modal wraps its body in Mantine's
            // `FocusTrap`, which looks for `[data-autofocus]` first and only
            // falls back to "first tabbable element" if it finds none — and
            // that fallback would be the Modal's own header close button
            // (rendered before the body in the DOM), not this field. Without
            // `data-autofocus`, "search-first" — the whole reason this
            // surface exists — silently breaks on open.
            data-autofocus
            ref={searchRef}
            size="xs"
            style={{ flex: 1 }}
            aria-label="Search connections"
            // Same combobox pattern as ConnectionSwitcher's search field: the
            // highlight roves via `aria-activedescendant` while focus stays
            // here, so arrow keys never leave the input.
            aria-activedescendant={highlightedId ? rowId(highlightedId) : undefined}
            placeholder="Search connections…"
            leftSection={I.search}
            value={query}
            onChange={(e) => {
              const next = e.currentTarget.value;
              setQuery(next);
              // A new search is a new list — a selection the search just
              // hid would leave the row actions on a Connection nobody
              // can see. Checks the search hides are dropped for the same
              // reason: a batch action must never reach a hidden row.
              setSelectedId(null);
              setChecked(
                (prev) => new Set(connections.filter((c) => prev.has(c.id) && matchesConnectionQuery(c, next)).map((c) => c.id)),
              );
            }}
            // `stopPropagation` on every branch below: this modal sits above
            // window-level keydown listeners (AggregationTab's ⌘↵ pipeline
            // run, Workspace's ⌘1-9/T/W tab switching) that never check
            // `defaultPrevented`. Same contract as ConnectionSwitcher's
            // `handleKeyDown`.
            onKeyDown={(e) => {
              if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
                e.stopPropagation();
                if (filtered.length === 0) return;
                e.preventDefault();
                moveHighlight(e.key === 'ArrowDown' ? 1 : -1);
                return;
              }
              if (e.key === 'Enter') {
                if (e.nativeEvent.isComposing) return;
                e.stopPropagation();
                const target = filtered[highlightIndex];
                if (!target) return;
                e.preventDefault();
                setSelectedId(selectedId === target.id ? null : target.id);
              }
            }}
          />
          {/* `aria-live`: a screen-reader user narrowing the search hears the
              count update without having to go find it. */}
          <Text size="xs" c="dimmed" style={{ whiteSpace: 'nowrap' }} aria-live="polite">
            {filtered.length} of {connections.length}
          </Text>
          {/* Beside the search, not under the table: creating a Connection is
              the first thing an empty list is opened for. */}
          <Button size="compact-xs" variant="light" onClick={onAdd}>
            + New
          </Button>
          {/* The app's own menu, not Mantine's: that one returns focus to this
              button on a timer, after the wizard it opened has taken it. */}
          <Button
            size="compact-xs"
            variant="default"
            aria-haspopup="menu"
            rightSection={<span aria-hidden style={{ display: 'flex' }}>{I.chevD}</span>}
            onClick={(e) => {
              const rect = e.currentTarget.getBoundingClientRect();
              setMenu({
                x: rect.left,
                y: rect.bottom,
                returnFocusTo: e.currentTarget,
                items: [
                  { kind: 'item', label: 'From a file…', onClick: onImport },
                  // A Compass export is a file too: the wizard tells the two apart.
                  { kind: 'item', label: 'From Compass…', onClick: onImport },
                  { kind: 'item', label: 'Paste URIs…', onClick: () => transfer.openImport('paste') },
                ],
              });
            }}
          >
            Import
          </Button>
          <Button
            size="compact-xs"
            variant="default"
            title="Add the shared reference rules and row summaries of a family export to a family"
            onClick={() => setStacked({ applyExport: { familyId: null, returnTo: null } })}
          >
            Apply family export…
          </Button>
        </div>

        {/* Drawn on the first check and gone with the last: it used to sit
            disabled above the table whatever was checked. */}
        {!none && (
          <Group gap="xs" role="toolbar" aria-label="Checked connections">
            <Button size="compact-xs" variant="light" onClick={() => setStacked('export')}>
              Export
            </Button>
            <Button size="compact-xs" variant="light" onClick={() => setStacked({ addToFamily: checkedIds })}>
              Add to family…
            </Button>
            <Button
              size="compact-xs"
              variant="light"
              disabled={checkedInFamily.length === 0}
              title={checkedInFamily.length === 0 ? 'None of the checked connections is in a family' : undefined}
              onClick={() => setStacked({ leaveFamily: checkedInFamily.map((c) => c.id) })}
            >
              Leave family
            </Button>
            <Button size="compact-xs" variant="light" color="red" onClick={requestDeleteChecked}>
              Delete
            </Button>
            <Text size="xs" c="dimmed">
              {checkedIds.length} checked
            </Text>
            <Button
              size="compact-xs"
              variant="subtle"
              onClick={() => {
                setChecked(new Set());
                // The bar leaves with the checks; the keyboard goes back to the search.
                searchRef.current?.focus();
              }}
            >
              Clear
            </Button>
          </Group>
        )}

        <div style={{ maxHeight: '55vh', overflowY: 'auto' }}>
          <Table
            highlightOnHover
            // "Every Connection is comparable at a glance" only holds if the
            // columns stay put once the list is tall enough to scroll — a
            // header that scrolls away with row 1 would leave rows past the
            // fold unlabeled.
            stickyHeader
            styles={{
              table: { fontSize: T.fsSm },
              th: {
                fontSize: T.fsXs,
                fontWeight: 600,
                whiteSpace: 'nowrap',
                color: T.textMuted,
                padding: '8px 12px',
              },
              td: { padding: '8px 12px', verticalAlign: 'middle' },
            }}
          >
            <Table.Thead>
              <Table.Tr>
                <Table.Th style={{ width: CHECK_COLUMN_WIDTH }}>
                  <Checkbox
                    size="xs"
                    aria-label="Check all shown connections"
                    checked={allChecked}
                    indeterminate={checkedIds.length > 0 && !allChecked}
                    disabled={filtered.length === 0}
                    onChange={() =>
                      setChecked((prev) => {
                        const next = new Set(prev);
                        for (const c of filtered) {
                          if (allChecked) next.delete(c.id);
                          else next.add(c.id);
                        }
                        return next;
                      })
                    }
                  />
                </Table.Th>
                {COLUMN_HEADERS.map((label, i) => {
                  const isLast = i === COLUMN_HEADERS.length - 1;
                  return (
                    <Table.Th key={label} style={isLast ? { width: ACTIONS_COLUMN_WIDTH } : undefined}>
                      {/* The Actions column has no visible header — the row
                          actions announce themselves via their own
                          aria-labels — but a screen reader reading the table
                          structure still needs a name for the column. */}
                      {isLast ? <VisuallyHidden>{label}</VisuallyHidden> : label}
                    </Table.Th>
                  );
                })}
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {filtered.length === 0 ? (
                <Table.Tr>
                  <Table.Td
                    colSpan={COLUMN_HEADERS.length + 1}
                    style={{ textAlign: 'center', color: T.textMuted, padding: 24 }}
                  >
                    {/* "+ New" is always in the header above — this cell just names the state. */}
                    {connections.length === 0
                      ? 'No connections yet'
                      : <>No connections match &quot;{query}&quot;</>}
                  </Table.Td>
                </Table.Tr>
              ) : (
                rows
              )}
            </Table.Tbody>
          </Table>
        </div>

      </div>
      {stacked === 'export' && <ConnectionExportDialog ids={checkedIds} onClose={() => setStacked(null)} />}
      {stacked !== null && typeof stacked === 'object' && 'addToFamily' in stacked && (
        <AddToFamilyDialog
          connections={connections.filter((c) => stacked.addToFamily.includes(c.id))}
          families={families}
          onCancel={() => setStacked(null)}
          onDone={(family) => {
            setStacked(null);
            familyChanged();
            notify.success(`Added to "${family.name}".`);
          }}
        />
      )}
      {stacked !== null && typeof stacked === 'object' && 'leaveFamily' in stacked && (
        <LeaveFamilyDialog
          connections={connections.filter((c) => stacked.leaveFamily.includes(c.id))}
          onCancel={() => setStacked(null)}
          onDone={() => {
            setStacked(null);
            familyChanged();
          }}
        />
      )}
      {stacked !== null && typeof stacked === 'object' && 'family' in stacked && (
        <FamilyViewHost
          family={families.find((f) => f.id === stacked.family) ?? null}
          connections={connections}
          onClose={() => setStacked(null)}
          onChanged={familyChanged}
          onApplyExport={(f) => setStacked({ applyExport: { familyId: f.id, returnTo: f.id } })}
        />
      )}
      {stacked !== null && typeof stacked === 'object' && 'applyExport' in stacked && (
        <ApplyFamilyExportDialog
          families={families}
          connections={connections}
          initialFamilyId={stacked.applyExport.familyId}
          onClose={() => setStacked(stacked.applyExport.returnTo ? { family: stacked.applyExport.returnTo } : null)}
          onApplied={familyChanged}
        />
      )}
      {stacked !== null && typeof stacked === 'object' && 'deleting' in stacked && (
        <ConnectionDeleteDialog
          // One checked row is an ordinary delete: type its name, as anywhere else.
          name={
            stacked.deleting.length === 1
              ? (connections.find((c) => c.id === stacked.deleting[0])?.name ?? '')
              : `delete ${stacked.deleting.length}`
          }
          count={stacked.deleting.length}
          tabCount={stacked.tabCount}
          onCancel={() => setStacked(null)}
          onConfirm={() => void confirmDeleteChecked(stacked.deleting)}
        />
      )}
    </Modal>
    {/* Beside the Modal, not inside it: the Modal's content is a transformed
        box, which re-bases the menu's fixed anchor and hides the dropdown. */}
    {menu && <ContextMenu menu={menu} onClose={() => setMenu(null)} />}
    </>
  );
}
