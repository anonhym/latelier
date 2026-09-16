import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import type { Connection } from '@shared/types';
import { buildUri } from '../../electron/mongo/uri';

function mk(overrides: Partial<Connection>): Connection {
  return {
    id: 'id',
    name: 'Test',
    color: '#1A6835',
    connectionType: 'standard',
    readOnly: false,
    host: 'localhost',
    port: 27017,
    defaultDb: undefined,
    authMech: 'none',
    authUsername: undefined,
    authDatabase: undefined,
    tls: { enabled: false, verify: true },
    advanced: {
      connectTimeoutMs: 10_000,
      socketTimeoutMs: 30_000,
      serverSelectionTimeoutMs: 30_000,
      readPreference: 'primary',
      maxPoolSize: 100,
      directConnection: false,
    },
    hasPasswordStored: false,
    hasSshPasswordStored: false,
    hasSshPassphraseStored: false,
    createdAt: '',
    updatedAt: '',
    ...overrides,
  };
}

/**
 * S8786 — the regexes rewritten in #13 group 3 all had two variable-length
 * parts that could be re-split against each other, so rejecting a long input
 * cost O(n^2). Each rewrite is supposed to accept exactly what it accepted
 * before, only without that ambiguity.
 *
 * Testing the modules themselves would only cover the handful of inputs
 * somebody thought to write down. These properties instead pin the rewrite
 * against the pattern it replaced, over generated input — the equivalence is
 * the claim, so the superseded pattern is inlined here as the oracle. If a
 * rewrite ever drifts, the property fails on the first input that tells them
 * apart rather than at some call site months later.
 *
 * Where the rewritten code is a regex the module keeps private, the superseded
 * pattern is inlined below as the oracle. Where it is a whole helper —
 * `uri.ts`'s slash strip — the property drives the real exported function
 * instead, because that file is in stryker's `mutate` list and a copied helper
 * would leave every mutant of the real one alive.
 */

function assertEquivalent(oldPattern: RegExp, newPattern: RegExp, arb: fc.Arbitrary<string>) {
  fc.assert(
    fc.property(arb, (s) => {
      // `test` on a non-global regex has no lastIndex state to reset.
      expect(newPattern.test(s)).toBe(oldPattern.test(s));
    }),
    { numRuns: 5000 },
  );
}

describe('filterTree decimal validation (src/pages/Workspace/filterTree.ts)', () => {
  const before = /^[+-]?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?$/;
  const after = /^[+-]?(\d+(\.\d*)?|\.\d+)([eE][+-]?\d+)?$/;

  it('accepts exactly the same strings as the ambiguous mantissa did', () => {
    assertEquivalent(before, after, fc.stringMatching(/^[-+.eE0-9 ]{0,14}$/));
  });

  it.each(['1', '1.', '1.5', '.5', '+1.5e-3', '-0.0E+10', '125'])('still accepts %j', (s) => {
    expect(after.test(s)).toBe(true);
  });

  it.each(['', '.', '1.2.3', '1e', 'e5', '1 ', 'abc'])('still rejects %j', (s) => {
    expect(after.test(s)).toBe(false);
  });
});

