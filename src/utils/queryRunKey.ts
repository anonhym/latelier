export interface QueryRunKeyInput {
  connectionId: string;
  dbName: string;
  collection: string;
  filter?: string;
  projection?: string[];
  /**
   * W15 §9(b)'s verbatim projection escape hatch. Required rather than
   * optional so both call sites are forced to pass it — the bug this replaced
   * was each one independently forgetting to, and an optional field
   * would let the next caller repeat it silently.
   */
  projectionRaw: string | undefined;
  sort?: string;
  limit?: number | null;
  skip?: number;
}

// Use the unit-separator (US, U+001F) so user-controlled strings
// (collection names, filter JSON, sort) cannot collide with the joiner.
const SEP = '\x1f';

export function queryRunKey(input: QueryRunKeyInput): string {
  // Mirror `compileFindOptions`: a non-blank `projectionRaw` wins verbatim and
  // the modelled field list is not consulted at all. Two runs with the same raw
  // projection execute identically, so they must share a bucket however their
  // (unused) modelled projection differs — and vice versa.
  //
  // The `r`/`m` tag keeps the two spaces disjoint, so a raw string can never
  // collide with a field list that happens to join to the same text. Same
  // reasoning as the separator above.
  const raw = input.projectionRaw?.trim();
  const proj = raw
    ? `r${SEP}${raw}`
    : `m${SEP}${(input.projection ?? []).slice().sort().join(SEP)}`;
  return [
    input.connectionId,
    input.dbName,
    input.collection,
    input.filter ?? '',
    proj,
    input.sort ?? '',
    input.limit ?? '',
    input.skip ?? 0,
  ].join(SEP);
}
