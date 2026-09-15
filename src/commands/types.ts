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

export interface Command {
  id: string;
  title: string;
  subtitle?: string;
  group: CommandGroup;
  keywords?: string[];
  shortcut?: string;
  when?: (ctx: PaletteContext) => boolean;
  perform: (ctx: PaletteContext) => void | Promise<void>;
}
