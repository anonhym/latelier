// Pure CHANGELOG.md logic for the What's new window (X22 §6.1). No I/O: the
// renderer hands it the file's text, imported at build time with `?raw`.

export type GroupName = 'Added' | 'Changed' | 'Fixed' | 'Security' | 'Removed' | 'Deprecated';

export interface ReleaseItem {
  /** The bullet's leading bold text, ending in one period; null when it has none. */
  lead: string | null;
  /** The whole bullet as plain text, bold markers dropped. */
  text: string;
}

export interface ReleaseGroup {
  name: GroupName;
  items: ReleaseItem[];
}

export interface Release {
  version: string;
  /** ISO `YYYY-MM-DD`, as written in the heading. */
  date: string | null;
  preamble: string[];
  groups: ReleaseGroup[];
}

const GROUP_NAMES: readonly string[] = [
  'Added',
  'Changed',
  'Fixed',
  'Security',
  'Removed',
  'Deprecated',
];

/** Entries below this version are commit subjects, not user-facing prose. */
const FIRST_PROSE_VERSION = '0.15.0';

// Each part is `0` or a digit run without a leading zero, capped at nine
// digits so it stays an exact integer. Nothing here can backtrack.
const VERSION_RE = /^(0|[1-9]\d{0,8})\.(0|[1-9]\d{0,8})\.(0|[1-9]\d{0,8})$/;
// Lines are right-trimmed before they reach these, so none ends in whitespace.
const HEADING_RE = /^## \[([^\]]*)\](?:\s+[—-]\s+(\S+))?$/;
// `.+` runs to the end of the line, so no closing anchor.
const GROUP_RE = /^### (.+)/;
const LEAD_RE = /^\*\*(.+?)\*\*/;
const TRAILING_PUNCTUATION = '.,:;';

/** True for a plain `x.y.z` version that `compareVersions` accepts. */
export function isVersion(v: string): boolean {
  return VERSION_RE.test(v);
}

function parts(v: string): [number, number, number] {
  const m = VERSION_RE.exec(v);
  if (!m) throw new Error(`Not a plain x.y.z version: ${JSON.stringify(v)}`);
  return [Number.parseInt(m[1], 10), Number.parseInt(m[2], 10), Number.parseInt(m[3], 10)];
}

/** Negative when `a < b`, zero when equal, positive when `a > b`. Throws on anything but `x.y.z`. */
export function compareVersions(a: string, b: string): number {
  const pa = parts(a);
  const pb = parts(b);
  return pa[0] - pb[0] || pa[1] - pb[1] || pa[2] - pb[2];
}

/**
 * A lead always ends in exactly one period: trailing commas, periods, colons
 * and semicolons give way to it. A question or exclamation mark stays.
 */
function normalizeLead(raw: string): string {
  const trimmed = raw.trim();
  // A backward scan instead of `/[.,:;]+$/`, which retries every start
  // position and goes quadratic on a long punctuation run mid-text.
  let end = trimmed.length;
  while (end > 0 && TRAILING_PUNCTUATION.includes(trimmed[end - 1])) end--;
  const text = trimmed.slice(0, end).trimEnd();
  return text.endsWith('?') || text.endsWith('!') ? text : `${text}.`;
}

function toItem(lines: string[]): ReleaseItem {
  const joined = lines.join(' ');
  const m = LEAD_RE.exec(joined);
  return {
    lead: m ? normalizeLead(m[1]) : null,
    text: joined.replaceAll('**', ''),
  };
}

/** Where the parser is inside one release. */
interface Cursor {
  release: Release;
  /** The open group; null before the first `###` and under one that is not kept. */
  group: ReleaseGroup | null;
  inPreamble: boolean;
  paragraph: string[];
  item: string[] | null;
}

/** Closes the open preamble paragraph and the open bullet. */
function flush(cur: Cursor | null): void {
  if (!cur) return;
  if (cur.paragraph.length > 0) cur.release.preamble.push(cur.paragraph.join(' ').replaceAll('**', ''));
  cur.paragraph = [];
  // A bullet under a group that is not kept has nowhere to go and is dropped.
  if (cur.group && cur.item) cur.group.items.push(toItem(cur.item));
  cur.item = null;
}

/**
 * Releases from 0.15.0 on, in file order (newest first). `[Unreleased]`, older
 * entries, and groups outside the six Keep a Changelog names are left out.
 */
export function parseChangelog(md: string): Release[] {
  const releases: Release[] = [];
  let cur: Cursor | null = null;

  for (const rawLine of md.split(/\r?\n/)) {
    const line = rawLine.trimEnd();

    const heading = HEADING_RE.exec(line);
    if (heading) {
      flush(cur);
      cur = null;
      const version = heading[1];
      if (isVersion(version) && compareVersions(version, FIRST_PROSE_VERSION) >= 0) {
        const release: Release = { version, date: heading[2] ?? null, preamble: [], groups: [] };
        releases.push(release);
        cur = { release, group: null, inPreamble: true, paragraph: [], item: null };
      }
      continue;
    }
    if (!cur) continue;

    const groupHeading = GROUP_RE.exec(line);
    if (groupHeading) {
      flush(cur);
      cur.inPreamble = false;
      cur.group = null;
      const name = groupHeading[1].trim();
      if (GROUP_NAMES.includes(name)) {
        cur.group = { name: name as GroupName, items: [] };
        cur.release.groups.push(cur.group);
      }
      continue;
    }

    if (cur.inPreamble) {
      if (line === '') flush(cur);
      else cur.paragraph.push(line.trim());
    } else if (line.startsWith('- ')) {
      flush(cur);
      cur.item = [line.slice(2).trim()];
    } else if (cur.item && line.startsWith(' ')) {
      // A wrapped line, or a nested bullet, belongs to the bullet above it.
      const text = line.trim();
      cur.item.push(text.startsWith('- ') ? text.slice(2) : text);
    }
  }
  flush(cur);

  for (const r of releases) r.groups = r.groups.filter((g) => g.items.length > 0);
  return releases;
}

/** Releases with `from < version <= to`, newest first. Throws on a malformed bound. */
export function releasesBetween(releases: readonly Release[], from: string, to: string): Release[] {
  return releases
    .filter((r) => compareVersions(r.version, from) > 0 && compareVersions(r.version, to) <= 0)
    .sort((a, b) => compareVersions(b.version, a.version));
}

/** "1 fix", "3 fixes" when a release only fixes things; otherwise "1 change", "5 changes". */
export function summarizeRelease(release: Release): string {
  let total = 0;
  let fixes = 0;
  for (const g of release.groups) {
    total += g.items.length;
    if (g.name === 'Fixed') fixes += g.items.length;
  }
  if (total === 0) return 'no changes';
  if (fixes === total) return total === 1 ? '1 fix' : `${total} fixes`;
  return total === 1 ? '1 change' : `${total} changes`;
}
