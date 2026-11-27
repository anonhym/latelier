import React from 'react';
import { I } from '../../../icons';
import { api, getErrorMessage } from '../../../api/atelier';
import { relativeTime } from '../../../utils/relativeTime';
import { copyToClipboard } from '../../../utils/clipboard';
import { confirmDestructive } from '../../../utils/confirm';
import { ActionIcon, Box, Button, Group, SegmentedControl, Text, TextInput, Tooltip, UnstyledButton, VisuallyHidden } from '@mantine/core';
import { themeVars } from '../../../theme/themeVars';
import { SubmitButton } from '../../../components/SubmitButton';
import { logFailure } from '../../../utils/rendererLog';
import type { AgentCallRow, RecentQuery } from '@shared/types';
import type { LegacySavedFindPayload } from '../legacyBuilder';
import { findSeedPayload, requestText, resultText } from '../../../features/agents/activityRow';
import {
  DOCUMENTS_HISTORY_TOOLS,
  HISTORY_FILTERS,
  agentChip,
  agentChipTooltip,
  historyRowText,
  mergeHistory,
  rowAction,
  searchHistory,
  type AgentHistoryRow,
  type HistoryFilter,
  type HistoryRow,
} from '../../../features/agents/historyMerge';
import { mergeConsecutive, type MergedRecentQuery } from './recentRuns';
import { useListPreview } from './useListPreview';

/** Agent calls read per tool: the newest, as the user's own history keeps its newest. */
const AGENT_ROWS = 50;

// Stable, so it runs once per mount: an inline ref would refocus on every render.
const focusOnMount = (el: HTMLInputElement | null) => el?.focus();

interface RecentTabProps {
  connectionId: string;
  dbName: string;
  collection: string;
  onRunHere: (recent: RecentQuery) => void;
  /** Fills the editor with an Agent's find or count; never runs it. */
  onLoad: (payload: LegacySavedFindPayload) => void;
  /** Opens All activity filtered to this collection. */
  onAgentActivity: () => void;
}

/**
 * The filter a recent run actually used, or `null` for a row recorded before
 * `queryRaw` existed. W15 §13.4: the row's primary slot used to hold
 * only a bare time and a duration, so every row looked the same and "Run"
 * was a blind action. `legacyCompileFilter` could reconstruct the pre-W13
 * rows, but dragging the frozen legacy shim into a read-only view to render
 * a preview is not worth it — those rows say so instead.
 */
function previewOf(item: RecentQuery): string | null {
  return item.payload.kind === 'find' && item.payload.queryRaw
    ? item.payload.queryRaw
    : null;
}

