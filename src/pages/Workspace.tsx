import React from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { DarkCtx, useTheme } from '../ThemeContext';
import { themeVars } from '../theme/themeVars';
import { AppShell } from '@mantine/core';
import { type PanelImperativeHandle } from 'react-resizable-panels';
import { useWorkspaceTabs } from '../state/workspaceTabs';
import { useConnections, isConnectionActive, isKnownNotConnected } from '../state/connections';
import { setFocusedConnectionId as publishFocusedConnectionId } from '../state/focusedConnection';
import { api, getErrorMessage, isIpcError } from '../api/atelier';
import { notify } from '../theme/notifications';
import { buildIdFilter } from './Workspace/views/docId';
import { ejsonStringify } from '../utils/ejson';
import { copyToClipboard } from '../utils/clipboard';
import { BUILDER_MIN_PCT } from './Workspace/panelSizes';
import type { CollectionView } from '@shared/types';
import { DEFAULT_AGGREGATION_TAB_STATE, DEFAULT_SCHEMA_TAB_STATE } from '@shared/defaults';
import { useReferenceRules } from '../features/references/useReferenceRules';
import { usePreviewFields } from './Workspace/usePreviewFields';
import { useReferenceDrawer } from './Workspace/useReferenceDrawer';
import { groupTabsByConnection } from './Workspace/tabGroups';
import {
  type CollectionWorkspaceActions,
  type CollectionWorkspaceMeta,
} from './Workspace/context';
import { useQueryRunner } from './Workspace/useQueryRunner';
import type { RunnerTarget } from './Workspace/useQueryRunner';
import { useWorkspacePanelPrefs } from './Workspace/useWorkspacePanelPrefs';
import { useConnectionDialogs } from './Workspace/useConnectionDialogs';
import { useDocumentDialogs } from './Workspace/useDocumentDialogs';
import { useCollectionTabActions } from './Workspace/useCollectionTabActions';
import { DialogStack } from './Workspace/DialogStack';
import { ShellSection } from './Workspace/ShellSection';
import { PanelBody, type PanelBodyCollectionProps } from './Workspace/PanelBody';
import { useSettings } from './SettingsContext';
import { useRegisterCommands } from '../commands/useRegisterCommands';
import { useLatest } from '../commands/useLatest';
import { usePaletteApi } from '../commands/CommandPalette';
import { useFeatureHint } from '../hints/useFeatureHint';
import { useHints } from '../hints/HintsContext';
import { queryRunKey } from '../utils/queryRunKey';
import { looksLikeForeignIdField } from '../utils/foreignIdField';
import {
  compileFindOptions,
  currentFilterJson,
  effectivePageLimit,
  isDefaultQueryState,
} from './Workspace/builder';
import type { SuggestionContext } from '../features/fieldSuggestions/types';

