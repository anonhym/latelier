import {
  QUERY_ROW_LABEL,
  groupRows,
  kindOf,
  rankCapped,
  rankCommands,
  type RankedRow,
  type RowKind,
} from './rank';
import type { Command, PaletteContext } from './types';

// The palette's layout (X07 §13.3): scopes, capped groups, row tags, the
// footer's key hints and the session's query history. Pure, so the component
// only draws what this returns.

export type Scope = 'all' | 'collections' | 'actions' | 'saved' | 'tabs';

export const SCOPES: readonly Scope[] = ['all', 'collections', 'actions', 'saved', 'tabs'];

export const SCOPE_LABEL: Record<Scope, string> = {
  all: 'All',
  collections: 'Collections',
  actions: 'Actions',
  saved: 'Saved',
  tabs: 'Tabs',
};

/** Rows per kind in All, and rows in a single scope (X07 §13.7 rule 3). */
export const ALL_CAP = 5;
export const SCOPE_CAP = 50;

/**
 * Per kind: its group's label in All, the noun of its `Show <n> more` line, and
 * the scope its rows are listed in (Connections have none).
 */
export const KIND_LAYOUT: Record<RowKind, { group: string; noun: string; scope: Exclude<Scope, 'all'> | null }> = {
  collection: { group: 'Collections', noun: 'collections', scope: 'collections' },
  database: { group: 'Databases', noun: 'databases', scope: 'collections' },
  connection: { group: 'Connections', noun: 'connections', scope: null },
  tab: { group: 'Tabs', noun: 'tabs', scope: 'tabs' },
  saved: { group: 'Saved', noun: 'saved', scope: 'saved' },
  action: { group: 'Actions', noun: 'actions', scope: 'actions' },
};

/** The tag naming a row's kind under RECENT. */
const RECENT_KIND_TAG: Partial<Record<RowKind, string>> = {
  collection: 'Collection',
  connection: 'Connection',
};

/** The scope `delta` steps away, wrapping. */
export function cycleScope(scope: Scope, delta: number): Scope {
  const n = SCOPES.length;
  return SCOPES[(((SCOPES.indexOf(scope) + delta) % n) + n) % n]!;
}

/** What sits at the right of a row. */
export type Aside =
  | { type: 'switch'; checked: boolean }
  | { type: 'key'; keys: string }
  | { type: 'tag'; label: string }
  | null;

export interface RowEntry {
  type: 'row';
  id: string;
  index: number;
  row: RankedRow;
  cmd: Command;
  kind: RowKind;
  aside: Aside;
  /** Why it cannot run here; null when it can. */
  disabled: string | null;
}

export interface MoreEntry {
  type: 'more';
  id: string;
  index: number;
  kind: RowKind;
  scope: Scope;
  label: string;
}

export type Entry = RowEntry | MoreEntry;

export interface LayoutGroup {
  key: string;
  /** Null for a single scope's list, which has no header. */
  label: string | null;
  entries: Entry[];
}

export interface Layout {
  groups: LayoutGroup[];
  /** Every entry in the order drawn; `entry.index` is its position here. */
  entries: Entry[];
  /** Matches per scope, but All, on a typed query; null on an empty one. */
  counts: Record<Exclude<Scope, 'all'>, number> | null;
  /** In a single scope, the matches past the ones listed. */
  hidden: number;
}

/** The row's right-hand side: a switch, then a kind tag under RECENT, the shortcut, `Recent`. */
export function asideFor(row: RankedRow, kind: RowKind, underRecent: boolean): Aside {
  const { cmd } = row;
  if (cmd.toggle) return { type: 'switch', checked: cmd.toggle.checked };
  const kindTag = RECENT_KIND_TAG[kind];
  if (underRecent && kindTag) return { type: 'tag', label: kindTag };
  if (cmd.shortcut) return { type: 'key', keys: cmd.shortcut };
  if (row.recent && !underRecent) return { type: 'tag', label: 'Recent' };
  return null;
}

