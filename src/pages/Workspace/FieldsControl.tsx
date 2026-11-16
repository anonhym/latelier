import React from 'react';
import {
  ActionIcon,
  Badge,
  Button,
  Checkbox,
  Popover,
  Stack,
  TextInput,
  VisuallyHidden,
} from '@mantine/core';
import { themeVars } from '../../theme/themeVars';
import { I } from '../../icons';
import { useCollectionWorkspace } from './context';
import { useProjectionDraft, type ProjectionDraft } from './useProjectionDraft';
import { EMPTY_DOCUMENTS } from './resultSelection';
import { deriveColumns, orderFields } from './views/tableColumns';
import { requestColumnScroll } from './views/columnScroll';
import { focusTargetAfterMove, type MoveDirection } from './columnReorderFocus';
import { projectionProblem } from './builder';
import { optionPills, PILL_LOOK, type PillStatus } from './optionPills';
import { notFetchedFields } from './projection';
import { FieldAutocompleteInput } from '../../features/fieldSuggestions/FieldAutocompleteInput';
import type { SuggestionContext } from '../../features/fieldSuggestions/types';
import type { CollectionTabState, ComputedColumn } from '@shared/types';

/**
 * Fields control (T2.5, AC3/AC4/AC8) — two questions about fields, kept in
 * two visibly separate sections because they are different kinds of thing:
 *
 * - **Show in results** — display only, instant, nothing re-fetched.
 *   Show/hide + reorder the schema-derived fields, shared by Tree, JSON and
 *   Table (Table consumes the config for its columns; Tree reads it too, for
 *   its collapsed-row preview — see `TreeView.tsx`. JSON reads the hidden
 *   list too — see `JsonView.tsx`). Also add/remove dotted-path computed
 *   columns, but that part only renders in Table — `computed` only ever
 *   feeds `TableView`'s column resolution (`tableColumns.ts`), so offering it
 *   elsewhere would let a user add a column that visibly does nothing.
 * - **Fetch only these fields from the server** — the projection
 *   (`builder.projection` / `builder.projectionRaw`), a query concern: it
 *   changes what the server returns and applies on the next Run. It sits
 *   beside the display toggles, which is what teaches the difference
 *   (W14 §4). Hidden for read-only consumers, which have no Run to apply it.
 *
 * Its trigger is the Filter Bar row's `Project` pill (W05 §9.2): the
 * projection is one of the query's options, so it sits with them.
 *
 * A field the projection keeps off the wire is listed as "not fetched"
 * rather than silently missing from the list.
 *
 * A Popover-anchored-Button pattern; reads everything off
 * `useCollectionWorkspace()` (documents, `columnConfig`, `builder`) so it
 * needs no prop plumbing, and writes back
 * through the existing `actions.patchWith` read-modify-write — the same
 * pattern `columns` / `expandedRows` / `schema` already use — or, for the
 * projection, `actions.patch({ builder })` as the query bar does for sort.
 */
