import fs from 'node:fs';
import path from 'node:path';
import { describe, it, expect } from 'vitest';
import {
  compareVersions,
  isVersion,
  parseChangelog,
  releasesBetween,
  summarizeRelease,
  type Release,
} from '../../src/features/updates/changelog';

// Parsed afresh inside each test, never at module load, in a hook, or cached:
// a parser that throws before a test body runs fails no individual test, and a
// cache hides the parser's lines from every test but the first, so Stryker's
// per-test coverage would run only that one test against each mutant.
const REAL = fs.readFileSync(path.resolve(import.meta.dirname, '../../CHANGELOG.md'), 'utf8');
const all = (): Release[] => parseChangelog(REAL);
const byVersion = (v: string): Release => {
  const r = all().find((x) => x.version === v);
  if (!r) throw new Error(`no ${v} in the parsed changelog`);
  return r;
};
const group = (r: Release, name: string) => r.groups.find((g) => g.name === name);

describe('parseChangelog against the real CHANGELOG.md', () => {
  it('skips [Unreleased] and everything below 0.15.0, keeping file order newest first', () => {
    const versions = all().map((r) => r.version);
    expect(versions[0]).toBe('0.22.1');
    expect(versions.at(-1)).toBe('0.15.0');
    expect(versions).not.toContain('0.14.0');
    expect(versions).not.toContain('Unreleased');
    for (let i = 1; i < versions.length; i++) {
      expect(compareVersions(versions[i - 1], versions[i])).toBeGreaterThan(0);
    }
  });

  it('0.20.0 has 8 Changed leads and one leadless item, and 4 Fixed leads', () => {
    const r = byVersion('0.20.0');
    expect(r.date).toBe('2026-11-13');
    const changed = group(r, 'Changed')!.items;
    expect(changed).toHaveLength(9);
    expect(changed.filter((i) => i.lead !== null)).toHaveLength(8);
    expect(changed.filter((i) => i.lead === null)).toHaveLength(1);
    expect(changed.find((i) => i.lead === null)!.text).toMatch(/^Run and Refresh look the same everywhere/);
    const fixed = group(r, 'Fixed')!.items;
    expect(fixed).toHaveLength(4);
    expect(fixed.every((i) => i.lead !== null)).toBe(true);
  });

  it('joins wrapped bullets, drops the bold markers, and normalizes the lead', () => {
    const first = group(byVersion('0.20.0'), 'Changed')!.items[0];
    expect(first.lead).toBe('The dark theme reads in layers.');
    expect(first.text.startsWith('The dark theme reads in layers. The window, panels')).toBe(true);
    expect(first.text).not.toContain('**');
    expect(first.text).not.toContain('\n');
    // Inline code keeps its backticks.
    const json = group(byVersion('0.20.0'), 'Changed')!.items.find((i) => i.lead?.startsWith('The JSON view'));
    expect(json!.text).toContain('`$numberInt`');
  });

  it("0.17.0 keeps its two preamble paragraphs, including the Always Allow note", () => {
    const r = byVersion('0.17.0');
    expect(r.preamble).toHaveLength(2);
    expect(r.preamble[0]).toContain('Click "Always Allow".');
    expect(r.preamble[0]).not.toContain('**');
    expect(r.preamble[1]).toMatch(/^On macOS, users of 0\.16\.0 install this release by hand once/);
  });

  it('0.17.1 is preamble only, with no groups', () => {
    const r = byVersion('0.17.1');
    expect(r.preamble).toHaveLength(1);
    expect(r.groups).toEqual([]);
  });

  it('leaves out groups that are not one of the six Keep a Changelog names', () => {
    const names = new Set(all().flatMap((r) => r.groups.map((g) => g.name)));
    expect([...names].sort((a, b) => a.localeCompare(b))).toEqual(['Added', 'Changed', 'Fixed', 'Removed', 'Security']);
    // 0.17.0's Documentation group is not in the release.
    expect(byVersion('0.17.0').groups.map((g) => g.name)).toEqual(['Added', 'Changed', 'Fixed']);
  });

  it('folds a nested bullet into its parent item', () => {
    const items = all().flatMap((r) => r.groups.flatMap((g) => g.items));
    const nested = items.find((i) => i.text.startsWith('Keyboard operability across the custom controls'));
    expect(nested!.text).toContain('one tab stop each');
    expect(nested!.text).not.toMatch(/ - /);
  });
});

