export type CommandGroup =
  | 'general'
  | 'navigation'
  | 'connection'
  | 'workspace'
  | 'query'
  | 'view'
  | 'references'
  | 'aggregation';

export const GROUP_ORDER: readonly CommandGroup[] = [
  'general',
  'navigation',
  'connection',
  'workspace',
  'query',
  'view',
  'references',
  'aggregation',
];

export const GROUP_LABEL: Record<CommandGroup, string> = {
  general: 'General',
  navigation: 'Navigation',
  connection: 'Connection',
  workspace: 'Workspace',
  query: 'Query',
  view: 'View',
  references: 'References',
  aggregation: 'Aggregation',
};

export interface PaletteContext {
  pathname: string;
  connectionId: string | null;
}

/** The parts of a row built from the query itself. */
export interface QueryRow {
  title: string;
  subtitle: string;
  /** The part of `title` shown in the monospace font and the accent ink. */
  emphasis: string;
  /** Runs instead of the command's own `perform`: it knows the query. */
  perform: () => void | Promise<void>;
}

export interface Command {
  id: string;
  title: string;
  subtitle?: string;
  group: CommandGroup;
  keywords?: string[];
  shortcut?: string;
  when?: (ctx: PaletteContext) => boolean;
  /** Listed only once the user types: one row per collection would flood the empty palette. */
  hideWhenEmptyQuery?: boolean;
  /**
   * What every title match reads instead of the title, and what a row shows
   * as its title text when set. Set when the title carries a fixed prefix, so
   * `Open: ` is not text every row of the family shares.
   */
  matchText?: string;
  /**
   * A row that exists only for a query it recognises: returns its parts, or
   * null when the query is not for it. Never listed on an empty query, never
   * ranked, never recorded as recent; when it answers it is listed first.
   */
  forQuery?: (query: string) => QueryRow | null;
  /**
   * An on/off setting: the row shows a switch, and performing it flips the
   * state and leaves the palette open on the row. The title names the setting,
   * not the change (`Dark mode`, not `Toggle dark mode`).
   */
  toggle?: { checked: boolean };
  /**
   * Why the command cannot run here, or null when it can. A reason lists the
   * row greyed with the reason as its subtitle, and Enter does nothing. Unlike
   * `when`, which removes a command that does not apply here at all.
   */
  disabledReason?: (ctx: PaletteContext) => string | null;
  perform: (ctx: PaletteContext) => void | Promise<void>;
}
