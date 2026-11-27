/** What Setup & capabilities says an Agent can and cannot do (X30 §7), in X30's groups. */
export const TOOL_GROUPS: ReadonlyArray<{ title: string; tools: ReadonlyArray<{ names: string[]; desc: string }> }> = [
  {
    title: 'Explore',
    tools: [
      { names: ['list_connections'], desc: 'Shared Connections by name — never a host or URI. Closed ones show as unavailable.' },
      { names: ['list_databases'], desc: 'Databases, minus admin, local and config.' },
      { names: ['list_collections'], desc: 'Collections and views, minus system.*' },
      { names: ['list_indexes'], desc: 'Index names, keys and options.' },
      { names: ['collection_schema'], desc: 'Field paths, types and how often each appears in a sample. No values.' },
    ],
  },
  {
    title: 'Read',
    tools: [
      { names: ['find'], desc: 'Filter, projection, sort, limit, skip — nothing else.' },
      { names: ['count'], desc: 'Exact with a filter; an estimate without one, labelled so.' },
      { names: ['aggregate'], desc: 'Read-only stages only. $out, $merge, $search and admin stages are refused.' },
    ],
  },
  {
    title: 'Check',
    tools: [{ names: ['explain_find', 'explain_aggregate'], desc: 'The query plan only — never runs the query.' }],
  },
  {
    title: 'Relations',
    tools: [
      { names: ['list_references'], desc: 'Your Reference Rules: which field points at which collection.' },
      { names: ['suggest_references'], desc: "Likely references found by sampling, using the app's auto-detect." },
    ],
  },
  {
    title: 'Propose',
    tools: [
      {
        names: ['propose_reference_rule'],
        desc: 'Creates a Proposal for you to review — never a rule. Nothing changes until you accept it.',
      },
    ],
  },
];

export const LIMITS: ReadonlyArray<{ value: string; caption: string }> = [
  { value: '50 / 200', caption: 'documents by default / at most' },
  { value: '1 MiB', caption: 'per answer, cut cleanly and labelled as truncated' },
  { value: '10 s', caption: 'per operation' },
  { value: '2 + 4', caption: 'running + waiting per Connection, then BUSY' },
];

export const NEVER: readonly string[] = [
  'Write to a database',
  'See a host, URI or credential',
  'Open a Connection',
  'Run $out or $merge',
  'Read admin, local, config or system.*',
];

export const PROMPTS: readonly string[] = [
  'Which collections in Local dev reference customers?',
  'How many orders failed yesterday on Local dev?',
  'Propose Reference Rules for shop.orders',
];