describe('parseChangelog on small inputs', () => {
  const md = (body: string) => `# Changelog\n\n## [Unreleased]\n\n### Added\n\n- **Hidden.** nope\n\n${body}`;

  it('reads a heading without a date, with LF or CRLF line ends', () => {
    const src = md('## [1.2.3]\n\n### Fixed\n\n- **A fix.** Done.\n');
    for (const text of [src, src.replaceAll('\n', '\r\n')]) {
      const [r] = parseChangelog(text);
      expect(r).toEqual({
        version: '1.2.3',
        date: null,
        preamble: [],
        groups: [{ name: 'Fixed', items: [{ lead: 'A fix.', text: 'A fix. Done.' }] }],
      });
    }
  });

  it.each([
    ['a comma', '**Does a thing,** then more.', 'Does a thing.'],
    ['two periods', '**Does a thing..** then more.', 'Does a thing.'],
    ['a colon', '**Denser:** 33 px.', 'Denser.'],
    ['no punctuation', '**Sits beside Fields** in the bar.', 'Sits beside Fields.'],
    ['a question mark', '**Why?** Because.', 'Why?'],
    ['an exclamation mark', '**Yes!** Done.', 'Yes!'],
  ])('lead normalization: %s', (_n, bullet, lead) => {
    const [r] = parseChangelog(md(`## [1.0.0] — 2026-01-01\n\n### Added\n\n- ${bullet}\n`));
    expect(r.groups[0].items[0].lead).toBe(lead);
  });

  it('a bullet that does not start with bold has no lead', () => {
    const [r] = parseChangelog(md('## [1.0.0]\n\n### Added\n\n- Plain **bold** later.\n- **Unclosed lead\n'));
    expect(r.groups[0].items).toEqual([
      { lead: null, text: 'Plain bold later.' },
      { lead: null, text: 'Unclosed lead' },
    ]);
  });

  it('joins a lead that wraps over two lines', () => {
    const [r] = parseChangelog(md('## [1.0.0]\n\n### Added\n\n- **A long lead that\n  wraps.** And the rest.\n'));
    expect(r.groups[0].items[0].lead).toBe('A long lead that wraps.');
  });

  it('ignores stray non-indented text and blank lines between bullets', () => {
    const [r] = parseChangelog(md('## [1.0.0]\n\n### Added\n\n- **One.** a\n\nstray\n\n- **Two.** b\n'));
    expect(r.groups[0].items.map((i) => i.text)).toEqual(['One. a', 'Two. b']);
  });

  it('drops a group with no items and unknown headings', () => {
    const [r] = parseChangelog(md('## [1.0.0]\n\n### Added\n\n### Fixed\n\n- **F.** x\n\n## [Other]\n\n### Added\n\n- **N.** y\n'));
    expect(r.groups.map((g) => g.name)).toEqual(['Fixed']);
  });

  it('keeps a paragraph that wraps as one string, and splits on blank lines', () => {
    const [r] = parseChangelog(md('## [1.0.0]\n\nfirst line\nsecond **line**\n\nthird\n\n### Added\n\n- **A.** b\n'));
    expect(r.preamble).toEqual(['first line second line', 'third']);
  });

  it('skips 0.14.x versions but keeps 0.15.0 and 0.14.9 is gone', () => {
    const out = parseChangelog(md('## [0.15.0]\n\n### Added\n\n- **A.** b\n\n## [0.14.9]\n\n### Added\n\n- **C.** d\n'));
    expect(out.map((r) => r.version)).toEqual(['0.15.0']);
  });

  it('reads every one of the six group names', () => {
    const names = ['Added', 'Changed', 'Fixed', 'Security', 'Removed', 'Deprecated'];
    const body = names.map((n) => `### ${n}\n\n- **${n} item.** x\n`).join('\n');
    const [r] = parseChangelog(md(`## [1.0.0]\n\n${body}`));
    expect(r.groups.map((g) => g.name)).toEqual(names);
    expect(r.groups.every((g) => g.items.length === 1)).toBe(true);
  });

  it('drops the bullets of a group it does not keep, without leaking them into the group before', () => {
    const [r] = parseChangelog(md('## [1.0.0]\n\n### Fixed\n\n- **F.** x\n\n### Documentation\n\n- **D.** y\n  wrapped\n\n### Added\n\n- **A.** z\n'));
    expect(r.groups.map((g) => [g.name, g.items.map((i) => i.lead)])).toEqual([
      ['Fixed', ['F.']],
      ['Added', ['A.']],
    ]);
    expect(group(byVersion('0.17.0'), 'Fixed')!.items).toHaveLength(2);
  });

  it('does not take a heading with extra words for a group', () => {
    const [r] = parseChangelog(md('## [1.0.0]\n\n### Fixed things\n\n- **X.** y\n\n### Added\n\n- **A.** b\n'));
    expect(r.groups.map((g) => g.name)).toEqual(['Added']);
  });

  it('accepts several spaces around the heading dash, and rejects trailing words', () => {
    const [r] = parseChangelog(md('## [1.0.0]  —  2026-02-03\n\n### Added\n\n- **A.** b\n'));
    expect(r.date).toBe('2026-02-03');
    expect(parseChangelog(md('## [1.0.0] — 2026-02-03 extra\n\n### Added\n\n- **A.** b\n'))).toEqual([]);
    expect(parseChangelog(md('## [1.0.0]x\n\n### Added\n\n- **A.** b\n'))).toEqual([]);
  });

  it('accepts an ASCII hyphen as the heading dash', () => {
    expect(parseChangelog(md('## [1.0.0] - 2026-02-03\n\n### Added\n\n- **A.** b\n'))[0].date).toBe('2026-02-03');
  });

  it('treats heading-looking text inside an indented line as part of the bullet', () => {
    const [r] = parseChangelog(
      md('## [1.0.0]\n\n### Added\n\n- **A.** one\n  ## [9.9.9]\n  ### Fixed\n  tail\n'),
    );
    expect(parseChangelog(md('## [1.0.0]\n\n### Added\n\n- **A.** one\n  ## [9.9.9]\n')).map((x) => x.version)).toEqual(['1.0.0']);
    expect(r.groups.map((g) => g.name)).toEqual(['Added']);
    expect(r.groups[0].items[0].text).toBe('A. one ## [9.9.9] ### Fixed tail');
  });

  it('does not take a dash in the middle of an unindented line for a bullet', () => {
    const [r] = parseChangelog(md('## [1.0.0]\n\n### Added\n\n- **A.** one\nstray - text\n- **B.** two\n'));
    expect(r.groups[0].items.map((i) => i.text)).toEqual(['A. one', 'B. two']);
  });

  it('trims spaces after the bullet marker and folds nested bullets without their marker', () => {
    const [r] = parseChangelog(md('## [1.0.0]\n\n### Added\n\n-   **A.** one\n  - nested\n    deeper\n  wrapped\n'));
    expect(r.groups[0].items).toEqual([{ lead: 'A.', text: 'A. one nested deeper wrapped' }]);
  });

  it('keeps punctuation inside a lead and reads a group heading with extra spaces', () => {
    const [r] = parseChangelog(md('## [1.0.0]\n\n###  Fixed\n\n- **Fix. Then more, really,** rest\n'));
    expect(r.groups[0].name).toBe('Fixed');
    expect(r.groups[0].items[0].lead).toBe('Fix. Then more, really.');
  });

  it('trims a padded lead and stops at the lead itself', () => {
    const [r] = parseChangelog(md('## [1.0.0]\n\n### Added\n\n- ** Padded ,** rest\n- **.** dot\n'));
    expect(r.groups[0].items.map((i) => i.lead)).toEqual(['Padded.', '.']);
  });

  it('closes a paragraph or a bullet that no blank line ends', () => {
    // Preamble straight into a group heading, a bullet straight into the next
    // group heading, and a bullet straight into the next release.
    const [a, b] = parseChangelog(
      md('## [2.0.0]\nintro\n### Added\n- **A.** x\n### Fixed\n- **F.** y\n## [1.0.0]\ntail para\n## [0.15.0]\nlast'),
    );
    expect(a.preamble).toEqual(['intro']);
    expect(a.groups.map((g) => [g.name, g.items.length])).toEqual([['Added', 1], ['Fixed', 1]]);
    expect(b.preamble).toEqual(['tail para']);
    expect(parseChangelog('## [0.15.0]\nlast')[0].preamble).toEqual(['last']);
  });

  it('keeps an indented preamble line trimmed in the joined paragraph', () => {
    const [r] = parseChangelog(md('## [1.0.0]\n\nfirst\n   second\n\n   \nthird\n'));
    expect(r.preamble).toEqual(['first second', 'third']);
  });

  it('ignores text above the first heading', () => {
    expect(parseChangelog('Some title\n\nand prose\n- **x.** y\n')).toEqual([]);
  });

  it('returns nothing for an empty file', () => {
    expect(parseChangelog('')).toEqual([]);
  });
});

