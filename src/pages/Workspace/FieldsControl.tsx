import React from 'react';
import {
  ActionIcon,
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
import { requestColumnScroll } from './views/columnScroll';
import { focusTargetAfterMove, type MoveDirection } from './columnReorderFocus';
import { projectionProblem } from './builder';
import { optionPills, PILL_LOOK, type PillStatus } from './optionPills';
import { projectionMode } from './projection';
import { projectionPatch, toggleProjectionField } from './projectionWriter';
import {
  documentsHold,
  fieldType,
  isDottedPath,
  isFieldChecked,
  knownFields,
  modeTag,
  operatorLabel,
  rememberedOrder,
} from './fieldsList';
import { FieldAutocompleteInput } from '../../features/fieldSuggestions/FieldAutocompleteInput';
import type { SuggestionContext } from '../../features/fieldSuggestions/types';
import type { CollectionTabState, ComputedColumn } from '@shared/types';

/**
 * Fields control (W14 §11) — one list of fields that writes the query's
 * projection, with the projection's text beside it. There are no headings:
 * "which fields do I get?" has one answer, and it is shown twice, as rows to
 * tick and as the text those ticks write.
 *
 * - **The list** is every field known without asking the server. A checkbox
 *   goes through `toggleProjectionField`, so unchecking from no projection
 *   writes an exclusion and the views (Table, Tree, JSON, CSV) hide what the
 *   committed projection keeps off the wire at once; nothing is re-fetched
 *   until the next Run. Order and dotted-path columns stay per-tab display
 *   state (`columnConfig.order` / `computed`), since a projection has none.
 * - **The text** is the projection as Shell Syntax, with the retained draft
 *   (`useProjectionDraft`) that survives a close and reopen. A list click
 *   commits a pending draft first and does nothing when it is refused; the
 *   list is greyed until the text parses again, so it never overwrites what
 *   the user is typing. Hidden for read-only consumers, which have no Run.
 *
 * Its trigger is the Filter Bar row's `Project` pill (W05 §9.2). The pill
 * states the projection and nothing else — no display badge.
 *
 * Reads everything off `useCollectionWorkspace()` (documents, `columnConfig`,
 * `builder`) so it needs no prop plumbing, and writes back through the
 * `actions.patchWith` read-modify-write.
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

  const info = React.useMemo(() => projectionMode(state.builder), [state.builder]);
  const computed = config?.computed;
  const computedPaths = React.useMemo(() => (computed ?? []).map((c) => c.path), [computed]);
  const orderedFields = React.useMemo(
    () => knownFields(documents, info, computedPaths, config?.order),
    [documents, info, computedPaths, config?.order],
  );
  // The find box narrows what the list draws; every row keeps its place in
  // the full order, which the move buttons and drag reorder by.
  const shownFields = React.useMemo(() => {
    const needle = find.trim().toLowerCase();
    return orderedFields
      .map((field, index) => ({ field, index }))
      .filter(({ field }) => field.toLowerCase().includes(needle));
  }, [orderedFields, find]);
  const types = React.useMemo(
    () => new Map(orderedFields.map((f) => [f, fieldType(documents, f)] as const)),
    [orderedFields, documents],
  );
  // A checked field the last run's documents do not hold is only on its way:
  // the server sends it from the next Run. With no run at all there is
  // nothing to compare against, so nothing is marked.
  const onNextRun = React.useMemo(
    () =>
      new Set(
        documents.length === 0
          ? []
          : orderedFields.filter(
              (f) => isFieldChecked(info, f) && !info.locked.includes(f) && !documentsHold(documents, f),
            ),
      ),
    [orderedFields, info, documents],
  );
  // A projection the app cannot read, or a draft it refused, is the user's
  // text in progress: the list stays out of its way until the text parses.
  const listDisabled = projection.message !== null || info.mode === 'invalid';

  const patchColumnConfig = (
    updater: (prev: NonNullable<CollectionTabState['columnConfig']>) => CollectionTabState['columnConfig'],
  ) => {
    actions.patchWith((prev) => ({
      columnConfig: updater(prev.columnConfig ?? {}),
    }));
  };

  const remembered = (prev: CollectionTabState) => rememberedOrder(prev, orderedFields);

  /**
   * A click on the list commits a pending draft first. A refused draft means
   * the click does nothing: the list never overwrites what is being typed.
   */
  const leftoverHidden = state.columnConfig?.hidden ?? [];
  const settleDraft = (): boolean => !listDisabled && projection.commit() !== null;

  // A checkbox writes the projection (W14 §11.3), and the rows stay current
  // when it only removes fields (§11.4).
  const toggleField = (field: string, checked: boolean) => {
    if (!settleDraft()) return;
    const isColumn = computedPaths.includes(field);
    actions.patchWith((prev) => {
      // A dotted column is the column itself: unchecking it removes it, and
      // only an inclusion has an entry for it to remove. Elsewhere the path is
      // already returned, and an exclusion of it would be a different thing.
      const writes = checked || !isColumn || projectionMode(prev.builder).mode === 'inclusion';
      const builder = writes ? toggleProjectionField(prev.builder, field, checked, orderedFields) : prev.builder;
      const written = { ...projectionPatch(prev, builder), ...remembered(prev) };
      // A name the migration left in the old hidden list (an operator stood in
      // the way) is shown again by checking it.
      const leftover = prev.columnConfig?.hidden;
      const patch =
        checked && leftover?.includes(field)
          ? {
              ...written,
              columnConfig: {
                ...(written.columnConfig ?? prev.columnConfig),
                hidden: leftover.filter((f) => f !== field),
              },
            }
          : written;
      if (checked || !isColumn) return patch;
      const base = patch.columnConfig ?? prev.columnConfig;
      return {
        ...patch,
        columnConfig: {
          ...base,
          // The column is gone, so the order must not keep its row alive.
          ...(base?.order ? { order: base.order.filter((f) => f !== field) } : {}),
          computed: (prev.columnConfig?.computed ?? []).filter((c) => c.path !== field),
        },
      };
    });
  };

  const replaceProjection = (next: (prev: CollectionTabState['builder']) => CollectionTabState['builder']) => {
    if (!settleDraft()) return;
    actions.patchWith((prev) => ({ ...projectionPatch(prev, next(prev.builder)), ...remembered(prev) }));
  };

  // A dotted path typed in the find box becomes a row (§11.5). Under an
  // inclusion it is written into the projection as well, and it is always its
  // own column so the Table shows the nested value beside the parent field.
  const addPath = (path: string) => {
    if (!settleDraft()) return;
    actions.patchWith((prev) => {
      const inclusion = projectionMode(prev.builder).mode === 'inclusion';
      const builder = inclusion
        ? toggleProjectionField(prev.builder, path, true, [...orderedFields, path])
        : prev.builder;
      const patch = projectionPatch(prev, builder);
      const had = prev.columnConfig?.computed ?? [];
      if (had.some((c) => c.path === path)) return patch;
      const column: ComputedColumn = { id: crypto.randomUUID(), path };
      return { ...patch, columnConfig: { ...prev.columnConfig, computed: [...had, column] } };
    });
    setFind('');
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

  const typedPath = find.trim();
  const canAddPath = isDottedPath(typedPath) && !orderedFields.includes(typedPath);

  // The pill is the projection's only sign while the control is closed — it
  // changes what Run returns, so it states the value, and is drawn in the
  // error colour while a refused draft is still waiting inside (W15 §2.4).
  const pill = optionPills(state).find((p) => p.key === 'project')!;
  const pillStatus = projection.message !== null ? 'invalid' : pill.status;

  const noticeStyle: React.CSSProperties = {
    marginTop: 4,
    fontSize: T.fsXs,
    lineHeight: 1.3,
    color: T.warn,
  };
  const mutedStyle: React.CSSProperties = { fontSize: T.fsXs, color: T.textMuted };

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
        >
          {/* A refused draft is not in the state the label is read from. */}
          {pillStatus === 'invalid' ? `${pill.name}: invalid` : pill.label}
        </Button>
        )}
      </Popover.Target>
      <Popover.Dropdown
        p="xs"
        style={{ width: 440, maxWidth: '90vw' }}
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
        <div style={{ display: 'flex', alignItems: 'center', gap: T.gapXs, marginBottom: 4 }}>
          <span data-testid="fields-mode-tag" style={{ ...mutedStyle, flex: 1 }}>
            {modeTag(info)}
          </span>
          <Button
            size="compact-xs"
            variant="subtle"
            disabled={listDisabled}
            onClick={() => replaceProjection((b) => ({ ...b, projection: [], projectionRaw: undefined }))}
          >
            All
          </Button>
          <Button
            size="compact-xs"
            variant="subtle"
            disabled={listDisabled}
            onClick={() => replaceProjection((b) => ({ ...b, projection: ['_id'], projectionRaw: undefined }))}
          >
            Only _id
          </Button>
        </div>
        <TextInput
          size="xs"
          aria-label="Find a field"
          placeholder="Find a field, or type a path like address.city"
          value={find}
          // Focus moves in a tick after open: Mantine records the element to
          // return focus to in an effect after the open commit, and focusing
          // first would make this input that element.
          ref={focusFindOnMount}
          onChange={(e) => setFind(e.currentTarget.value)}
          onKeyDown={(e) => {
            if (e.key !== 'Enter') return;
            e.preventDefault();
            // A dotted path nothing in the list matches is meant as a new row.
            if (shownFields.length === 0 && canAddPath) addPath(typedPath);
            else if (shownFields.length > 0 && isTableView) requestColumnScroll(shownFields[0].field);
          }}
          mb={4}
        />
        {canAddPath && (
          <Button
            size="compact-xs"
            variant="light"
            mb={4}
            disabled={listDisabled}
            data-testid="fields-add-path"
            onClick={() => addPath(typedPath)}
          >
            {`Add ${typedPath} as a column`}
          </Button>
        )}
        {orderedFields.length === 0 ? (
          <div style={{ padding: '4px 8px', fontSize: T.fsSm, color: T.textMuted }}>
            No fields available
          </div>
        ) : (
          <>
          {shownFields.length === 0 && (
            <div style={{ padding: '4px 8px', fontSize: T.fsSm, color: T.textMuted }}>
              No field matches
            </div>
          )}
          <Stack
            gap={T.gapXs}
            data-testid="fields-list"
            aria-disabled={listDisabled || undefined}
            style={{ maxHeight: 260, overflowY: 'auto', opacity: listDisabled ? 0.5 : 1 }}
          >
            {shownFields.map(({ field, index }) => {
              const checked = isFieldChecked(info, field) && !leftoverHidden.includes(field);
              const lockedEntry = info.locked.includes(field)
                ? info.entries.find(([k]) => k === field)
                : undefined;
              const type = types.get(field);
              return (
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
                  label={field}
                  checked={checked}
                  // `_id` always comes back unless the projection says `_id: 0`;
                  // an operator is edited in the text only.
                  disabled={listDisabled || lockedEntry !== undefined || (field === '_id' && checked)}
                  onChange={(e) => toggleField(field, e.currentTarget.checked)}
                  style={{ flex: 1, minWidth: 0 }}
                />
                {lockedEntry !== undefined && (
                  <span data-testid="fields-locked" style={{ ...mutedStyle, fontFamily: 'monospace' }}>
                    {`${operatorLabel(lockedEntry[1])} · as text`}
                  </span>
                )}
                {onNextRun.has(field) && (
                  <span data-testid="fields-on-next-run" style={{ ...mutedStyle, color: T.warn }}>
                    on next Run
                  </span>
                )}
                {type && lockedEntry === undefined && <span style={mutedStyle}>{type}</span>}
                {isTableView && checked && (
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
              );
            })}
          </Stack>
          </>
        )}
        {listDisabled && (
          <div data-testid="fields-list-greyed" style={{ ...mutedStyle, marginTop: 4 }}>
            The list is off until the projection text below parses.
          </div>
        )}
        {/* `aria-live`: announces a keyboard reorder's result, which is
            otherwise silent to anyone not watching the list (#57). */}
        <VisuallyHidden aria-live="polite">{announcement}</VisuallyHidden>

        {canFetch && (
          <div style={{ marginTop: 8, paddingTop: 8, borderTop: `1px solid ${T.border}` }}>
            {onNextRun.size > 0 && (
              <div data-testid="fields-next-run-note" style={{ ...mutedStyle, marginBottom: 6 }}>
                The server sends the change from the next Run.
              </div>
            )}
            <FieldAutocompleteInput
              value={projection.value}
              onChange={projection.onChange}
              context={suggestionContext}
              mode="token"
              multiline
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
                    : undefined
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
                resize: 'none',
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
