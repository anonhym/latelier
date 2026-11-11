import { describe, expect, it } from 'vitest';
import { rankCommands, groupRows } from '../../src/commands/rank';
import type { Command, PaletteContext } from '../../src/commands/types';

const ctx: PaletteContext = { pathname: '/workspace', connectionId: 'c1' };

// X07 §13.7 rule 4: the ranker takes no more than 16 ms at 50,000 collections
// plus the commands, for any query. Median of 15 runs, the first one warming
// the per-registration cache.
const BOUND_MS = 16;
const RUNS = 15;

function catalog(collections: number): Command[] {
  const cmds: Command[] = [];
  for (let i = 0; i < 40; i++) {
    cmds.push({ id: `cmd.${i}`, title: `Run command number ${i}`, group: 'general', keywords: ['x'], perform: () => {} });
  }
  for (let i = 0; i < collections; i++) {
    const db = `db${i % 50}`;
    const coll = `collection_${i}`;
    cmds.push({
      id: `tab.open:c1:${db}:${coll}`,
      title: `Open: ${db}.${coll}`,
      matchText: `${db}.${coll}`,
      subtitle: 'Production',
      group: 'workspace',
      hideWhenEmptyQuery: true,
      perform: () => {},
    });
  }
  return cmds;
}

function median(all: Command[], query: string): number {
  const times: number[] = [];
  for (let i = 0; i < RUNS; i++) {
    const t0 = performance.now();
    groupRows(rankCommands(all, query, ctx, ['cmd.3']));
    times.push(performance.now() - t0);
  }
  times.sort((a, b) => a - b);
  return times[Math.floor(RUNS / 2)]!;
}

// Stryker's instrumented code runs slower than the budget allows, so a mutant
// would be "killed" by the clock rather than by an assertion about behaviour.
const underStryker = process.env.STRYKER_MUTATOR_WORKER !== undefined;

describe.skipIf(underStryker)('ranker budget at 50,000 collections', () => {
  const all = catalog(50_000);

  it.each(['', 'o', 'ord', 'collection 42', 'zzz', 'db1.collection_2'])('stays within the frame for %j', (query) => {
    expect(median(all, query)).toBeLessThanOrEqual(BOUND_MS);
  });
});