export function FieldsControl({
  controlled,
  target,
  projection: sharedProjection,
}: {
  /**
   * The projection's draft, when the owner keeps it: the query bar renders
   * this control in two places (the pill group and the folded `Options` pill),
   * and a draft must survive the row changing form under it.
   */
  projection?: ProjectionDraft;
  /** The folded `Options` pill opens this editor from its menu, so the row holds its open state. */
  controlled?: { opened: boolean; onOpenedChange: (next: boolean) => void };
  /**
   * Anchors the dropdown to this instead of the `Project` pill. It is handed
   * the pill's status, which counts a refused draft the builder never saw.
   */
  target?: (status: PillStatus) => React.ReactElement;
} = {}) {
  const T = themeVars;
  const { state, actions, meta } = useCollectionWorkspace();
  const isTableView = state.view === 'Table';
  const documents = state.lastRun?.documents ?? EMPTY_DOCUMENTS;
  const config = state.columnConfig;
  const [newPath, setNewPath] = React.useState('');
  const [ownOpened, setOwnOpened] = React.useState(false);
  const opened = controlled ? controlled.opened : ownOpened;
  const setOpened = controlled ? controlled.onOpenedChange : setOwnOpened;
  const [find, setFind] = React.useState('');
  // Stable, so it runs once per mount of the dropdown and not on every render.
  const focusFindOnMount = React.useCallback((el: HTMLInputElement | null) => {
    if (el) window.setTimeout(() => el.focus(), 0);
  }, []);
  const canFetch = !meta.isReadOnly;
  const ownProjection = useProjectionDraft();
  const projection = sharedProjection ?? ownProjection;
  const projRawError = projectionProblem(state.builder);
  // Same four inputs `Workspace.tsx` feeds the query bar's completion, built
  // here off the context so the control still needs no props.
  const suggestionContext = React.useMemo<SuggestionContext>(
    () => ({
      connectionId: meta.connectionId,
      dbName: meta.dbName,
      collection: meta.collection,
      recentDocs: documents,
    }),
    [meta.connectionId, meta.dbName, meta.collection, documents],
  );

  const derived = React.useMemo(() => deriveColumns(documents), [documents]);
  const orderedFields = React.useMemo(
    () => orderFields(derived, config?.order),
    [derived, config?.order],
  );
  // The find box narrows what the list draws; every row keeps its place in
  // the full order, which the move buttons and drag reorder by.
  const shownFields = React.useMemo(() => {
    const needle = find.trim().toLowerCase();
    return orderedFields
      .map((field, index) => ({ field, index }))
      .filter(({ field }) => field.toLowerCase().includes(needle));
  }, [orderedFields, find]);
  const hidden = React.useMemo(() => new Set(config?.hidden ?? []), [config?.hidden]);
  const computed = config?.computed ?? [];
  // Names known without asking the server: the fields in hand, plus any the
  // tab's own config still remembers from before the projection dropped them.
  const notFetched = React.useMemo(
    () =>
      new Set(
        notFetchedFields(state.builder, [
          ...new Set([...derived, ...(config?.order ?? []), ...(config?.hidden ?? [])]),
        ]),
      ),
    [state.builder, derived, config?.order, config?.hidden],
  );
  const notFetchedOnly = [...notFetched].filter((f) => !derived.includes(f));
  // A listed field is marked only once it is really gone from the results in
  // hand — a projection committed but not yet run still has it on screen.
  // In practice that is `_id`, which `deriveColumns` lists unconditionally.
  const absentInPlace = (field: string) =>
    notFetched.has(field) &&
    !documents.some((d) => typeof d === 'object' && d !== null && Object.hasOwn(d, field));

  const patchColumnConfig = (
    updater: (prev: NonNullable<CollectionTabState['columnConfig']>) => CollectionTabState['columnConfig'],
  ) => {
    actions.patchWith((prev) => ({
      columnConfig: updater(prev.columnConfig ?? {}),
    }));
  };

  const toggleHidden = (field: string) => {
    patchColumnConfig((prev) => {
      const prevHidden = prev.hidden ?? [];
      const nextHidden = prevHidden.includes(field)
        ? prevHidden.filter((f) => f !== field)
        : [...prevHidden, field];
      return { ...prev, hidden: nextHidden };
    });
  };

  const moveField = (from: number, to: number) => {
    if (to < 0 || to >= orderedFields.length || from === to) return;
    patchColumnConfig((prev) => {
      // Recompute against the *current* orderedFields (closed over at call
      // time) rather than `prev.order` directly — `prev.order` may not yet
      // list every derived field (schema drift), and dragging must reorder
      // the full visible list the user sees, not just their explicit order.
      const next = orderedFields.slice();
      const [moved] = next.splice(from, 1);
      next.splice(to, 0, moved);
      return { ...prev, order: next };
    });
  };

  const dragIndex = React.useRef<number | null>(null);

  // Keyboard reorder path (#57): same `moveField` entry point as onDrop, plus
  // focus management drag never needed. Moving a field to an end disables
  // the button the user just pressed (acceptance: disabled, not a no-op) —
  // a disabled focused button drops focus to <body> (the #55/#70 defect), so
  // `pendingMoveRef` records which button was pressed and a layout effect,
  // once `orderedFields` reflects the real reorder, redirects focus to the
  // still-enabled sibling button on that same row.
  const buttonRefs = React.useRef(new Map<string, { up: HTMLButtonElement | null; down: HTMLButtonElement | null }>());
  const pendingMoveRef = React.useRef<{ field: string; direction: MoveDirection } | null>(null);
  const [announcement, setAnnouncement] = React.useState('');

  const requestMove = (field: string, index: number, direction: MoveDirection) => {
    const to = direction === 'up' ? index - 1 : index + 1;
    if (to < 0 || to >= orderedFields.length) return;
    pendingMoveRef.current = { field, direction };
    setAnnouncement(`${field} moved to position ${to + 1} of ${orderedFields.length}`);
    moveField(index, to);
  };

  React.useLayoutEffect(() => {
    const pending = pendingMoveRef.current;
    if (!pending) return;
    pendingMoveRef.current = null;
    const newIndex = orderedFields.indexOf(pending.field);
    if (newIndex === -1) return;
    const refs = buttonRefs.current.get(pending.field);
    if (!refs) return;
    refs[focusTargetAfterMove(pending.direction, newIndex, orderedFields.length)]?.focus();
  }, [orderedFields]);

  const setButtonRef = (field: string, which: MoveDirection) => (el: HTMLButtonElement | null) => {
    const entry = buttonRefs.current.get(field) ?? { up: null, down: null };
    entry[which] = el;
    buttonRefs.current.set(field, entry);
  };

  const trimmedNewPath = newPath.trim();
  const isDuplicatePath = computed.some((c) => c.path === trimmedNewPath);
  const canAdd = trimmedNewPath.length > 0 && !isDuplicatePath;

  const addComputedColumn = () => {
    if (!canAdd) return;
    const column: ComputedColumn = {
      id: crypto.randomUUID(),
      path: trimmedNewPath,
    };
    patchColumnConfig((prev) => ({
      ...prev,
      computed: [...(prev.computed ?? []), column],
    }));
    setNewPath('');
  };

  const removeComputedColumn = (id: string) => {
    patchColumnConfig((prev) => ({
      ...prev,
      computed: (prev.computed ?? []).filter((c) => c.id !== id),
    }));
  };

  const hiddenCount = hidden.size;
  const showCountBadge = hiddenCount > 0 || (isTableView && computed.length > 0);
  // The pill is the projection's only sign while the control is closed — it
  // changes what Run returns, so it states the value, and is drawn in the
  // error colour while a refused draft is still waiting inside (W15 §2.4).
  const pill = optionPills(state).find((p) => p.key === 'project')!;
  const pillStatus = projection.message !== null ? 'invalid' : pill.status;

  const sectionHeadingStyle: React.CSSProperties = {
    fontSize: T.fsXs,
    fontWeight: 700,
    letterSpacing: 0.6,
    textTransform: 'uppercase',
    color: T.textMuted,
  };
  const sectionHelpStyle: React.CSSProperties = {
    fontSize: T.fsXs,
    color: T.textMuted,
    margin: '2px 0 6px',
  };
  const noticeStyle: React.CSSProperties = {
    marginTop: 4,
    fontSize: T.fsXs,
    lineHeight: 1.3,
    color: T.warn,
  };

  // The dropdown unmounts on close but `announcement` lives out here, so
  // without the reset the live region is reborn already holding the last
  // move's sentence. `aria-live` only announces mutations, never the content
  // a region mounts with, so that text is never spoken — it just sits in the
  // accessibility tree describing a move from last time.
  //
  // Closing also settles the projection draft: jsdom and Chromium alike may
  // skip the input's blur when the dropdown unmounts under it.
  const close = () => {
    setOpened(false);
    setFind('');
    setAnnouncement('');
    projection.commit();
  };

  return (
    <Popover
      opened={opened}
      // Controlled only so Escape can be layered: Mantine's own Escape close
      // is a capture-phase handler on the dropdown, which fires before the
      // projection input's suggestion list can claim the key. The bubble-phase
      // `onKeyDown` below closes only when nothing inside already did.
      closeOnEscape={false}
      position="bottom-start"
      shadow="md"
      withinPortal
      // #79 — a click that closes the popover on a non-focusable area
      // otherwise drops focus to <body>. Mantine's own `useFocusReturn` only
      // restores when the element focused at close is still `null`/`<body>`/
      // itself, so a click on another control still keeps focus there. Safe
      // here only because nothing in this dropdown autofocuses on open —
      // Mantine captures its return target in a passive effect *after* open,
      // so an autofocused element would win that race (see
      // `ConnectionSwitcher`, which can't use this for that reason).
      returnFocus
      onChange={(next) => (next ? setOpened(true) : close())}
    >
      <Popover.Target>
        {target ? target(pillStatus) : (
        <Button
          // A controlled Popover's target does not toggle by itself.
          onClick={() => (opened ? close() : setOpened(true))}
          {...PILL_LOOK[pillStatus]}
          size="compact-xs"
          h={22}
          data-testid="option-pill-project"
          data-status={pillStatus}
          style={{ flexShrink: 0 }}
          // The display toggles' only sign while the control is closed.
          rightSection={
            showCountBadge ? (
              <Badge size="xs" variant="light" color="violet">
                {isTableView && computed.length > 0 ? `+${computed.length}` : hiddenCount}
              </Badge>
            ) : undefined
          }
        >
          {/* A refused draft is not in the state the label is read from. */}
          {pillStatus === 'invalid' ? `${pill.name}: invalid` : pill.label}
        </Button>
        )}
      </Popover.Target>
      <Popover.Dropdown
        p="xs"
        style={{ maxWidth: 320 }}
        onKeyDown={(e) => {
          // `defaultPrevented`: an open suggestion list took this Escape to
          // close itself — the next one closes the control.
          if (e.key === 'Escape' && !e.defaultPrevented) {
            // Stopped here so the key does not also reach whatever sits behind the control.
            e.stopPropagation();
            close();
          }
        }}
      >
        <div id="fields-show-heading" style={sectionHeadingStyle}>Show in results</div>
        <div style={sectionHelpStyle}>Display only — instant, nothing is re-fetched.</div>
        {documents.length === 0 ? (
          <div style={{ padding: '4px 8px', fontSize: T.fsSm, color: T.textMuted }}>
            No fields available
          </div>
        ) : (
          <>
          <TextInput
            size="xs"
            aria-label="Find a field"
            placeholder="Find a field"
            value={find}
            // Focus moves in a tick after open: Mantine records the element to
            // return focus to in an effect after the open commit, and focusing
            // first would make this input that element.
            ref={focusFindOnMount}
            onChange={(e) => setFind(e.currentTarget.value)}
            onKeyDown={(e) => {
              if (e.key !== 'Enter' || shownFields.length === 0) return;
              e.preventDefault();
              if (isTableView) requestColumnScroll(shownFields[0].field);
            }}
            mb={4}
          />
          {shownFields.length === 0 && (
            <div style={{ padding: '4px 8px', fontSize: T.fsSm, color: T.textMuted }}>
              No field matches
            </div>
          )}
          <Stack gap={T.gapXs} style={{ maxHeight: 260, overflowY: 'auto', minWidth: 200 }}>
            {shownFields.map(({ field, index }) => (
              <div
                key={field}
                draggable
                onDragStart={() => {
                  dragIndex.current = index;
                }}
                onDragEnd={() => {
                  // A drag cancelled without a drop (Escape, or dropped
                  // outside a valid target) never fires onDrop, leaving a
                  // stale index for an unrelated later drop to consume.
                  dragIndex.current = null;
                }}
                onDragOver={(e) => e.preventDefault()}
                onDrop={(e) => {
                  e.preventDefault();
                  const from = dragIndex.current;
                  dragIndex.current = null;
                  if (from === null) return;
                  moveField(from, index);
                }}
                style={{ display: 'flex', alignItems: 'center', gap: themeVars.gapXs, cursor: 'grab' }}
                title="Drag to reorder"
              >
                <span style={{ color: T.textGhost, fontSize: T.fsXs, display: 'flex' }}>{I.drag}</span>
                <Checkbox
                  size="xs"
                  label={
                    absentInPlace(field) ? (
                      <>
                        {field} <span style={{ color: T.textMuted }}>— not fetched</span>
                      </>
                    ) : (
                      field
                    )
                  }
                  checked={!hidden.has(field)}
                  onChange={() => toggleHidden(field)}
                  style={{ flex: 1 }}
                />
                {isTableView && !hidden.has(field) && (
                  <ActionIcon
                    size="xs"
                    variant="subtle"
                    aria-label={`Scroll to ${field}`}
                    onClick={() => requestColumnScroll(field)}
                  >
                    {I.arrowR}
                  </ActionIcon>
                )}
                <ActionIcon
                  size="xs"
                  variant="subtle"
                  aria-label={`Move ${field} up`}
                  disabled={index === 0}
                  ref={setButtonRef(field, 'up')}
                  onClick={() => requestMove(field, index, 'up')}
                >
                  {I.chevU}
                </ActionIcon>
                <ActionIcon
                  size="xs"
                  variant="subtle"
                  aria-label={`Move ${field} down`}
                  disabled={index === orderedFields.length - 1}
                  ref={setButtonRef(field, 'down')}
                  onClick={() => requestMove(field, index, 'down')}
                >
                  {I.chevD}
                </ActionIcon>
              </div>
            ))}
          </Stack>
          </>
        )}
        {/* Outside the reorderable list on purpose: these rows have no data
            to show or hide, and keeping them out of `orderedFields` leaves
            the index-based drag and keyboard-move logic untouched. */}
        {notFetchedOnly.length > 0 && (
          <Stack gap={themeVars.gapXs} mt={4} data-testid="fields-not-fetched">
            {notFetchedOnly.map((field) => (
              <div key={field} style={{ fontSize: T.fsSm, color: T.textMuted, paddingLeft: 17 }}>
                {field} — not fetched
              </div>
            ))}
          </Stack>
        )}
        {/* `aria-live`: announces a keyboard reorder's result, which is
            otherwise silent to anyone not watching the list (#57). */}
        <VisuallyHidden aria-live="polite">{announcement}</VisuallyHidden>

        {/* Computed columns only feed TableView's rendering — meaningless
            in Tree/JSON, so the whole section (list + add form) is Table-only. */}
        {isTableView && (
          <>
            {computed.length > 0 && (
              <Stack gap={T.gapXs} mt="xs" style={{ minWidth: 200 }}>
                {computed.map((c) => (
                  <div
                    key={c.id}
                    style={{ display: 'flex', alignItems: 'center', gap: themeVars.gapXs, fontSize: T.fsXs }}
                  >
                    <span style={{ flex: 1, color: T.text, fontFamily: 'monospace' }}>
                      {c.label ?? c.path}
                    </span>
                    <ActionIcon
                      size="xs"
                      variant="subtle"
                      color="red"
                      aria-label={`Remove ${c.label ?? c.path}`}
                      onClick={() => removeComputedColumn(c.id)}
                    >
                      {I.close}
                    </ActionIcon>
                  </div>
                ))}
              </Stack>
            )}

            <div style={{ display: 'flex', gap: themeVars.gapXs, marginTop: 8 }}>
              <TextInput
                size="xs"
                aria-label="Computed column path"
                placeholder="e.g. address.city"
                value={newPath}
                onChange={(e) => setNewPath(e.currentTarget.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') addComputedColumn();
                }}
                style={{ flex: 1 }}
              />
              <Button
                size="compact-xs"
                aria-label="Add column"
                disabled={!canAdd}
                onClick={addComputedColumn}
              >
                Add
              </Button>
            </div>
          </>
        )}

        {canFetch && (
          <div style={{ marginTop: 10, paddingTop: 8, borderTop: `1px solid ${T.border}` }}>
            <div id="fields-fetch-heading" style={sectionHeadingStyle}>
              Fetch only these fields from the server
            </div>
            <div id="fields-fetch-help" style={sectionHelpStyle}>
              Changes what the server returns — applied on the next Run.
            </div>
            <FieldAutocompleteInput
              value={projection.value}
              onChange={projection.onChange}
              context={suggestionContext}
              mode="token"
              onBlur={projection.commit}
              onKeyDown={(e) => {
                if (e.key !== 'Enter' || e.defaultPrevented) return;
                // The panel-level ⌘↵ skips anything inside a dialog, and this
                // dropdown is one — so Run-from-here is handled here, with
                // the settled builder as the override since the patch it
                // just made has not landed yet.
                e.preventDefault();
                const next = projection.commit();
                if ((e.metaKey || e.ctrlKey) && next !== null && !meta.isLoading) {
                  actions.run({ builder: next });
                }
              }}
              placeholder="{ field: 1 }"
              dataTestid="fields-projection"
              ariaLabel="Projection"
              ariaInvalid={projection.message !== null || projRawError !== null}
              ariaDescribedBy={
                projection.message
                  ? 'fields-projection-error'
                  : projRawError
                    ? 'fields-projection-raw-error'
                    : 'fields-fetch-help'
              }
              style={{
                width: '100%',
                boxSizing: 'border-box',
                fontFamily: '"JetBrains Mono", monospace',
                fontSize: T.fsXs,
                padding: '4px 6px',
                border: `1px solid ${projection.message || projRawError ? T.warn : T.border}`,
                borderRadius: T.rs,
                background: 'transparent',
                color: T.text,
                outline: 'none',
              }}
            />
            {projection.message && (
              <div id="fields-projection-error" role="alert" style={noticeStyle}>
                {projection.message}
              </div>
            )}
            {projRawError && (
              <div id="fields-projection-raw-error" role="alert" style={noticeStyle}>
                {projRawError}
              </div>
            )}
          </div>
        )}
      </Popover.Dropdown>
    </Popover>
  );
}