/** Lays the palette out for a query in a scope. */
export function layoutPalette(
  all: Command[],
  query: string,
  ctx: PaletteContext,
  recentIds: string[],
  scope: Scope,
): Layout {
  const typed = query.trim() !== '';
  const groups: LayoutGroup[] = [];
  const entries: Entry[] = [];
  const rowEntry = (row: RankedRow, underRecent: boolean): RowEntry => {
    const kind = kindOf(row.cmd);
    return {
      type: 'row',
      id: row.cmd.id,
      index: entries.length,
      row,
      cmd: row.cmd,
      kind,
      aside: row.fromQuery ? null : asideFor(row, kind, underRecent),
      disabled: row.cmd.disabledReason?.(ctx) ?? null,
    };
  };
  const addGroup = (key: string, label: string | null, rows: RankedRow[], underRecent = false): LayoutGroup => {
    const group: LayoutGroup = { key, label, entries: [] };
    for (const row of rows) {
      const entry = rowEntry(row, underRecent);
      group.entries.push(entry);
      entries.push(entry);
    }
    groups.push(group);
    return group;
  };

  if (scope === 'all' && !typed) {
    for (const g of groupRows(rankCommands(all, query, ctx, recentIds))) {
      addGroup(g.key, g.label, g.rows.map((r) => r.row), g.key === 'recent');
    }
    return { groups, entries, counts: null, hidden: 0 };
  }

  const single = scope !== 'all';
  const ranked = rankCapped(all, query, ctx, recentIds, single ? SCOPE_CAP : ALL_CAP, (kind) =>
    single ? (KIND_LAYOUT[kind].scope === scope ? scope : null) : kind,
  );
  let counts: Layout['counts'] = null;
  if (typed) {
    counts = { collections: 0, actions: 0, saved: 0, tabs: 0 };
    for (const [kind, n] of ranked.counts) {
      const s = KIND_LAYOUT[kind].scope;
      if (s) counts[s] += n;
    }
  }

  if (single) {
    const bucket = ranked.buckets[0];
    if (bucket) addGroup(scope, null, bucket.rows);
    return { groups, entries, counts, hidden: bucket ? bucket.total - bucket.rows.length : 0 };
  }

  if (ranked.fromQuery.length > 0) addGroup('pasted', QUERY_ROW_LABEL, ranked.fromQuery);
  for (const bucket of ranked.buckets) {
    const kind = bucket.key as RowKind;
    const { group: label, noun, scope: target } = KIND_LAYOUT[kind];
    const group = addGroup(kind, label, bucket.rows);
    const more = bucket.total - bucket.rows.length;
    if (more > 0 && target) {
      const entry: MoreEntry = {
        type: 'more',
        id: `more:${kind}`,
        index: entries.length,
        kind,
        scope: target,
        label: `Show ${more} more ${noun}`,
      };
      group.entries.push(entry);
      entries.push(entry);
    }
  }
  return { groups, entries, counts, hidden: 0 };
}

// ── Footer ───────────────────────────────────────────────────────────────────

export interface KeyHint {
  /** Mac glyphs, formatted for the platform where drawn. */
  keys: string;
  label: string;
}

export interface FooterHints {
  left: KeyHint[];
  right: KeyHint[];
}

/** What Enter does on an entry; null when it does nothing. */
function enterLabel(entry: Entry): string | null {
  if (entry.type === 'more') return 'Switch scope';
  if (entry.disabled !== null) return null;
  if (entry.row.fromQuery) return 'Find';
  if (entry.cmd.toggle) return 'Toggle';
  return entry.kind === 'action' ? 'Run' : 'Open';
}

/**
 * The footer's key hints for the highlighted entry. A list per side, so a
 * later key (`⌘↵`, `⌥↵`) is one more entry rather than a new layout.
 */
export function footerHints(scope: Scope, typed: boolean, entry: Entry | undefined): FooterHints {
  const left: KeyHint[] = [];
  const label = entry ? enterLabel(entry) : null;
  if (label) left.push({ keys: '↵', label });
  const right: KeyHint[] = [];
  if (scope !== 'all') right.push({ keys: '⇧Tab', label: SCOPE_LABEL[cycleScope(scope, -1)] });
  else if (!typed) right.push({ keys: '⌘P', label: 'Collections' });
  return { left, right };
}

// ── Query history ────────────────────────────────────────────────────────────

/** Earlier queries kept for `↑`, per session. */
export const HISTORY_CAP = 20;

/** `history` with `query` as its newest entry; a blank query changes nothing. */
export function pushHistory(history: readonly string[], query: string): string[] {
  const q = query.trim();
  if (!q) return [...history];
  return [q, ...history.filter((h) => h !== q)].slice(0, HISTORY_CAP);
}

/**
 * One step through the history from position `at` (-1: not browsing, the
 * input empty). `older` is `↑`. Returns the new position and the query it
 * puts in the input, or null at the oldest entry.
 */
export function stepHistory(
  history: readonly string[],
  at: number,
  direction: 'older' | 'newer',
): { at: number; query: string } | null {
  const next = direction === 'older' ? at + 1 : at - 1;
  if (next >= history.length || next < -1) return null;
  return { at: next, query: next === -1 ? '' : history[next]! };
}
