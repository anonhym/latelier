import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { displayText, rankCommands } from '../../src/commands/rank';
import type { Command, PaletteContext } from '../../src/commands/types';

const ctx: PaletteContext = { pathname: '/workspace', connectionId: null };

// Letters, a separator of each kind, and a capital, so word starts, case
// changes and initials all come up.
const textChar = fc.constantFrom(...'abcdeoABCO .:_-/→1'.split(''));
const text = fc.string({ unit: textChar, minLength: 1, maxLength: 14 });
const tokenChar = fc.constantFrom(...'abcdeo.1'.split(''));
const token = fc.string({ unit: tokenChar, minLength: 1, maxLength: 4 });

const command = fc.record({
  title: text,
  matchText: fc.option(text, { nil: undefined }),
  subtitle: fc.option(text, { nil: undefined }),
  keywords: fc.option(fc.array(text, { maxLength: 3 }), { nil: undefined }),
});

const commands = fc.array(command, { minLength: 1, maxLength: 12 }).map((cs): Command[] =>
  cs.map(({ title, matchText, subtitle, keywords }, i) => ({
    id: `c${i}`,
    title,
    group: 'general',
    perform: () => {},
    ...(matchText !== undefined && { matchText }),
    ...(subtitle !== undefined && { subtitle }),
    ...(keywords !== undefined && { keywords }),
  })),
);

const ids = (all: Command[], q: string) => rankCommands(all, q, ctx, []).map((r) => r.cmd.id);

describe('rankCommands — properties', () => {
  it('lists the same rows for any ordering of the query tokens', () => {
    fc.assert(
      fc.property(commands, fc.array(token, { minLength: 1, maxLength: 3 }), fc.nat(), (all, tokens, seed) => {
        const shuffled = [...tokens].sort((a, b) => ((a.charCodeAt(0) * 31 + seed) % 7) - ((b.charCodeAt(0) * 31 + seed) % 7));
        const reversed = [...tokens].reverse();
        const byId = (a: string, b: string) => a.localeCompare(b);
        const base = ids(all, tokens.join(' ')).sort(byId);
        expect(ids(all, shuffled.join(' ')).sort(byId)).toEqual(base);
        expect(ids(all, reversed.join(' ')).sort(byId)).toEqual(base);
      }),
    );
  });

  it('returns ranges inside the text they refer to, ordered and apart', () => {
    fc.assert(
      fc.property(commands, fc.array(token, { minLength: 1, maxLength: 3 }), (all, tokens) => {
        for (const row of rankCommands(all, tokens.join(' '), ctx, [])) {
          const length = displayText(row.cmd).length;
          let previousEnd = -1;
          for (const [start, end] of row.ranges) {
            expect(start).toBeGreaterThanOrEqual(0);
            expect(end).toBeGreaterThan(start);
            expect(end).toBeLessThanOrEqual(length);
            // Merged: the next range starts after the last one ended, with a gap.
            expect(start).toBeGreaterThan(previousEnd);
            previousEnd = end;
          }
        }
      }),
    );
  });

  it('never adds a row when a token is added', () => {
    fc.assert(
      fc.property(commands, fc.array(token, { minLength: 1, maxLength: 3 }), token, (all, tokens, extra) => {
        const before = new Set(ids(all, tokens.join(' ')));
        for (const id of ids(all, [...tokens, extra].join(' '))) expect(before.has(id)).toBe(true);
      }),
    );
  });

  it('lists a row for a token that is a substring of its match text', () => {
    fc.assert(
      fc.property(commands, fc.nat(), fc.nat({ max: 3 }), (all, at, len) => {
        const cmd = all[0]!;
        const shown = displayText(cmd);
        const start = at % shown.length;
        const piece = shown.slice(start, start + len + 1).toLowerCase();
        fc.pre(piece.trim() === piece && piece.length > 0 && !/\s/.test(piece));
        expect(ids(all, piece)).toContain(cmd.id);
      }),
    );
  });
});