describe('shell sugar tails (electron/services/ShellService.ts)', () => {
  const cases: ReadonlyArray<readonly [string, RegExp, RegExp]> = [
    [
      'use "name"',
      /^[ \t]*use[ \t]+"([^"\s]+)"[ \t]*;?[ \t]*$/m,
      /^[ \t]*use[ \t]+"([^"\s]+)"[ \t]*(?:;[ \t]*)?$/m,
    ],
    [
      'use bare',
      /^[ \t]*use[ \t]+([^\s"';]+)[ \t]*;?[ \t]*$/m,
      /^[ \t]*use[ \t]+([^\s"';]+)[ \t]*(?:;[ \t]*)?$/m,
    ],
    [
      'show dbs',
      /^[ \t]*show[ \t]+(?:dbs|databases)[ \t]*;?[ \t]*$/m,
      /^[ \t]*show[ \t]+(?:dbs|databases)[ \t]*(?:;[ \t]*)?$/m,
    ],
  ];

  it.each(cases)('%s matches the same lines as before', (_name, before, after) => {
    assertEquivalent(before, after, fc.stringMatching(/^[a-z \t;"'0-9\n]{0,24}$/));
  });

  it('still rewrites the shapes the sugar exists for', () => {
    const [, , bareAfter] = cases[1];
    expect(bareAfter.test('use shop')).toBe(true);
    expect(bareAfter.test('  use shop ;  ')).toBe(true);
    expect(bareAfter.test('use shop;')).toBe(true);
    // Two semicolons were never accepted and still are not — the rewrite
    // groups the semicolon rather than widening the character class.
    expect(bareAfter.test('use shop;;')).toBe(false);
  });
});

describe('default-database slash stripping (electron/mongo/uri.ts)', () => {
  // Driven through `buildUri`, not through a copy of the walk: `uri.ts` is in
  // stryker's `mutate` list, and a copied helper leaves every mutant of the
  // real one alive.
  const dbPath = (defaultDb: string | undefined) =>
    new URL(buildUri(mk({ defaultDb }))).pathname;

  it('strips the same slashes the two replaces did', () => {
    fc.assert(
      fc.property(fc.stringMatching(/^[/a-z0-9 ]{0,16}$/), (defaultDb) => {
        const expected = defaultDb
          .replace(/^\/+/, '')
          .replace(/\/+$/, '')
          .trim();
        expect(dbPath(defaultDb)).toBe(expected ? `/${encodeURIComponent(expected)}` : '/');
      }),
      { numRuns: 5000 },
    );
  });

  it.each([
    ['shop', '/shop'],
    ['/shop', '/shop'],
    ['//shop//', '/shop'],
    // `trim()` runs *after* the strip, exactly as it did before this rewrite,
    // so slashes hidden behind padding survive and get percent-encoded. Pinned
    // because it looks like a bug and is not one to fix here.
    ['  /shop/  ', '/%2Fshop%2F'],
    ['///', '/'],
    ['', '/'],
    [undefined, '/'],
  ])('defaultDb %j -> path %j', (defaultDb, expected) => {
    expect(dbPath(defaultDb)).toBe(expected);
  });

  it('leaves an interior slash alone rather than collapsing the name', () => {
    // Percent-encoded, because the whole value is one path segment.
    expect(dbPath('//a/b//')).toBe('/a%2Fb');
  });
});

describe('caret padding (src/features/fieldSuggestions/FieldAutocompleteInput.tsx)', () => {
  it('measures the same leading and trailing whitespace as the regexes did', () => {
    fc.assert(
      fc.property(fc.string(), (raw) => {
        expect(raw.length - raw.trimStart().length).toBe(raw.match(/^\s*/)?.[0].length ?? 0);
        expect(raw.length - raw.trimEnd().length).toBe(raw.match(/\s*$/)?.[0].length ?? 0);
      }),
      { numRuns: 20000 },
    );
  });
});

describe('migration filename parsing (electron/db/migrationRunner.ts)', () => {
  function parse(pathname: string): number | null {
    const name = pathname.slice(pathname.lastIndexOf('/') + 1);
    const match = /^(\d+)-/.exec(name);
    if (!match || !name.endsWith('.sql')) return null;
    return Number(match[1]);
  }

  it('picks the same version the path-wide pattern did', () => {
    fc.assert(
      fc.property(fc.stringMatching(/^[a-z0-9/.-]{0,24}$/), (pathname) => {
        const old = pathname.match(/(\d+)-[^/]+\.sql$/);
        expect(parse(pathname)).toBe(old ? Number(old[1]) : null);
      }),
      { numRuns: 20000 },
    );
  });

  it.each([
    ['./migrations/001-init.sql', 1],
    ['./migrations/012-add-tabs.sql', 12],
    ['./migrations/readme.md', null],
    ['./migrations/init.sql', null],
  ])('%s -> %s', (pathname, expected) => {
    expect(parse(pathname)).toBe(expected);
  });
});

describe('acorn position suffix (src/utils/shellSyntax.ts)', () => {
  it.each([
    ['Unexpected token (1:5)', 'Unexpected token'],
    ['Unterminated string constant (3:12)', 'Unterminated string constant'],
    ['no position here', 'no position here'],
    ['trailing blanks (2:0)   ', 'trailing blanks'],
  ])('%j -> %j', (message, expected) => {
    expect(message.trimEnd().replace(/ ?\(\d+:\d+\)$/, '')).toBe(expected);
  });

  it('only strips a suffix, never a position mid-message', () => {
    expect('at (1:2) something failed'.trimEnd().replace(/ ?\(\d+:\d+\)$/, '')).toBe(
      'at (1:2) something failed',
    );
  });
});

describe('the rewrites are linear where the originals were quadratic', () => {
  // A timing assertion is the only way to state the actual defect: the old
  // patterns are *correct*, just super-linear. The ratio is what matters —
  // doubling the input roughly quadruples the old cost and leaves the new one
  // flat — so the bound is deliberately loose enough to survive a slow CI box.
  function elapsed(fn: () => void): number {
    const start = performance.now();
    fn();
    return performance.now() - start;
  }

  it('rejects a long ambiguous decimal without backtracking', () => {
    const pathological = '1'.repeat(20_000) + 'x';
    const after = /^[+-]?(\d+(\.\d*)?|\.\d+)([eE][+-]?\d+)?$/;
    expect(elapsed(() => after.test(pathological))).toBeLessThan(50);
  });

  it('rejects a long run of blanks in shell sugar without backtracking', () => {
    const pathological = 'use foo' + ' '.repeat(20_000) + '!';
    const after = /^[ \t]*use[ \t]+([^\s"';]+)[ \t]*(?:;[ \t]*)?$/m;
    expect(elapsed(() => after.test(pathological))).toBeLessThan(50);
  });
});