describe('compareVersions', () => {
  it('orders numerically, not lexically', () => {
    expect(compareVersions('0.9.0', '0.10.0')).toBeLessThan(0);
    expect(compareVersions('0.20.0', '0.3.0')).toBeGreaterThan(0);
    expect(compareVersions('1.0.0', '0.99.99')).toBeGreaterThan(0);
    expect(compareVersions('1.2.3', '1.2.4')).toBeLessThan(0);
    expect(compareVersions('1.3.0', '1.2.9')).toBeGreaterThan(0);
    expect(compareVersions('1.2.3', '1.2.3')).toBe(0);
  });

  it.each(['', '1', '1.2', '1.2.3.4', 'v1.2.3', '1.2.3-beta.1', '1.2.3+build', '01.2.3', '1.02.3', '1.2.-3', ' 1.2.3', '1.2.3\n', '1.2.x', '9999999999.0.0'])(
    'rejects %j',
    (bad) => {
      expect(isVersion(bad)).toBe(false);
      expect(() => compareVersions(bad, '1.0.0')).toThrow(/Not a plain x\.y\.z version/);
      expect(() => compareVersions('1.0.0', bad)).toThrow(/Not a plain x\.y\.z version/);
    },
  );

  it('accepts zero parts and nine-digit parts', () => {
    expect(isVersion('0.0.0')).toBe(true);
    expect(isVersion('999999999.999999999.999999999')).toBe(true);
  });
});

