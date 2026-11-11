import React from 'react';
import { UnstyledButton } from '@mantine/core';
import { SpotlightRoot, createSpotlight, useSpotlight } from '@mantine/spotlight';
import { useRovingHighlight } from '../hooks/useRovingHighlight';
import { useHints } from '../hints/HintsContext';
import { useFeatureHint } from '../hints/useFeatureHint';
import { FeatureHint } from '../hints/FeatureHint';
import { api, getErrorMessage } from '../api/atelier';
import { notify } from '../theme/notifications';
import { useRegistrySnapshot } from './useRegistrySnapshot';
import { formatShortcut } from './shortcutLabel';
import { isMacRenderer } from '../utils/platform';
import { usePaletteContext } from './PaletteContext';
import { displayText, type Range, type RowKind } from './rank';
import {
  SCOPES,
  SCOPE_CAP,
  SCOPE_LABEL,
  cycleScope,
  footerHints,
  layoutPalette,
  pushHistory,
  stepHistory,
  type Aside,
  type Entry,
  type FooterHints,
  type KeyHint,
  type MoreEntry,
  type RowEntry,
  type Scope,
} from './layout';
import { useLatest } from './useLatest';
import { _resetPaletteOpenerForTests, setPaletteOpener } from './paletteOpener';
import type { Command } from './types';

const MRU_CAP = 8;
const MRU_PREF_KEY = 'ui.commandPalette.mru';

// ── Dedicated Spotlight store ────────────────────────────────────────────────
// Use a private store instead of the package's default. The public CJS bundle
// doesn't export the module-level `spotlightStore`, so calling `getState()` on
// the re-exported binding is unreliable across bundlers. `createSpotlight()`
// gives us both the store and a control trio in one call — the store flows
// into `<SpotlightRoot store={...}>` and the controls back the imperative API.
const [paletteStore, paletteControls] = createSpotlight();

/** Test-only: reset the palette open/query state between tests. */
// eslint-disable-next-line react-refresh/only-export-components
export function _resetPaletteStoreForTests(): void {
  _resetPaletteOpenerForTests();
  paletteStore.setState({
    opened: false,
    empty: false,
    selected: -1,
    listId: '',
    query: '',
    registeredActions: new Set(),
  });
}

// ── Imperative API (kept identical so TitleBar callers need no changes) ──────

interface PaletteApi {
  open: () => void;
  close: () => void;
  toggle: () => void;
  isOpen: () => boolean;
}

type ApiRef = React.MutableRefObject<PaletteApi | null>;

const ApiRefCtx = React.createContext<ApiRef | null>(null);

const NOOP_API: PaletteApi = {
  open: () => {},
  close: () => {},
  toggle: () => {},
  isOpen: () => false,
};

/**
 * Imperative open/close handle on the palette. Exposed so the existing
 * `⌘K` button in `<TitleBar>` can keep working without re-implementing the
 * keyboard shortcut. Returns a stable proxy that reads the current palette
 * api via a ref — safe to call during render even before the palette mounts.
 */
// eslint-disable-next-line react-refresh/only-export-components
export function usePaletteApi(): PaletteApi {
  const ref = React.useContext(ApiRefCtx);
  return React.useMemo<PaletteApi>(
    () => ({
      open: () => ref?.current?.open() ?? NOOP_API.open(),
      close: () => ref?.current?.close() ?? NOOP_API.close(),
      toggle: () => ref?.current?.toggle() ?? NOOP_API.toggle(),
      isOpen: () => ref?.current?.isOpen() ?? false,
    }),
    [ref],
  );
}

// ── Pieces of a row ───────────────────────────────────────────────────────────

const MONO = 'ui-monospace, SFMono-Regular, Menlo, monospace';

const VISUALLY_HIDDEN: React.CSSProperties = {
  position: 'absolute',
  width: 1,
  height: 1,
  overflow: 'hidden',
  clip: 'rect(0 0 0 0)',
  whiteSpace: 'nowrap',
};