export function RecentTab({ connectionId, dbName, collection, onRunHere, onLoad, onAgentActivity }: RecentTabProps) {
  const T = themeVars;
  const [items, setItems] = React.useState<RecentQuery[]>([]);
  const [calls, setCalls] = React.useState<AgentCallRow[]>([]);
  const [agentErr, setAgentErr] = React.useState(false);
  const [filter, setFilter] = React.useState<HistoryFilter>('all');
  const [loading, setLoading] = React.useState(false);
  const [err, setErr] = React.useState<string | null>(null);
  const [deleting, setDeleting] = React.useState(false);
  const [search, setSearch] = React.useState('');
  // X30 §9: the user's runs and the Agents' finds and counts, by time.
  const all = React.useMemo(() => mergeHistory(mergeConsecutive(items), calls, filter), [items, calls, filter]);
  const rows = React.useMemo(() => searchHistory(all, search), [all, search]);
  // Enter does what the row offers: run the user's, load an Agent's, nothing for Copy only.
  const enter = (row: HistoryRow) => {
    const action = rowAction(row);
    if (row.kind === 'mine') onRunHere(row.item);
    else if (action === 'load' && row.seed) onLoad(findSeedPayload(row.seed));
  };
  // W05 §9.6: ↑↓ in the search box move the highlight, Enter loads it.
  const list = useListPreview(rows, enter);
  const activePreview = list.active ? historyRowText(list.active) || null : null;

  // A reviewer flagged that this instance is reused when the active collection
  // changes, and two `recent.list` calls can be in flight at once. If the older
  // one resolves last it repopulates the list with the *previous* collection's
  // rows under the new header. Combined with a delete that carried only the
  // row's id, confirming then destroyed history from a collection the user was
  // no longer looking at. The token makes a stale response a no-op.
  const loadToken = React.useRef(0);

  const load = React.useCallback(async () => {
    const token = ++loadToken.current;
    setLoading(true);
    setErr(null);
    try {
      // The Agent Read Log is read apart: a failure there leaves the user's own runs listed.
      const agentCalls = Promise.all(
        DOCUMENTS_HISTORY_TOOLS.map((tool) =>
          api.agentAccess.listCalls({ connectionId, database: dbName, collection, tool, outcome: 'all', limit: AGENT_ROWS }),
        ),
      ).then(
        (pages) => ({ ok: true as const, rows: pages.flat() }),
        (e: unknown) => {
          logFailure('reading Agent calls for a History', e);
          return { ok: false as const, rows: [] as AgentCallRow[] };
        },
      );
      const list = await api.recent.list({ connectionId, dbName, collection, kind: 'find' });
      const agent = await agentCalls;
      if (token !== loadToken.current) return;
      setItems(list);
      setCalls(agent.rows);
      setAgentErr(!agent.ok);
    } catch (e) {
      if (token !== loadToken.current) return;
      setErr(getErrorMessage(e, 'Failed to load recent queries'));
    } finally {
      if (token === loadToken.current) setLoading(false);
    }
  }, [connectionId, dbName, collection]);

  React.useEffect(() => {
    queueMicrotask(() => { void load(); });
  }, [load]);

  // both paths go through `recent:clear`; a per-row delete is just the
  // same filter narrowed to one `id` per run the row stands for. Same
  // confirm as Saved's.
  const runDelete = async (
    filters: Array<Parameters<typeof api.recent.clear>[0]>,
    failure: string,
  ) => {
    setDeleting(true);
    let failed: string | null = null;
    try {
      for (const filter of filters) await api.recent.clear(filter);
    } catch (e) {
      failed = getErrorMessage(e, failure);
    } finally {
      setDeleting(false);
    }
    // Reload even after a failure: the runs cleared before it are already
    // gone, so the list on screen is stale. The error goes up after the
    // reload because `load` resets it.
    await load();
    if (failed !== null) setErr(failed);
  };

  // A merged row stands for every run in its group, so deleting it removes
  // all of them — otherwise the next-older identical run would just take its
  // place and the row would look undeleted.
  const requestDelete = async (item: MergedRecentQuery, preview: string | null) => {
    const n = item.ids.length;
    const proceed = await confirmDestructive({
      title: n > 1 ? `Delete these ${n} runs?` : 'Delete this run?',
      body: `Removes ${preview ?? 'this run'}${n > 1 ? ` (${n} runs)` : ''} from the recent history. This action cannot be undone.`,
      confirmLabel: 'Delete',
    });
    if (!proceed) return;
    // The id alone would be enough to find the row — and that was the problem.
    // Sending the scope too means the delete is bounded by what this tab is
    // showing, so even a row that reached the list by some other route cannot
    // take history from another collection with it. The `AND` of id + scope
    // matches nothing rather than the wrong thing.
    await runDelete(
      item.ids.map((id) => ({ id, connectionId, dbName, collection, kind: 'find' as const })),
      'Failed to delete recent query',
    );
  };

  // Scoped to exactly what the tab shows — this connection, this database,
  // this collection, `kind: 'find'`. Aggregation history for the same
  // collection is history this view never listed, so it stays.
  const requestClear = async () => {
    const proceed = await confirmDestructive({
      title: 'Clear recent history?',
      body: `Clears the find history for ${collection} in ${dbName} on this connection. Aggregation history and saved queries are not affected.`,
      confirmLabel: 'Clear history',
    });
    if (!proceed) return;
    await runDelete(
      [{ connectionId, dbName, collection, kind: 'find' }],
      'Failed to clear recent queries',
    );
  };

  return (
    <div>
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
        <span style={{ flex: 1 }}>Recent · {collection}</span>
        <SubmitButton
          variant="default"
          size="compact-xs"
          h={18}
          px={6}
          fz={T.fsXs}
          c={loading ? undefined : T.textMuted}
          onClick={() => void load()}
          submitting={loading}
          aria-label="Refresh recent queries"
        >
          Refresh
        </SubmitButton>
        {/* The accessible name deliberately differs from the confirm's
            "Clear history" label — otherwise both match the same role+name
            query and the dialog is unreachable by keyboard *and* by test. */}
        <Tooltip label="Clear history" withArrow openDelay={400}>
          <Button
            variant="default"
            size="compact-xs"
            h={18}
            px={6}
            fz={T.fsXs}
            c={loading || deleting || items.length === 0 ? undefined : T.red}
            onClick={() => void requestClear()}
            disabled={loading || deleting || items.length === 0}
            aria-label={`Clear recent find history for ${collection}`}
          >
            Clear
          </Button>
        </Tooltip>
      </Group>

      <SegmentedControl
        size="xs"
        mx={10}
        mb={6}
        fullWidth
        aria-label="Who ran it"
        value={filter}
        data={HISTORY_FILTERS as Array<{ value: HistoryFilter; label: string }>}
        onChange={(v) => {
          setFilter(v as HistoryFilter);
          list.highlight(0);
        }}
      />

      <TextInput
        size="xs"
        mx={10}
        mb={6}
        // The popover opens on this box, so the list is under the keyboard at once.
        ref={focusOnMount}
        leftSection={I.search}
        placeholder="Search history"
        aria-label="Search recent queries"
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

      {!loading && !err && all.length === 0 && (
        <Text fz={T.fsSm} c={T.textMuted} px={10} pt={4} pb={10}>
          {filter === 'agents'
            ? `No Agent has run a find or a count on ${collection}.`
            : 'No recent queries yet. Anything you run in this collection shows up here.'}
        </Text>
      )}

      {!loading && !err && all.length > 0 && rows.length === 0 && (
        <Text fz={T.fsSm} c={T.textMuted} px={10} pt={4} pb={10}>
          No run matches this search.
        </Text>
      )}

      {!loading && !err && rows.map((row, index) => {
        const highlighted = row === list.active;
        if (row.kind === 'agent') {
          return (
            <AgentRow
              key={row.key}
              row={row}
              highlighted={highlighted}
              onHover={() => list.highlight(index)}
              onLoad={onLoad}
            />
          );
        }
        const item = row.item;
        const preview = previewOf(item);
        return (
          <Group
            key={row.key}
            gap={themeVars.gapXs}
            wrap="nowrap"
            px={10}
            py={7}
            fz={T.fsSm}
            data-testid="recent-row"
            data-highlighted={highlighted || undefined}
            onMouseEnter={() => list.highlight(index)}
            style={{ borderBottom: `1px solid ${T.border}`, background: highlighted ? T.accentSoft : undefined }}
          >
            <Box style={{ flex: 1, overflow: 'hidden' }}>
              {/* The row's identity: what was queried, not just when. */}
              <Text
                title={preview ?? undefined}
                fz={T.fsXs}
                c={preview ? T.text : T.textGhost}
                truncate="end"
                style={{ fontFamily: '"JetBrains Mono", monospace' }}
              >
                {preview ?? 'no stored query'}
              </Text>
              <Text fz={T.fsXs} c={T.textGhost} mt={1}>
                {/* `toLocaleTimeString` alone made a run from last Tuesday read
                    `14:32`, indistinguishable from one an hour ago. */}
                {relativeTime(item.ranAt, item.ranAt)} — {item.durationMs}ms
                {item.ids.length > 1 && (
                  <span style={{ marginLeft: 6 }}>
                    <span aria-hidden="true">×{item.ids.length}</span>
                    <VisuallyHidden>Ran {item.ids.length} times</VisuallyHidden>
                  </span>
                )}
                {item.resultCount !== undefined && (
                  <span style={{ marginLeft: 6 }}>{item.resultCount} docs</span>
                )}
                {item.errorCode && (
                  <span style={{ marginLeft: 6, color: T.warn }}>{item.errorCode}</span>
                )}
              </Text>
            </Box>
            <Tooltip label="Run here" withArrow openDelay={400}>
              <Button
                variant="light"
                size="compact-xs"
                h={20}
                px={7}
                fz={T.fsXs}
                leftSection={I.play}
                onClick={() => onRunHere(item)}
                aria-label={`Run ${preview ?? 'this recent query'} in this tab`}
              >
                Run
              </Button>
            </Tooltip>
            {/* W15 §13.7 — this used to early-return on a row with no
                stored `queryRaw`: the click did nothing and said nothing. It
                is now unavailable, and says why through its accessible name,
                next to a row that already shows there is no query to copy. */}
            {/* The span is the Tooltip's target: a disabled button swallows the
                pointer events the tooltip listens for, and a row with no
                stored query is exactly when the explanation is wanted. */}
            <Tooltip
              label={preview ? 'Copy MQL' : 'This run has no stored query to copy'}
              withArrow
              openDelay={400}
            >
              <span style={{ display: 'inline-flex' }}>
                <ActionIcon
                  variant="default"
                  size={22}
                  c={preview ? T.textMuted : undefined}
                  onClick={() => { if (preview) void copyToClipboard(preview, 'Query copied to the clipboard'); }}
                  disabled={!preview}
                  aria-label={preview ? 'Copy MQL to the clipboard' : 'Copy MQL — this run has no stored query'}
                >
                  {I.copy}
                </ActionIcon>
              </span>
            </Tooltip>
            {/* Icon-only, so the tooltip is not the accessible name; the
                real name says which run goes. */}
            <Tooltip label="Delete" withArrow openDelay={400}>
              <ActionIcon
                variant="default"
                size={22}
                c={deleting ? undefined : T.red}
                onClick={() => void requestDelete(item, preview)}
                disabled={deleting}
                aria-label={`Delete ${preview ?? 'this recent query'} from recent history`}
              >
                {I.trash}
              </ActionIcon>
            </Tooltip>
          </Group>
        );
      })}

      {/* The highlighted run's query, whole: read before it is loaded. Live,
          so moving the highlight with the keyboard reads it out. */}
      {!loading && !err && list.active && (
        <div
          data-testid="recent-preview"
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
          {activePreview ?? 'no stored query'}
        </div>
      )}

      {/* X30 §9: the session pages hold every Agent call; this list only the newest finds and counts. */}
      <div style={{ padding: '6px 10px 8px', borderTop: `1px solid ${T.border}`, fontSize: T.fsXs, color: T.textMuted }}>
        {agentErr && <div style={{ color: T.warn, marginBottom: 4 }}>Agent calls could not be read.</div>}
        <div>Agent calls are listed from the Agent Read Log — Load fills the editor, it never runs.</div>
        <UnstyledButton
          onClick={onAgentActivity}
          style={{ marginTop: 4, fontSize: T.fsXs, color: T.accentInk, textDecoration: 'underline' }}
        >
          All Agent activity on {collection}
        </UnstyledButton>
      </div>
    </div>
  );
}