function WorkspaceInner() {
  const T = themeVars;
  const navigate = useNavigate();
  const location = useLocation();
  const tabs = useWorkspaceTabs();
  const {
    connections,
    loading: connectionsLoading,
    refresh: refreshConnections,
    removeLocal: removeConnectionLocal,
  } = useConnections();
  const { dark, toggle } = useWorkspaceThemeBridge();
  const [newTabOpen, setNewTabOpen] = React.useState(false);

  const panelPrefs = useWorkspacePanelPrefs();
  const {
    prefsReady,
    leftWidth,
    innerHSplit,
    sidebarCollapsed,
    builderCollapsed, commitBuilderCollapsed,
  } = panelPrefs;
  const [shellOpen, setShellOpen] = React.useState(false);
  const builderPanelRef = React.useRef<PanelImperativeHandle>(null);
  const [savedRefreshKey, setSavedRefreshKey] = React.useState(0);
  const [queryBarSaveOpen, setQueryBarSaveOpen] = React.useState(false);
  const settings = useSettings();
  const palette = usePaletteApi();

  // `resize()` treats a number as pixels and a string as a percentage —
  // `resize(26)` is 26px, not 26%. `expand()` alone reopens at the collapsed
  // 4% rail, so the width is set explicitly from the stored split after.
  const innerHSplitRef = useLatest(innerHSplit);
  const restoreBuilderWidth = React.useCallback(() => {
    const handle = builderPanelRef.current;
    if (!handle) return;
    handle.expand();
    // Floor at BUILDER_MIN_PCT in case a stored split is narrower than draggable.
    const pct = Math.max(innerHSplitRef.current, BUILDER_MIN_PCT);
    handle.resize(`${pct}%`);
  }, [innerHSplitRef]);

  const toggleBuilder = React.useCallback(() => {
    const next = !builderCollapsed;
    commitBuilderCollapsed(next);
    if (next) builderPanelRef.current?.collapse();
    else restoreBuilderWidth();
  }, [builderCollapsed, commitBuilderCollapsed, restoreBuilderWidth]);

  // Expands the pane first — when collapsed, BuilderPane isn't mounted, so a
  // patch targeting it would silently land in persisted state only.
  const builderCollapsedRef = useLatest(builderCollapsed);
  const expandBuilder = React.useCallback(() => {
    if (!builderCollapsedRef.current) return;
    commitBuilderCollapsed(false);
    restoreBuilderWidth();
  }, [builderCollapsedRef, commitBuilderCollapsed, restoreBuilderWidth]);

  // Moves focus to the drawer's selected tab on expand, or back to the notch
  // on collapse — a flag+effect because BuilderPane isn't mounted while
  // collapsed, so there's nothing to focus until the next render.
  const notchRef = React.useRef<HTMLButtonElement>(null);
  const moveFocusOnBuilderToggle = React.useRef(false);
  React.useEffect(() => {
    if (!moveFocusOnBuilderToggle.current) return;
    moveFocusOnBuilderToggle.current = false;
    if (builderCollapsed) {
      notchRef.current?.focus();
      return;
    }
    const selectedTab = document.querySelector<HTMLElement>(
      '[aria-label="Query drawer"] [role="tab"][aria-selected="true"]',
    );
    selectedTab?.focus();
  }, [builderCollapsed]);

  const toggleBuilderWithFocus = React.useCallback(() => {
    moveFocusOnBuilderToggle.current = true;
    toggleBuilder();
  }, [toggleBuilder]);

  const active = tabs.tabs.find((t) => t.id === tabs.activeId) ?? null;
  const activeCollection = active?.kind === 'collection' ? active : null;
  const activeScript = active?.kind === 'script' ? active : null;
  const activeView: CollectionView =
    activeCollection?.state.activeView ?? 'documents';
  const aggregationState =
    activeCollection?.state.aggregation ?? DEFAULT_AGGREGATION_TAB_STATE;
  const schemaState = activeCollection?.state.schema ?? DEFAULT_SCHEMA_TAB_STATE;
  // The active tab's own Connection — null with no tab open, not a gap to paper over.
  const focusedConnection = active
    ? connections.find((c) => c.id === active.connectionId) ?? null
    : null;

  // Gates the main pane's loading state until both the prefs read and the
  // initial Connections fetch have settled.
  const initialLoadPending = !prefsReady || connectionsLoading;
  const openConnections = connections.filter((c) => c.status === 'connected');
  const anyConnectionOpen = openConnections.length > 0;
  // "New script"/new-tab picker need a Connection with no tab open to name one;
  // fall back to the sole open Connection when unambiguous, else stay inert.
  const soleOpenConnectionId = openConnections.length === 1 ? openConnections[0]!.id : null;
  const scratchConnectionId = focusedConnection?.id ?? soleOpenConnectionId;

  // Mirrors to the module-level store so PaletteContext (mounted above
  // <Routes>) can read it once the URL no longer carries a connection :id.
  const focusedConnectionId = focusedConnection?.id ?? null;
  React.useEffect(() => {
    publishFocusedConnectionId(focusedConnectionId);
  }, [focusedConnectionId]);
  // Reset only on unmount, not on every id change (which a bare cleanup would do).
  React.useEffect(() => () => publishFocusedConnectionId(null), []);


  const referenceRules = useReferenceRules(
    activeCollection?.connectionId ?? null,
    activeCollection?.dbName ?? null,
    activeCollection?.collection ?? null,
  );

  const {
    refStack,
    setRefStack,
    refDrawerPinned,
    setRefDrawerPinned,
    refEditorOpen,
    setRefEditorOpen,
    refHover,
    handleRefHover,
    handleRefHoverLeave,
    handleRefOpen,
  } = useReferenceDrawer(
    tabs.activeId,
    tabs.tabs,
    tabs.patchCollectionState,
    activeCollection?.id ?? null,
  );

  const hints = useHints();

  // Issue #177 — the first hint a new user sees should be about Run, not a
  // secondary feature. Firing once the query has been edited off its
  // default shape (rather than on every fresh tab) avoids nagging the
  // common case, where `Workspace`'s own auto-run effect already ran it.
  const runExecuteWhen =
    activeView === 'documents' &&
    !!activeCollection &&
    !activeCollection.state.lastRun &&
    !isDefaultQueryState(activeCollection.state);
  const runExecuteHint = useFeatureHint('run.execute', runExecuteWhen);

  const lastRunDocs = activeCollection?.state.lastRun?.documents;
  const refsConfigureWhen = React.useMemo(() => {
    if (!lastRunDocs || lastRunDocs.length === 0) return false;
    if (referenceRules.rules.length > 0) return false;
    return lastRunDocs.slice(0, 25).some(
      (doc) =>
        typeof doc === 'object' &&
        doc !== null &&
        !Array.isArray(doc) &&
        Object.keys(doc as Record<string, unknown>).some(looksLikeForeignIdField),
    );
  }, [lastRunDocs, referenceRules.rules.length]);
  const refsConfigureHint = useFeatureHint('refs.configure', refsConfigureWhen);

  // Saved vs Dormant isn't a `status` distinction — it's whether any tab is
  // still open on the Connection, which only this component tracks.
  const connectionsWithTabs = React.useMemo(
    () => new Set(tabs.tabs.map((t) => t.connectionId)),
    [tabs.tabs],
  );

  const tabSwitchCount = hints.getSessionEventCount('tabSwitch', '*');
  const anyPinned = tabs.tabs.some((t) => t.pinned);
  const tabsPinHint = useFeatureHint(
    'tabs.pin',
    tabSwitchCount >= 3 && !anyPinned && tabs.activeId !== null,
  );

  const currentQueryKey = React.useMemo(() => {
    if (!activeCollection) return '';
    const compiled = compileFindOptions(activeCollection.state.builder);
    const filter = currentFilterJson(activeCollection.state) ?? '<invalid>';
    const { skip, limit } = effectivePageLimit(
      compiled.limit,
      activeCollection.state.page,
      activeCollection.state.pageSize,
    );
    return queryRunKey({
      connectionId: activeCollection.connectionId,
      dbName: activeCollection.dbName,
      collection: activeCollection.collection,
      filter,
      sort: compiled.sort ?? '',
      projection: activeCollection.state.builder.projection,
      projectionRaw: activeCollection.state.builder.projectionRaw,
      limit,
      skip,
    });
  }, [activeCollection]);
  const savedCreateCount = hints.getSessionEventCount('queryRun', currentQueryKey);
  const savedCreateHint = useFeatureHint(
    'saved.create',
    savedCreateCount >= 3 && !!activeCollection,
  );

  const collectionSuggestionContext = React.useMemo<SuggestionContext | null>(() => {
    if (!activeCollection) return null;
    return {
      connectionId: activeCollection.connectionId,
      dbName: activeCollection.dbName,
      collection: activeCollection.collection,
      recentDocs: activeCollection.state.lastRun?.documents,
    };
  }, [activeCollection]);

  const [activePreviewFields, setActivePreviewFields] = usePreviewFields(
    activeCollection?.connectionId ?? null,
    activeCollection?.dbName ?? null,
    activeCollection?.collection ?? null,
  );

  const previewKnownFields = React.useMemo(() => {
    const docs = activeCollection?.state.lastRun?.documents ?? [];
    const seen = new Set<string>();
    for (const doc of docs.slice(0, 50)) {
      if (doc && typeof doc === 'object' && !Array.isArray(doc)) {
        for (const k of Object.keys(doc as Record<string, unknown>)) {
          if (k !== '_id') seen.add(k);
        }
      }
    }
    return Array.from(seen).sort((a, b) => a.localeCompare(b));
  }, [activeCollection?.state.lastRun?.documents]);

  const previewConfigureWhen =
    activeView === 'documents' &&
    !!activeCollection?.state.lastRun &&
    previewKnownFields.length >= 4 &&
    (activePreviewFields === null || activePreviewFields.length === 0);
  const previewConfigureHint = useFeatureHint(
    'preview.configure',
    previewConfigureWhen,
  );

  const queryRunner = useQueryRunner({
    active: activeCollection
      ? {
          id: activeCollection.id,
          connectionId: activeCollection.connectionId,
          dbName: activeCollection.dbName,
          collection: activeCollection.collection,
          state: activeCollection.state,
        }
      : null,
    patchCollectionState: tabs.patchCollectionState,
    recordSessionEvent: hints.recordSessionEvent,
  });
  const showLoading = queryRunner.isLoading;

  // Auto-runs the base query on a fresh/restored tab landing on Documents
  // with no prior run, only while the query is still at its default shape
  // (so a loaded saved query isn't clobbered), and never against a Dormant
  // Connection. Deps are deliberately just the landing triggers, not the
  // query sub-fields — depending on those would re-fire on every keystroke.
  React.useEffect(() => {
    if (!activeCollection) return;
    if (activeView !== 'documents') return;
    if (activeCollection.state.lastRun) return;
    if (!isDefaultQueryState(activeCollection.state)) return;
    if (isKnownNotConnected(focusedConnection)) return;
    void queryRunner.run();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeCollection?.id, activeView, queryRunner.run, focusedConnection]);

  // Refs let palette-command perform() closures see fresh values without
  // re-registering on every state tick.
  const activeRef = useLatest(active);
  const activeCollectionRef = useLatest(activeCollection);
  const activeScriptRef = useLatest(activeScript);
  const tabsRef = useLatest(tabs);

  // Stable callbacks for the major panels, reading state via the `*Ref` bag
  // so an unrelated re-render doesn't cascade through every child.
  // `useQueryRunner` returns a fresh object each render; depend on `run` alone.
  const { run, cancel: cancelRun } = queryRunner;
  const collectionTabActions = useCollectionTabActions({
    activeCollectionRef,
    activeScriptRef,
    tabs,
    run,
    cancel: cancelRun,
  });
  const {
    patchActiveCollection,
    patchActiveCollectionWith,
    runActiveCollection,
    cancelActiveCollection,
  } = collectionTabActions;
  // The post-write refresh target, resolved fresh from `tabsRef` at
  // completion time rather than snapshotted, since a drawer pinned to tab A
  // must refresh A even after the user switches to tab B.
  const resolveRunnerTarget = React.useCallback(
    (tabId: string): RunnerTarget | null => {
      const t = tabsRef.current.tabs.find((x) => x.id === tabId);
      if (t?.kind !== 'collection') return null;
      return {
        id: t.id,
        connectionId: t.connectionId,
        dbName: t.dbName,
        collection: t.collection,
        state: t.state,
      };
    },
    [tabsRef],
  );
  const documentDialogs = useDocumentDialogs({
    activeCollectionRef,
    queryRunner,
    activeTabId: tabs.activeId,
    resolveRunnerTarget,
  });
  const {
    openEdit,
    setDeleteDoc,
    openInsertModal,
    openDeleteAllModal,
    openDuplicate,
  } = documentDialogs;
  const openSaveModal = React.useCallback(
    () => setQueryBarSaveOpen(true),
    [],
  );
  // Table view's inline single-field edit: `$set`s just `fieldPath`, then
  // re-runs. No drawer to show an inline error, so this uses `notify` instead.
  const updateField = React.useCallback(
    (doc: unknown, fieldPath: string, newValue: string) => {
      const a = activeCollectionRef.current;
      if (!a) return;
      const filterJson = buildIdFilter(doc);
      if (filterJson === null) {
        notify.error('Cannot edit a document without an _id');
        return;
      }
      const updateJson = ejsonStringify({ $set: { [fieldPath]: newValue } });
      api.doc
        .updateOne({
          connectionId: a.connectionId,
          dbName: a.dbName,
          collection: a.collection,
          filterJson,
          updateJson,
        })
        .then(() => {
          void run();
        })
        .catch((e: unknown) => {
          notify.error(getErrorMessage(e, 'Update failed'), { title: 'Update failed' });
        });
    },
    [activeCollectionRef, run],
  );
  const workspaceActions = React.useMemo<CollectionWorkspaceActions>(
    () => ({
      patch: patchActiveCollection,
      patchWith: patchActiveCollectionWith,
      run: runActiveCollection,
      cancel: cancelActiveCollection,
      openEdit,
      openDelete: setDeleteDoc,
      openDeleteAll: openDeleteAllModal,
      openInsert: openInsertModal,
      openSave: openSaveModal,
      expandBuilder,
      updateField,
      openDuplicate,
    }),
    [
      patchActiveCollection,
      patchActiveCollectionWith,
      runActiveCollection,
      cancelActiveCollection,
      openEdit,
      setDeleteDoc,
      openDeleteAllModal,
      openInsertModal,
      openSaveModal,
      expandBuilder,
      updateField,
      openDuplicate,
    ],
  );
  const workspaceMeta = React.useMemo<CollectionWorkspaceMeta | null>(
    () =>
      activeCollection
        ? {
            connectionId: activeCollection.connectionId,
            dbName: activeCollection.dbName,
            collection: activeCollection.collection,
            tabId: activeCollection.id,
            isLoading: showLoading,
          }
        : null,
    [activeCollection, showLoading],
  );
  // `actions` is the `workspaceActions` reference itself, not a rewrap, so
  // its identity only changes when that memo's own deps do.
  const panelBodyCollection = React.useMemo<PanelBodyCollectionProps | null>(
    () =>
      activeCollection && workspaceMeta
        ? {
            tab: activeCollection,
            meta: workspaceMeta,
            actions: workspaceActions,
            view: activeView,
            aggregationState,
            schemaState,
            previewKnownFields,
            activePreviewFields,
            setActivePreviewFields,
            suggestionContext: collectionSuggestionContext,
            savedRefreshKey,
          }
        : null,
    [
      activeCollection,
      workspaceMeta,
      workspaceActions,
      activeView,
      aggregationState,
      schemaState,
      previewKnownFields,
      activePreviewFields,
      setActivePreviewFields,
      collectionSuggestionContext,
      savedRefreshKey,
    ],
  );
  useRegisterCommands(
    [
      {
        id: 'tab.new',
        title: 'New tab…',
        group: 'workspace',
        shortcut: '⌘T',
        keywords: ['open', 'collection'],
        when: (ctx) => ctx.pathname === '/workspace',
        perform: () => setNewTabOpen(true),
      },
      {
        id: 'tab.new.aggregation',
        title: 'New aggregation tab on this collection',
        group: 'workspace',
        keywords: ['pipeline', 'aggregate'],
        when: () => activeCollectionRef.current !== null,
        perform: () => {
          const a = activeCollectionRef.current;
          if (!a) return;
          void tabsRef.current.openAggregation({
            connectionId: a.connectionId,
            dbName: a.dbName,
            collection: a.collection,
          });
        },
      },
      {
        id: 'tab.close',
        title: 'Close current tab',
        group: 'workspace',
        shortcut: '⌘W',
        when: () => activeRef.current !== null,
        perform: () => {
          const a = activeRef.current;
          if (a) void tabsRef.current.close(a.id);
        },
      },
      {
        id: 'tab.pin.toggle',
        // Reads `active` directly, not via the ref — useLatest lags by one render.
        title: active?.pinned ? 'Unpin current tab' : 'Pin current tab',
        group: 'workspace',
        keywords: ['pinned', 'sticky'],
        when: () => activeRef.current !== null,
        perform: () => {
          const a = activeRef.current;
          if (a) void tabsRef.current.setPinned(a.id, !a.pinned);
        },
      },
      {
        id: 'query.drawer.toggle',
        title: builderCollapsed ? 'Expand query drawer' : 'Collapse query drawer',
        group: 'query',
        shortcut: '⌘B',
        keywords: ['builder', 'filter', 'panel', 'sidebar', 'saved', 'recent'],
        // Builder is aria-hidden outside documents view and absent for script tabs.
        when: () =>
          activeCollectionRef.current !== null &&
          (activeCollectionRef.current.state.activeView ?? 'documents') === 'documents',
        perform: toggleBuilderWithFocus,
      },
      {
        id: 'query.run',
        title: 'Run query',
        group: 'query',
        shortcut: '⌘↵',
        keywords: ['execute', 'find'],
        when: () => activeCollectionRef.current !== null,
        perform: () => { void queryRunner.run(); },
      },
      {
        // Registered here, not in BuilderPane, which is unmounted while collapsed.
        id: 'query.save',
        title: 'Save query',
        group: 'query',
        keywords: ['bookmark', 'persist'],
        when: () => activeCollectionRef.current !== null,
        perform: () => setQueryBarSaveOpen(true),
      },
      {
        id: 'query.copy',
        title: 'Copy MQL to clipboard',
        group: 'query',
        keywords: ['copy', 'filter'],
        when: () => {
          const a = activeCollectionRef.current;
          return !!a && (a.state.queryRaw ?? '').trim().length > 0;
        },
        perform: () => {
          const raw = activeCollectionRef.current?.state.queryRaw ?? '';
          if (raw) void copyToClipboard(raw, 'Query copied to the clipboard.');
        },
      },
      {
        id: 'doc.insert',
        title: 'Insert document…',
        group: 'workspace',
        keywords: ['insert', 'add', 'new', 'document', 'create'],
        when: () =>
          activeCollectionRef.current !== null &&
          activeCollectionRef.current.state.activeView === 'documents',
        perform: () => openInsertModal(),
      },
      {
        id: 'references.configure',
        title: 'Configure references',
        group: 'references',
        keywords: ['link', 'foreign', 'lookup'],
        when: () => activeCollectionRef.current !== null,
        perform: () => setRefEditorOpen(true),
      },
      ...(['Tree', 'JSON', 'Table'] as const).map((mode) => ({
        id: `view.mode.${mode.toLowerCase()}`,
        title: `Show results as ${mode}`,
        group: 'view' as const,
        keywords: ['view'],
        when: () =>
          // eslint-disable-next-line react-hooks/refs
          !!activeCollectionRef.current && activeCollectionRef.current.state.view !== mode,
        perform: () => {
          const a = activeCollectionRef.current;
          // eslint-disable-next-line react-hooks/refs
          if (a) tabsRef.current.patchCollectionState(a.id, { view: mode });
        },
      })),
    ],
    [active?.pinned, builderCollapsed, toggleBuilderWithFocus],
  );

  // Mirrors the navigator's data for `⌘K → orders`-style collection commands,
  // via its own meta:list fetch rather than sharing the navigator's cache.
  const [paletteCollections, setPaletteCollections] = React.useState<
    Array<{ db: string; coll: string }>
  >([]);
  React.useEffect(() => {
    const cid = focusedConnectionId;
    let cancelled = false;
    void (async () => {
      await Promise.resolve();
      if (cancelled) return;
      if (!cid) {
        setPaletteCollections([]);
        return;
      }
      try {
        const dbs = await api.meta.listDatabases({ connectionId: cid });
        const collsByDb = await Promise.all(
          dbs.map(async (d) => {
            try {
              const colls = await api.meta.listCollections({
                connectionId: cid,
                dbName: d.name,
              });
              return colls.map((c) => ({ db: d.name, coll: c.name }));
            } catch {
              return [];
            }
          }),
        );
        if (!cancelled) setPaletteCollections(collsByDb.flat());
      } catch {
        if (!cancelled) setPaletteCollections([]);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [focusedConnectionId]);

  const collectionCommands = React.useMemo(
    () =>
      paletteCollections.map(({ db, coll }) => ({
        id: `tab.open:${db}:${coll}`,
        title: `Open: ${db}.${coll}`,
        group: 'workspace' as const,
        keywords: ['collection', 'tab', 'new', db, coll],
        perform: () => {
          if (focusedConnectionId) {
            void tabsRef.current.openCollection({
              connectionId: focusedConnectionId,
              dbName: db,
              collection: coll,
              reuseExisting: true,
            });
          }
        },
      })),
    [paletteCollections, focusedConnectionId, tabsRef],
  );
  useRegisterCommands(collectionCommands, [collectionCommands]);

  // Keyboard shortcuts
  React.useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const mod = e.metaKey || e.ctrlKey;
      if (!mod) return;
      // Grouped-by-connection order, matching what's on screen (not stored order).
      const ids = groupTabsByConnection(tabs.tabs).flatMap((g) =>
        g.tabs.map((t) => t.id),
      );
      if (e.key === 't') {
        e.preventDefault();
        setNewTabOpen(true);
      } else if (e.key === 'b') {
        // A dialog has no ⌘B handler, so the event bubbles here — must not
        // toggle the drawer behind an open modal. `instanceof`, not a cast:
        // a window/document-dispatched keydown's target may lack `closest`.
        const origin = e.target instanceof HTMLElement ? e.target : null;
        if (origin?.closest('[role="dialog"], [role="alertdialog"]')) return;
        const a = activeCollectionRef.current;
        if (!a || (a.state.activeView ?? 'documents') !== 'documents') return;
        e.preventDefault();
        toggleBuilderWithFocus();
      } else if (e.key === 'w') {
        e.preventDefault();
        if (tabs.activeId) void tabs.close(tabs.activeId);
      } else if (e.key === 'Alt' || e.key === 'Option') {
        // noop
      } else if (e.altKey && (e.key === 'ArrowRight' || e.key === 'ArrowLeft')) {
        e.preventDefault();
        const idx = tabs.activeId ? ids.indexOf(tabs.activeId) : 0;
        if (idx === -1) return;
        const next =
          e.key === 'ArrowRight'
            ? ids[(idx + 1) % ids.length]
            : ids[(idx - 1 + ids.length) % ids.length];
        if (next) void tabs.setActive(next);
      } else if (/^[1-9]$/.test(e.key)) {
        const id = ids[Number(e.key) - 1];
        if (id) {
          e.preventDefault();
          void tabs.setActive(id);
        }
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [tabs, activeCollectionRef, toggleBuilderWithFocus]);

  const handlePick = async (input: {
    connectionId: string;
    dbName: string;
    collection: string;
    initialView: CollectionView;
  }) => {
    setNewTabOpen(false);
    if (input.initialView !== 'aggregation') {
      const tab = await tabs.openCollection({
        connectionId: input.connectionId,
        dbName: input.dbName,
        collection: input.collection,
      });
      if (tab.state.activeView !== input.initialView) {
        tabs.setActiveView(tab.id, input.initialView);
      }
    } else {
      await tabs.openAggregation({
        connectionId: input.connectionId,
        dbName: input.dbName,
        collection: input.collection,
      });
    }
  };

  // Touch-used + connect, no tab: opening one would mean guessing a Database
  // and Collection. Not guarded on "already connected" — re-clicking retries
  // an errored Connection, and a re-connect must rebuild the client after edits.
  const openConnection = React.useCallback((id: string) => {
    void api.conn.touchUsed(id).catch(() => { /* fire-and-forget */ });
    void api.mongo.connect(id).catch(() => { /* status event drives the UI */ });
  }, []);

  // Only the Focused Tab's own Connection auto-connects on launch; every
  // other Connection with tabs stays Dormant, keeping launch fast. Fires at
  // most once, guarded on isConnectionActive so an already-connecting/-connected one isn't re-kicked.
  const launchConnectRef = React.useRef(false);
  React.useEffect(() => {
    if (launchConnectRef.current) return;
    if (tabs.loading || connectionsLoading) return;
    launchConnectRef.current = true;
    if (focusedConnection && !isConnectionActive(focusedConnection.status)) {
      openConnection(focusedConnection.id);
    }
  }, [tabs.loading, connectionsLoading, focusedConnection, openConnection]);

  // Closes one Connection's tabs, surfacing a title on failure rather than
  // swallowing it. Shared by disconnect and delete confirmation flows.
  const closeTabsForConnection = React.useCallback(
    (id: string, errorTitle: string) =>
      tabsRef.current.closeForConnection(id).catch((err: unknown) => {
        notify.error(isIpcError(err) ? err.message : String(err), { title: errorTitle });
      }),
    [tabsRef],
  );

  const openConnectionScreen = React.useCallback(
    (id: string) => navigate(`/connections/${id}`),
    [navigate],
  );

  const connectionDialogs = useConnectionDialogs({
    connections,
    tabsRef,
    closeTabsForConnection,
    refreshConnections,
    removeConnectionLocal,
    openConnection,
    openConnectionScreen,
  });
  const {
    requestDisconnect,
    openAddConnectionModal,
    openEditConnectionModal,
    openDeleteConnectionModal,
    openConnectionTable,
  } = connectionDialogs;

  // A full conn.list() refetch, not scoped to one Connection, registered
  // here for the Data View. Per-connection delete/edit are registered
  // separately by ConnectionPaletteCommands with the id baked in.
  useRegisterCommands(
    [
      {
        id: 'connection.refresh',
        title: 'Refresh connection',
        group: 'connection',
        keywords: ['reload', 'sync'],
        when: (ctx) => ctx.pathname === '/workspace',
        perform: () => { void refreshConnections(); },
      },
    ],
    [refreshConnections],
  );

  // Acts on an `openConnection` nav-state hint (from DetailPanel or the
  // command palette, both mounted where they can't reach this component
  // directly) and opens the collection it optionally names. Runs once per
  // navigation — state is cleared immediately so back/forward doesn't replay it.
  const navState = location.state as
    | {
        openConnectionId?: string;
        openCollection?: { dbName: string; collection: string };
        deleteConnectionId?: string;
        editConnectionId?: string;
      }
    | null;
  const openConnectionId = navState?.openConnectionId ?? null;
  const openCollectionFromNav = navState?.openCollection ?? null;
  React.useEffect(() => {
    if (!openConnectionId) return;
    navigate(location.pathname, { replace: true, state: null });
    openConnection(openConnectionId);
    if (!openCollectionFromNav) return;
    void tabsRef.current
      .openCollection({
        connectionId: openConnectionId,
        dbName: openCollectionFromNav.dbName,
        collection: openCollectionFromNav.collection,
      })
      .catch((err: unknown) => {
        notify.error(isIpcError(err) ? err.message : String(err), {
          title: 'Could not open the collection',
        });
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [openConnectionId]);

  // Same nav-state handoff as openConnectionId, for the palette's
  // per-connection delete/edit rows (mounted where they can't call these
  // modal-openers directly). Held until connectionsLoading clears — acting
  // before `connections` first loads would silently drop the intent.
  const deleteConnectionId = navState?.deleteConnectionId ?? null;
  const editConnectionId = navState?.editConnectionId ?? null;
  React.useEffect(() => {
    if (!deleteConnectionId || connectionsLoading) return;
    navigate(location.pathname, { replace: true, state: null });
    openDeleteConnectionModal(deleteConnectionId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [deleteConnectionId, connectionsLoading]);
  React.useEffect(() => {
    if (!editConnectionId || connectionsLoading) return;
    navigate(location.pathname, { replace: true, state: null });
    openEditConnectionModal(editConnectionId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editConnectionId, connectionsLoading]);

  // Shared by both ConnectionSwitcher instances so they can't drift apart.
  const switcherProps = {
    connections,
    focusedConnectionId,
    onSwitch: openConnection,
    onManage: openConnectionScreen,
    onDisconnect: requestDisconnect,
    onAdd: openAddConnectionModal,
    onEdit: openEditConnectionModal,
    onDelete: openDeleteConnectionModal,
    onExpand: openConnectionTable,
  };

  // mode="static" (CSS grid), not the default "fixed" (position: fixed) —
  // the Electron viewport is exactly 100vh and inner panes rely on
  // flex + overflow: hidden, which fixed positioning doesn't tolerate.
  return (
    <AppShell
      mode="static"
      header={{ height: 80 }}
      navbar={{
        // Manual width, not Mantine's `collapsed` flag (display:none has no
        // room for an expand affordance) — a 40px rail keeps it visible.
        width: sidebarCollapsed ? 40 : leftWidth,
        // Must be truthy or Mantine's static-mode navbar CSS vars never emit,
        // pushing the navbar below Main in grid auto-placement.
        breakpoint: 'xs',
      }}
      padding={0}
      withBorder={false}
      style={{
        height: '100vh',
        // Each pane owns its own scroll region; Mantine's default `overflow:
        // auto` here would scroll the whole shell as one unit instead.
        overflow: 'hidden',
        background: T.bg,
        color: T.text,
        fontFamily: 'system-ui, -apple-system, sans-serif',
      }}
    >
      <ShellSection
        dark={dark}
        toggle={toggle}
        focusedConnection={focusedConnection}
        switcherProps={switcherProps}
        settings={settings}
        palette={palette}
        shellOpen={shellOpen}
        setShellOpen={setShellOpen}
        tabs={tabs}
        connections={connections}
        connectionsWithTabs={connectionsWithTabs}
        active={active}
        scratchConnectionId={scratchConnectionId}
        hints={hints}
        openConnection={openConnection}
        setNewTabOpen={setNewTabOpen}
        panelPrefs={panelPrefs}
        connectionDialogs={connectionDialogs}
      />

      <PanelBody
        panelPrefs={panelPrefs}
        collectionTabActions={collectionTabActions}
        documentDialogs={documentDialogs}
        refDrawer={{
          refStack, setRefStack,
          refDrawerPinned, setRefDrawerPinned,
          refEditorOpen, setRefEditorOpen,
          refHover, handleRefHover, handleRefHoverLeave, handleRefOpen,
        }}
        tabs={tabs}
        referenceRules={referenceRules}
        shellOpen={shellOpen}
        setShellOpen={setShellOpen}
        focusedConnection={focusedConnection}
        initialLoadPending={initialLoadPending}
        anyConnectionOpen={anyConnectionOpen}
        switcherProps={switcherProps}
        setNewTabOpen={setNewTabOpen}
        active={active}
        openConnection={openConnection}
        activeScript={activeScript}
        collection={panelBodyCollection}
        dark={dark}
        builderPanelRef={builderPanelRef}
        toggleBuilder={toggleBuilder}
        notchRef={notchRef}
      />

      <DialogStack
        newTabOpen={newTabOpen}
        setNewTabOpen={setNewTabOpen}
        scratchConnectionId={scratchConnectionId}
        onPickNewTab={handlePick}
        documentDialogs={documentDialogs}
        connectionDialogs={connectionDialogs}
        connections={connections}
        activeCollection={activeCollection}
        focusedConnectionReadOnly={focusedConnection?.readOnly ?? false}
        referenceRules={referenceRules}
        refDrawer={{ refHover, refEditorOpen, setRefEditorOpen }}
        queryBarSaveOpen={queryBarSaveOpen}
        setQueryBarSaveOpen={setQueryBarSaveOpen}
        setSavedRefreshKey={setSavedRefreshKey}
        expandBuilder={expandBuilder}
        patchActiveCollection={patchActiveCollection}
        refsConfigureHint={refsConfigureHint}
        tabsPinHint={tabsPinHint}
        savedCreateHint={savedCreateHint}
        previewConfigureHint={previewConfigureHint}
        runExecuteHint={runExecuteHint}
      />
    </AppShell>
  );
}

export default function Workspace() {
  const [dark, toggle] = useTheme();
  return (
      <DarkCtx.Provider value={dark}>
        <ThemeBridgeCtx.Provider value={{ dark, toggle }}>
          <WorkspaceInner />
        </ThemeBridgeCtx.Provider>
      </DarkCtx.Provider>
  );
}

const ThemeBridgeCtx = React.createContext<{ dark: boolean; toggle: () => void }>({
  dark: false,
  toggle: () => {},
});

// eslint-disable-next-line react-refresh/only-export-components
export function useWorkspaceThemeBridge() {
  return React.useContext(ThemeBridgeCtx);
}