const KBD: React.CSSProperties = {
  fontSize: 'var(--atelier-fs-xs)',
  padding: '1px 6px',
  border: '1px solid var(--atelier-border-med)',
  borderRadius: 'var(--atelier-radius-xs)',
  color: 'var(--atelier-text-muted)',
  background: 'var(--atelier-surface-raised)',
  whiteSpace: 'nowrap',
  flex: 'none',
};

function Kbd({ children }: { children: React.ReactNode }) {
  return <span style={KBD}>{children}</span>;
}

function Svg({ children }: { children: React.ReactNode }) {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
      {children}
    </svg>
  );
}

const KIND_ICON: Record<RowKind, React.ReactNode> = {
  collection: (
    <Svg>
      <rect x="3" y="4" width="18" height="16" rx="2" />
      <path d="M3 10h18M9 10v10" />
    </Svg>
  ),
  database: (
    <Svg>
      <ellipse cx="12" cy="5" rx="8" ry="3" />
      <path d="M4 5v14c0 1.7 3.6 3 8 3s8-1.3 8-3V5M4 12c0 1.7 3.6 3 8 3s8-1.3 8-3" />
    </Svg>
  ),
  connection: (
    <Svg>
      <rect x="3" y="4" width="18" height="7" rx="1" />
      <rect x="3" y="13" width="18" height="7" rx="1" />
    </Svg>
  ),
  tab: (
    <Svg>
      <rect x="3" y="5" width="18" height="14" rx="2" />
      <path d="M3 9h8V5" />
    </Svg>
  ),
  saved: (
    <Svg>
      <path d="M6 3h12v18l-6-4-6 4z" />
    </Svg>
  ),
  action: (
    <Svg>
      <path d="M9 18l6-6-6-6" />
    </Svg>
  ),
};

/**
 * `text` with the matched ranges emphasised. The pieces are hidden from
 * assistive technology and the whole text follows once, unbroken, so the
 * row's name reads as the title and not as a run of fragments.
 */
function Highlighted({ text, ranges }: { text: string; ranges: Range[] }) {
  if (ranges.length === 0) return <>{text}</>;
  const parts: React.ReactNode[] = [];
  let at = 0;
  for (const [start, end] of ranges) {
    if (start > at) parts.push(text.slice(at, start));
    parts.push(
      <span key={start} data-match style={{ color: 'var(--atelier-accent-ink)', fontWeight: 600 }}>
        {text.slice(start, end)}
      </span>,
    );
    at = end;
  }
  if (at < text.length) parts.push(text.slice(at));
  return (
    <>
      <span aria-hidden="true">{parts}</span>
      <span style={VISUALLY_HIDDEN}>{text}</span>
    </>
  );
}

/** A row built from the query: its title with the emphasised value in the monospace font. */
function QueryRowTitle({ title, emphasis }: { title: string; emphasis: string }) {
  const at = title.indexOf(emphasis);
  if (at === -1) return <>{title}</>;
  return (
    <>
      {title.slice(0, at)}
      <span style={{ fontFamily: MONO, fontSize: 'var(--atelier-fs-sm)', color: 'var(--atelier-accent-ink)' }}>
        {emphasis}
      </span>
      {title.slice(at + emphasis.length)}
    </>
  );
}

function Switch({ checked }: { checked: boolean }) {
  return (
    <span
      data-switch={checked ? 'on' : 'off'}
      aria-hidden="true"
      style={{
        width: 28,
        height: 16,
        borderRadius: 8,
        background: checked ? 'var(--atelier-accent)' : 'var(--atelier-border-med)',
        position: 'relative',
        flex: 'none',
      }}
    >
      <span
        style={{
          position: 'absolute',
          top: 2,
          left: checked ? 14 : 2,
          width: 12,
          height: 12,
          borderRadius: 6,
          background: 'var(--atelier-accent-text)',
        }}
      />
    </span>
  );
}