/**
 * An Agent's find or count (X30 §9): its chip, what it ran, and Load, which
 * fills the editor and never runs. A refused or cut call offers Copy only.
 * Every string on it came from an Agent and shows as text.
 */
function AgentRow({
  row,
  highlighted,
  onHover,
  onLoad,
}: {
  row: AgentHistoryRow;
  highlighted: boolean;
  onHover: () => void;
  onLoad: (payload: LegacySavedFindPayload) => void;
}) {
  const T = themeVars;
  const { call, seed, preview } = row;
  const request = requestText(call);
  const tooltip = agentChipTooltip(call);
  return (
    <Group
      gap={themeVars.gapXs}
      wrap="nowrap"
      px={10}
      py={7}
      fz={T.fsSm}
      data-testid="recent-agent-row"
      data-call-id={call.id}
      data-highlighted={highlighted || undefined}
      onMouseEnter={onHover}
      style={{ borderBottom: `1px solid ${T.border}`, background: highlighted ? T.accentSoft : undefined }}
    >
      <Box style={{ flex: 1, overflow: 'hidden' }}>
        <Text
          title={preview || undefined}
          fz={T.fsXs}
          c={preview ? T.text : T.textGhost}
          truncate="end"
          style={{ fontFamily: '"JetBrains Mono", monospace' }}
        >
          {preview || 'no stored query'}
        </Text>
        <Text fz={T.fsXs} c={T.textGhost} mt={1} component="div" style={{ display: 'flex', gap: themeVars.gapXs, alignItems: 'center' }}>
          <Tooltip label={tooltip} withArrow openDelay={400}>
            <span
              data-testid="recent-agent-chip"
              style={{ padding: '0 5px', borderRadius: T.rs, background: T.accentSoft, color: T.accentInk, whiteSpace: 'nowrap' }}
            >
              {agentChip(call)}
              <VisuallyHidden>, {tooltip}</VisuallyHidden>
            </span>
          </Tooltip>
          <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {relativeTime(call.ts, call.ts)} — {call.tool} · {resultText(call)}
          </span>
        </Text>
      </Box>
      {seed && (
        <Tooltip label="Load into the editor; it does not run" withArrow openDelay={400}>
          <Button
            variant="light"
            size="compact-xs"
            h={20}
            px={7}
            fz={T.fsXs}
            onClick={() => onLoad(findSeedPayload(seed))}
            aria-label={`Load ${preview || 'this Agent query'} into the editor`}
          >
            Load
          </Button>
        </Tooltip>
      )}
      <Tooltip label={request ? 'Copy the request' : 'This call has no stored request to copy'} withArrow openDelay={400}>
        <span style={{ display: 'inline-flex' }}>
          <ActionIcon
            variant="default"
            size={22}
            c={request ? T.textMuted : undefined}
            onClick={() => {
              if (request) void copyToClipboard(request, 'Request copied to the clipboard');
            }}
            disabled={!request}
            aria-label={request ? "Copy the Agent's request to the clipboard" : 'Copy — this call has no stored request'}
          >
            {I.copy}
          </ActionIcon>
        </span>
      </Tooltip>
    </Group>
  );
}
