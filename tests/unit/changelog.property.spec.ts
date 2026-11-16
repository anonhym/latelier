import fs from 'node:fs';
import path from 'node:path';
import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { compareVersions, parseChangelog, releasesBetween, type Release } from '../../src/features/updates/changelog';

const REAL = fs.readFileSync(path.resolve(import.meta.dirname, '../../CHANGELOG.md'), 'utf8');
// Parsed inside each property, not at load, in a hook, or cached (see changelog.spec.ts).
const all = (): Release[] => parseChangelog(REAL);
const allVersions = (): string[] => all().map((r) => r.version);
// An index, resolved inside the property: the versions are only known once the
// file has been parsed (see changelog.spec.ts for why that is not at load).
const index = fc.nat(1000);
const pick = (i: number): string => allVersions()[i % allVersions().length];

describe('releasesBetween (property)', () => {
  it('returns exactly the releases with from < v <= to, newest first', () => {
    fc.assert(
      fc.property(index, index, (i, j) => {
        const from = pick(i);
        const to = pick(j);
        const got = releasesBetween(all(), from, to).map((r) => r.version);
        const want = allVersions()
          .filter((v) => compareVersions(v, from) > 0 && compareVersions(v, to) <= 0)
          .sort((a, b) => compareVersions(b, a));
        expect(got).toEqual(want);
      }),
    );
  });

  it('returns nothing when from >= to', () => {
    fc.assert(
      fc.property(index, index, (i, j) => {
        const a = pick(i);
        const b = pick(j);
        const [from, to] = compareVersions(a, b) >= 0 ? [a, b] : [b, a];
        expect(releasesBetween(all(), from, to)).toEqual([]);
      }),
    );
  });

  it('agrees with compareVersions for arbitrary x.y.z bounds', () => {
    const part = fc.integer({ min: 0, max: 30 });
    const semver = fc.tuple(part, part, part).map((t) => t.join('.'));
    fc.assert(
      fc.property(semver, semver, (from, to) => {
        const got = releasesBetween(all(), from, to).map((r) => r.version);
        expect(got).toEqual(
          allVersions().filter((v) => compareVersions(v, from) > 0 && compareVersions(v, to) <= 0),
        );
      }),
    );
  });
});