function AsideView({ aside }: { aside: Aside }) {
  if (!aside) return null;
  if (aside.type === 'switch') return <Switch checked={aside.checked} />;
  return <Kbd>{aside.type === 'key' ? formatShortcut(aside.keys, isMacRenderer()) : aside.label}</Kbd>;
}

const ROW_STYLE: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 'var(--atelier-gap-sm)',
  padding: '8px 16px',
  width: '100%',
  textAlign: 'left',
  fontFamily: 'inherit',
  fontSize: 'var(--atelier-fs-md)',
  color: 'var(--atelier-text)',
};

interface EntryProps {
  entry: Entry;
  id: string;
  isCursor: boolean;
  onActivate: (entry: Entry) => void;
  onHover: (index: number) => void;
}

function RowView({ entry, id, isCursor, onActivate, onHover }: EntryProps & { entry: RowEntry }) {
  const { cmd, row, disabled } = entry;
  const { fromQuery } = row;
  const subtitle = disabled ?? cmd.subtitle;
  const tone = disabled === null ? undefined : 'var(--atelier-text-ghost)';
  return (
    <UnstyledButton
      id={id}
      type="button"
      role="option"
      tabIndex={-1}
      aria-selected={isCursor}
      aria-disabled={disabled === null ? undefined : true}
      aria-checked={cmd.toggle ? cmd.toggle.checked : undefined}
      data-action
      data-kind={entry.kind}
      data-cursor={isCursor || undefined}
      onClick={() => onActivate(entry)}
      onMouseEnter={() => onHover(entry.index)}
      style={{ ...ROW_STYLE, background: isCursor ? 'var(--atelier-accent-soft)' : 'transparent', color: tone ?? ROW_STYLE.color }}
    >
      <span style={{ color: tone ?? 'var(--atelier-text-muted)', display: 'flex', flex: 'none' }}>{KIND_ICON[entry.kind]}</span>
      {fromQuery ? (
        <span style={{ display: 'flex', flexDirection: 'column', gap: 'var(--atelier-gap-xs)', flex: 1, minWidth: 0 }}>
          <span data-title={cmd.title} style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            <QueryRowTitle title={cmd.title} emphasis={fromQuery.emphasis} />
          </span>
          <span style={{ fontSize: 'var(--atelier-fs-sm)', color: 'var(--atelier-text-muted)' }}>{cmd.subtitle}</span>
        </span>
      ) : (
        <span style={{ flex: 1, minWidth: 0, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
          <span data-title={displayText(cmd)}>
            {/* A greyed row is all in the ghost colour: no accent emphasis. */}
            <Highlighted text={displayText(cmd)} ranges={disabled === null ? row.ranges : []} />
          </span>
          {subtitle && (
            <span
              data-subtitle
              style={{ color: tone ?? 'var(--atelier-text-muted)', fontSize: 'var(--atelier-fs-sm)', marginLeft: 8 }}
            >
              {subtitle}
            </span>
          )}
        </span>
      )}
      <AsideView aside={entry.aside} />
    </UnstyledButton>
  );
}

function MoreView({ entry, id, isCursor, onActivate, onHover }: EntryProps & { entry: MoreEntry }) {
  return (
    <UnstyledButton
      id={id}
      type="button"
      role="option"
      tabIndex={-1}
      aria-selected={isCursor}
      data-more={entry.scope}
      data-cursor={isCursor || undefined}
      onClick={() => onActivate(entry)}
      onMouseEnter={() => onHover(entry.index)}
      style={{
        display: 'block',
        width: '100%',
        textAlign: 'left',
        fontFamily: 'inherit',
        color: 'var(--atelier-accent-ink)',
        fontSize: 'var(--atelier-fs-sm)',
        padding: '6px 16px 6px 42px',
        background: isCursor ? 'var(--atelier-accent-soft)' : 'transparent',
      }}
    >
      {entry.label}
    </UnstyledButton>
  );
}

function EntryView(props: EntryProps) {
  const { entry } = props;
  return entry.type === 'more' ? <MoreView {...props} entry={entry} /> : <RowView {...props} entry={entry} />;
}

const BAR_BORDER = '1px solid var(--atelier-border)';

function Footer({ hints }: { hints: FooterHints }) {
  const mac = isMacRenderer();
  const hint = (h: KeyHint) => (
    <span key={h.keys} style={{ display: 'flex', gap: 'var(--atelier-gap-xs)', alignItems: 'center' }}>
      <Kbd>{formatShortcut(h.keys, mac)}</Kbd>
      {h.label}
    </span>
  );
  return (
    <div
      data-palette-footer
      style={{
        display: 'flex',
        gap: 'var(--atelier-gap-lg)',
        padding: '8px 16px',
        borderTop: BAR_BORDER,
        fontSize: 'var(--atelier-fs-xs)',
        color: 'var(--atelier-text-muted)',
        alignItems: 'center',
        minHeight: 35,
        boxSizing: 'border-box',
      }}
    >
      {hints.left.map(hint)}
      <span style={{ flex: 1 }} />
      {hints.right.map(hint)}
    </div>
  );
}

// ── Inner palette content (rendered inside SpotlightRoot) ─────────────────────

interface PaletteContentProps {
  onClose: () => void;
  recentIds: string[];
  recordRecent: (id: string) => void;
  initialScope: Scope;
  /** The session's earlier queries, newest first. */
  history: readonly string[];
}

const setQuery = (query: string) => paletteStore.setState((s) => ({ ...s, query }));

function PaletteContent({ onClose, recentIds, recordRecent, initialScope, history }: PaletteContentProps) {
  const ctx = usePaletteContext();
  const all = useRegistrySnapshot();
  const { query } = useSpotlight(paletteStore);
  const [scope, setScope] = React.useState<Scope>(initialScope);
  // Where `↑` left the history; it holds while the input still shows that entry.
  const [historyAt, setHistoryAt] = React.useState(-1);
  // The query the palette reopened on is the newest entry, so `↑` from an
  // empty input starts at the one before it.
  const [startAt] = React.useState(() => (history.length > 0 && history[0] === query ? 0 : -1));
  const browsing = historyAt >= 0 && history[historyAt] === query;

  const layout = React.useMemo(
    () => layoutPalette(all, query, ctx, recentIds, scope),
    [all, query, ctx, recentIds, scope],
  );
  const { entries } = layout;
  const typed = query.trim() !== '';
  const listId = React.useId();
  const optionId = (entry: Entry) => `${listId}-opt-${entry.id}`;

  // A new query or scope is a new list: the cursor goes back to the top.
  const listKey = `${scope}\u0000${query}`;
  const { index: safeCursor, setIndex, move } = useRovingHighlight(entries.length, listKey);

  // A toggle keeps the cursor on its row even when re-registering moves it,
  // for as long as the list is the one it was toggled in: a new query or
  // scope puts the cursor back on the best row.
  const followRef = React.useRef<{ id: string; listKey: string } | null>(null);
  React.useEffect(() => {
    const follow = followRef.current;
    if (follow === null) return;
    if (follow.listKey !== listKey) {
      followRef.current = null;
      return;
    }
    const at = entries.findIndex((e) => e.type === 'row' && e.id === follow.id);
    if (at !== -1 && at !== safeCursor) setIndex(at);
  }, [entries, safeCursor, setIndex, listKey]);
  const setCursor = (index: number) => {
    followRef.current = null;
    setIndex(index);
  };
  const moveCursor = (delta: number) => {
    followRef.current = null;
    move(delta);
  };
  const switchScope = (next: Scope) => {
    followRef.current = null;
    setScope(next);
  };

  // A toggle enters the MRU when the palette closes, so its row does not jump
  // into RECENT under the cursor while the palette is open.
  const toggledRef = React.useRef(new Set<string>());
  const recordRecentRef = useLatest(recordRecent);
  React.useEffect(() => {
    const toggled = toggledRef.current;
    const record = recordRecentRef;
    return () => {
      for (const id of toggled) record.current(id);
    };
  }, [recordRecentRef]);

  const inputRef = React.useRef<HTMLInputElement>(null);
  // The last query comes back selected, so typing replaces it.
  React.useEffect(() => {
    inputRef.current?.select();
  }, []);

  const cursorEntry = entries[safeCursor];
  const activeId = cursorEntry ? optionId(cursorEntry) : undefined;
  // Keyboard moves the cursor with the focus staying in the search input, so
  // the highlighted row has to be scrolled into view by hand. (Optional call:
  // jsdom has no scrollIntoView.)
  React.useEffect(() => {
    if (activeId) document.getElementById(activeId)?.scrollIntoView?.({ block: 'nearest' });
  }, [activeId]);

  const run = React.useCallback(
    async (cmd: Command) => {
      try {
        await cmd.perform(ctx);
      } catch (e) {
        notify.error(getErrorMessage(e, 'The command failed.'), {
          title: `Couldn't run "${cmd.title}"`,
        });
      }
    },
    [ctx],
  );

  const activate = (entry: Entry) => {
    if (entry.type === 'more') {
      switchScope(entry.scope);
      return;
    }
    if (entry.disabled !== null) return;
    const { cmd } = entry;
    if (cmd.toggle) {
      followRef.current = { id: cmd.id, listKey };
      toggledRef.current.add(cmd.id);
      void run(cmd);
      return;
    }
    onClose();
    // Toggles flipped on this open go in first, so the command performed now
    // ends up the most recent.
    for (const id of toggledRef.current) recordRecent(id);
    toggledRef.current.clear();
    // A row built from the query is not a command to come back to.
    if (!cmd.forQuery) recordRecent(cmd.id);
    void run(cmd);
  };

  const recall = (direction: 'older' | 'newer') => {
    const step = stepHistory(history, browsing ? historyAt : startAt, direction);
    if (!step) return;
    setHistoryAt(step.at);
    setQuery(step.query);
  };

  // The input is the one element that ever holds focus here, so every key
  // the palette answers is bound on it.
  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.nativeEvent.isComposing) return;
    const mod = e.metaKey || e.ctrlKey;
    if (e.key === 'Tab') {
      e.preventDefault();
      switchScope(cycleScope(scope, e.shiftKey ? -1 : 1));
    } else if (mod && !e.shiftKey && !e.altKey && e.key.toLowerCase() === 'p') {
      e.preventDefault();
      switchScope('collections');
    } else if (e.key === 'ArrowUp' && (browsing || query === '') && history.length > 0) {
      e.preventDefault();
      recall('older');
    } else if (e.key === 'ArrowDown' && browsing) {
      e.preventDefault();
      recall('newer');
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      moveCursor(1);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      moveCursor(-1);
    } else if (e.key === 'Home') {
      e.preventDefault();
      setCursor(0);
    } else if (e.key === 'End') {
      e.preventDefault();
      setCursor(Math.max(0, entries.length - 1));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (cursorEntry) activate(cursorEntry);
    }
  };

  const onlyFromQuery = entries.length > 0 && entries.every((e) => e.type === 'row' && e.row.fromQuery);
  const emptyText = typed
    ? `No matches for "${query.trim()}"`
    : scope === 'all'
      ? 'No actions available here yet.'
      : `Type to search ${SCOPE_LABEL[scope].toLowerCase()}.`;

  return (
    <div>
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 'var(--atelier-gap-sm)',
          padding: '12px 16px',
          borderBottom: BAR_BORDER,
          color: 'var(--atelier-text-muted)',
        }}
      >
        <Svg>
          <circle cx="11" cy="11" r="7" />
          <path d="M20 20l-4-4" />
        </Svg>
        <input
          ref={inputRef}
          data-autofocus
          className="atelier-palette-input"
          value={query}
          onChange={(e) => setQuery(e.currentTarget.value)}
          placeholder="Search collections, actions, tabs…"
          aria-label="Search commands"
          role="combobox"
          aria-expanded
          aria-controls={listId}
          aria-autocomplete="list"
          aria-activedescendant={activeId}
          onKeyDown={onKeyDown}
          spellCheck={false}
          autoComplete="off"
          style={{
            flex: 1,
            minWidth: 0,
            background: 'transparent',
            border: 0,
            outline: 0,
            color: 'var(--atelier-text)',
            font: 'inherit',
            fontSize: 'var(--atelier-fs-lg)',
          }}
        />
        <Kbd>esc</Kbd>
      </div>
      <div
        role="tablist"
        aria-label="Scope"
        style={{ display: 'flex', gap: 'var(--atelier-gap-xs)', padding: '8px 12px', borderBottom: BAR_BORDER, alignItems: 'center' }}
      >
        {SCOPES.map((s) => {
          const selected = s === scope;
          return (
            <button
              key={s}
              type="button"
              role="tab"
              tabIndex={-1}
              aria-selected={selected}
              aria-controls={listId}
              // The input keeps the focus: a click selects the scope, nothing more.
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => switchScope(s)}
              style={{
                background: selected ? 'var(--atelier-accent-soft)' : 'transparent',
                border: 0,
                color: selected ? 'var(--atelier-accent-ink)' : 'var(--atelier-text-muted)',
                fontWeight: selected ? 600 : 400,
                font: 'inherit',
                fontSize: 'var(--atelier-fs-sm)',
                padding: '4px 10px',
                borderRadius: 'var(--atelier-radius-sm)',
                cursor: 'pointer',
              }}
            >
              {SCOPE_LABEL[s]}
              {layout.counts && s !== 'all' && (
                <span
                  data-count
                  style={{
                    fontSize: 'var(--atelier-fs-xs)',
                    marginLeft: 5,
                    color: 'var(--atelier-text-ghost)',
                    fontWeight: 400,
                  }}
                >
                  {layout.counts[s]}
                </span>
              )}
            </button>
          );
        })}
        {!typed && (
          <>
            <span style={{ flex: 1 }} />
            <span style={{ fontSize: 'var(--atelier-fs-xs)', color: 'var(--atelier-text-ghost)' }}>
              Tab to switch scope
            </span>
          </>
        )}
      </div>
      <div
        id={listId}
        role="listbox"
        aria-label={scope === 'all' ? 'Results' : SCOPE_LABEL[scope]}
        style={{
          maxHeight: 'min(460px, calc(100vh - 260px))',
          overflowY: 'auto',
          padding: scope === 'all' ? '0 0 4px' : '4px 0',
        }}
      >
        {entries.length === 0 ? (
          <div
            style={{
              padding: '24px 16px',
              textAlign: 'center',
              fontSize: 'var(--atelier-fs-sm)',
              color: 'var(--atelier-text-muted)',
            }}
          >
            {emptyText}
          </div>
        ) : (
          layout.groups.map((group) => {
            const views = group.entries.map((entry) => (
              <EntryView
                key={entry.id}
                entry={entry}
                id={optionId(entry)}
                isCursor={entry.index === safeCursor}
                onActivate={activate}
                onHover={setCursor}
              />
            ));
            if (group.label === null) return <React.Fragment key={group.key}>{views}</React.Fragment>;
            return (
              <div key={group.key} role="group" aria-labelledby={`${listId}-grp-${group.key}`}>
                <div
                  id={`${listId}-grp-${group.key}`}
                  style={{
                    padding: '10px 16px 4px',
                    fontSize: 'var(--atelier-fs-xs)',
                    fontWeight: 700,
                    textTransform: 'uppercase',
                    letterSpacing: '0.08em',
                    color: 'var(--atelier-text-muted)',
                  }}
                >
                  {group.label}
                </div>
                {views}
              </div>
            );
          })
        )}
        {onlyFromQuery && (
          <div
            style={{
              padding: '20px 16px',
              textAlign: 'center',
              fontSize: 'var(--atelier-fs-sm)',
              color: 'var(--atelier-text-muted)',
            }}
          >
            No other matches
          </div>
        )}
      </div>
      {layout.hidden > 0 && (
        <div
          data-row-limit
          style={{
            padding: '8px 16px',
            fontSize: 'var(--atelier-fs-sm)',
            color: 'var(--atelier-text-muted)',
            borderTop: BAR_BORDER,
            background: 'var(--atelier-surface-raised)',
          }}
        >
          Showing the best {SCOPE_CAP} · keep typing to narrow {layout.hidden} more
        </div>
      )}
      <Footer hints={footerHints(scope, typed, cursorEntry)} />
    </div>
  );
}