describe('releasesBetween', () => {
  it('is half-open: excludes from, includes to, newest first', () => {
    expect(releasesBetween(all(), '0.19.0', '0.20.0').map((r) => r.version)).toEqual(['0.20.0', '0.19.1']);
    expect(releasesBetween(all(), '0.17.0', '0.19.0').map((r) => r.version)).toEqual(['0.19.0', '0.18.0', '0.17.1']);
  });

  it('sorts a shuffled input and leaves it untouched', () => {
    const shuffled = [...all()].reverse();
    const copy = [...shuffled];
    expect(releasesBetween(shuffled, '0.18.0', '0.20.0').map((r) => r.version)).toEqual(['0.20.0', '0.19.1', '0.19.0']);
    expect(shuffled).toEqual(copy);
  });

  it('is empty when from >= to, and throws on a malformed bound', () => {
    expect(releasesBetween(all(), '0.20.0', '0.20.0')).toEqual([]);
    expect(releasesBetween(all(), '0.21.0', '0.20.0')).toEqual([]);
    expect(() => releasesBetween(all(), 'nope', '0.20.0')).toThrow();
    expect(() => releasesBetween(all(), '0.19.0', 'nope')).toThrow();
  });
});

describe('summarizeRelease', () => {
  const rel = (groups: Array<[Release['groups'][number]['name'], number]>): Release => ({
    version: '1.0.0',
    date: null,
    preamble: [],
    groups: groups.map(([name, n]) => ({ name, items: Array.from({ length: n }, () => ({ lead: null, text: 'x' })) })),
  });

  it('counts fixes when the release only fixes', () => {
    expect(summarizeRelease(rel([['Fixed', 1]]))).toBe('1 fix');
    expect(summarizeRelease(rel([['Fixed', 3]]))).toBe('3 fixes');
    expect(summarizeRelease(rel([['Fixed', 2], ['Fixed', 1]]))).toBe('3 fixes');
  });

  it('counts every item as a change otherwise', () => {
    expect(summarizeRelease(rel([['Added', 1]]))).toBe('1 change');
    expect(summarizeRelease(rel([['Changed', 5]]))).toBe('5 changes');
    expect(summarizeRelease(rel([['Fixed', 1], ['Added', 1]]))).toBe('2 changes');
    expect(summarizeRelease(rel([['Fixed', 4], ['Security', 1]]))).toBe('5 changes');
  });

  it('says there are no changes when the release lists none', () => {
    expect(summarizeRelease(rel([]))).toBe('no changes');
  });

  it('matches the real file: 0.19.1 is 1 fix, 0.20.0 is 13 changes', () => {
    expect(summarizeRelease(byVersion('0.19.1'))).toBe('1 fix');
    expect(summarizeRelease(byVersion('0.20.0'))).toBe('13 changes');
  });
});