// ── CommandPalette shell ──────────────────────────────────────────────────────

interface PaletteShellProps {
  registerApi: (api: PaletteApi) => void;
}

export function CommandPalette({ registerApi }: PaletteShellProps) {
  const [recentIds, setRecentIds] = React.useState<string[]>([]);
  // Session only: never persisted.
  const [history, setHistory] = React.useState<string[]>([]);
  // The scope the next open lands on: All, except through ⌘P.
  const [openScope, setOpenScope] = React.useState<Scope>('all');

  const hints = useHints();
  const paletteOpenedCount = hints.getSessionEventCount('palette', 'opened');
  const discoverHint = useFeatureHint('palette.discover', paletteOpenedCount === 0);
  const { opened } = useSpotlight(paletteStore);

  const openPalette = React.useCallback(() => {
    hints.recordSessionEvent('palette', 'opened');
    paletteControls.open();
  }, [hints]);

  const closePalette = React.useCallback(() => {
    paletteControls.close();
  }, []);

  const togglePalette = React.useCallback(() => {
    if (paletteStore.getState().opened) {
      paletteControls.close();
    } else {
      hints.recordSessionEvent('palette', 'opened');
      paletteControls.open();
    }
  }, [hints]);

  // A query the palette closes on, after a perform or not, is one to come back to.
  const onPaletteClose = React.useCallback(() => {
    const { query } = paletteStore.getState();
    setHistory((h) => pushHistory(h, query));
    setOpenScope('all');
  }, []);

  // ⌘P opens on Collections. The same rules as ⌘N and ⌘, (GlobalCommands): a
  // dialog that is already open keeps the key, and in a text field only ⌘
  // reaches it, since a bare Ctrl+P is macOS's previous-line.
  React.useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey) || e.shiftKey || e.altKey || e.key.toLowerCase() !== 'p') return;
      const origin = e.target instanceof HTMLElement ? e.target : null;
      if (origin?.closest('[role="dialog"], [role="alertdialog"]')) return;
      if (origin?.closest('input, textarea, select, [contenteditable]') && !e.metaKey) return;
      e.preventDefault();
      hints.recordSessionEvent('palette', 'opened');
      setOpenScope('collections');
      paletteControls.open();
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [hints]);

  // Capture phase, registered once: focus has usually moved onto the search
  // input before Mantine reports the palette open, so the opener has to be
  // known beforehand. See paletteOpener.ts.
  React.useEffect(() => {
    const track = (e: FocusEvent) => setPaletteOpener(e.target);
    document.addEventListener('focusin', track, true);
    return () => document.removeEventListener('focusin', track, true);
  }, []);

  React.useEffect(() => {
    registerApi({
      open: openPalette,
      close: closePalette,
      toggle: togglePalette,
      isOpen: () => paletteStore.getState().opened,
    });
  }, [registerApi, openPalette, closePalette, togglePalette]);

  // History is a convenience: a failed read or write leaves the palette fully
  // usable. A failed read is logged, like the theme's; a failed write is a toast,
  // like the layout's. Stale ids are dropped by rankCommands.
  // Nothing is written until the stored history has been read and merged, so a
  // command run early never overwrites it; after a failed read, never.
  const [historyRead, setHistoryRead] = React.useState<'pending' | 'done' | 'failed'>('pending');
  React.useEffect(() => {
    let active = true;
    api.prefs
      .get<unknown>(MRU_PREF_KEY)
      .then((stored) => {
        if (!active) return;
        if (Array.isArray(stored) && stored.every((v): v is string => typeof v === 'string')) {
          // Merged behind anything performed while the read was in flight.
          setRecentIds((prev) =>
            [...prev, ...stored.filter((id) => !prev.includes(id))].slice(0, MRU_CAP),
          );
        }
        setHistoryRead('done');
      })
      .catch((err: unknown) => {
        console.warn('[palette] could not load the command history', err);
        if (active) setHistoryRead('failed');
      });
    return () => {
      active = false;
    };
  }, []);

  // Written from an effect, not the state updater (StrictMode runs updaters
  // twice), and only after a perform — the seed is never written back.
  const recentDirtyRef = React.useRef(false);
  React.useEffect(() => {
    if (historyRead !== 'done' || !recentDirtyRef.current) return;
    recentDirtyRef.current = false;
    void api.prefs.set(MRU_PREF_KEY, recentIds).catch(() => {
      notify.error('Could not save the command history', { id: 'palette-history-save-failed' });
    });
  }, [recentIds, historyRead]);

  const recordRecent = React.useCallback((id: string) => {
    recentDirtyRef.current = true;
    setRecentIds((prev) => {
      const next = [id, ...prev.filter((p) => p !== id)];
      return next.slice(0, MRU_CAP);
    });
  }, []);

  return (
    <>
      <SpotlightRoot
        data-command-palette
        store={paletteStore}
        shortcut="mod + K"
        // The last query comes back on the next open (X07 §13.3).
        clearQueryOnClose={false}
        onSpotlightClose={onPaletteClose}
        // Mantine's Modal applies `aria-label` to the outer root, not the
        // `role="dialog"` content element, so it never names the dialog. The
        // dialog's accessible name comes from its title (rendered as
        // `aria-labelledby`). Keep the legacy name "Command palette" — relied
        // on by the F04 e2e — while hiding the header so the palette stays
        // visually title-less.
        title="Command palette"
        styles={{
          header: { display: 'none' },
          content: {
            background: 'var(--atelier-surface)',
            border: '1px solid var(--atelier-border-med)',
            borderRadius: 'var(--atelier-radius)',
            boxShadow: 'var(--atelier-shadow-lg)',
            color: 'var(--atelier-text)',
            fontSize: 'var(--atelier-fs-md)',
            overflow: 'hidden',
          },
          body: { padding: 0 },
        }}
        size={640}
        yOffset={80}
      >
        {/* Only mount palette content while opened — keeps registry memos and
            keyboard handlers off the render path when the modal is closed. */}
        {opened && (
          <PaletteContent
            onClose={closePalette}
            recentIds={recentIds}
            recordRecent={recordRecent}
            initialScope={openScope}
            history={history}
          />
        )}
      </SpotlightRoot>
      <FeatureHint
        id="palette.discover"
        visible={discoverHint.visible}
        onDismiss={discoverHint.dismiss}
        onCta={openPalette}
      />
    </>
  );
}

// ── CommandPaletteRoot ────────────────────────────────────────────────────────

/**
 * Wraps `<CommandPalette>` and exposes its imperative API to descendants
 * via `usePaletteApi()`. Mount once near the App root.
 */
export function CommandPaletteRoot({ children }: { children: React.ReactNode }) {
  const apiRef = React.useRef<PaletteApi | null>(null);
  const registerApi = React.useCallback((next: PaletteApi) => {
    apiRef.current = next;
  }, []);
  return (
    <ApiRefCtx.Provider value={apiRef}>
      {children}
      <CommandPalette registerApi={registerApi} />
    </ApiRefCtx.Provider>
  );
}
