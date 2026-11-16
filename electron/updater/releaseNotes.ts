/**
 * Release highlights for the update popover (X22 §3). The input is HTML that
 * electron-updater downloaded from a GitHub release, so it is scanned with
 * indexOf over slices bounded by the next list item rather than with
 * backtracking regexes: the work stays linear in the input size.
 */

export interface ReleaseHighlights {
  highlights: string[];
  changeCount: number | null;
}

type ReleaseNotes = string | Array<{ version: string; note: string | null }> | null | undefined;

const MAX_HIGHLIGHTS = 3;

// Lowercases ASCII only. `toLowerCase()` can change the length of a string
// (some Unicode letters expand), which would put indices found in the copy out
// of step with the original.
function asciiLower(s: string): string {
  return s.replace(/[A-Z]/g, (c) => String.fromCharCode(c.charCodeAt(0) + 32));
}

function isTagBoundary(ch: string | undefined): boolean {
  return ch === '>' || ch === ' ' || ch === '\t' || ch === '\n' || ch === '\r' || ch === '/';
}

/** Offsets of every `<li ...>` opening tag; `<link>` and friends are not list items. */
function listItemStarts(lower: string): number[] {
  const starts: number[] = [];
  let from = 0;
  for (;;) {
    const at = lower.indexOf('<li', from);
    if (at === -1) return starts;
    if (isTagBoundary(lower[at + 3])) starts.push(at);
    from = at + 3;
  }
}

function stripTags(html: string): string {
  let out = '';
  let inTag = false;
  for (const ch of html) {
    if (ch === '<') inTag = true;
    else if (ch === '>' && inTag) inTag = false;
    else if (!inTag) out += ch;
  }
  return out;
}

// One pass, so `&amp;lt;` decodes to the text `&lt;`, not to `<`.
function decodeEntities(text: string): string {
  return text.replace(/&(amp|lt|gt|quot|#39);/g, (_m, name: string) => {
    switch (name) {
      case 'amp':
        return '&';
      case 'lt':
        return '<';
      case 'gt':
        return '>';
      case 'quot':
        return '"';
      default:
        return "'";
    }
  });
}

function startsWithAt(s: string, needle: string, at: number): boolean {
  return s.startsWith(needle, at);
}

/** The text of an item's leading `<strong>`, or null when the item does not open with one. */
function leadingStrong(item: string, lowerItem: string): string | null {
  // Skip the `<li ...>` tag itself, then whitespace and an optional `<p>`.
  let pos = lowerItem.indexOf('>') + 1;
  const skipSpace = (): void => {
    // `charAt` is '' past the end, which is not whitespace, so this stops there.
    while (/\s/.test(lowerItem.charAt(pos))) pos++;
  };
  skipSpace();
  if (startsWithAt(lowerItem, '<p>', pos)) {
    pos += 3;
    skipSpace();
  }
  if (!startsWithAt(lowerItem, '<strong', pos) || !isTagBoundary(lowerItem[pos + 7])) return null;
  // An unterminated tag leaves `open` at -1; the slice then starts inside the
  // `<li>` tag and strips to nothing, which `toHighlight` drops.
  const open = lowerItem.indexOf('>', pos);
  const close = lowerItem.indexOf('</strong', open);
  if (close === -1) return null;
  return item.slice(open + 1, close);
}

function toHighlight(raw: string): string | null {
  const text = decodeEntities(stripTags(raw)).trim();
  const trimmed = text.endsWith(',') || text.endsWith('.') ? text.slice(0, -1).trimEnd() : text;
  return trimmed === '' ? null : `${trimmed}.`;
}

function notesToHtml(notes: ReleaseNotes, version: string | undefined): string {
  if (notes === null || notes === undefined) return '';
  if (typeof notes === 'string') return notes;
  const matching = notes.filter((n) => n.version === version);
  const chosen = matching.length > 0 ? matching : notes;
  return chosen.map((n) => n.note ?? '').join('\n');
}

export function extractHighlights(notes: ReleaseNotes, version?: string): ReleaseHighlights {
  const html = notesToHtml(notes, version);
  const lower = asciiLower(html);
  const starts = listItemStarts(lower);
  if (starts.length === 0) return { highlights: [], changeCount: null };

  const highlights: string[] = [];
  for (let i = 0; i < starts.length && highlights.length < MAX_HIGHLIGHTS; i++) {
    // The last item has no successor: `slice` takes an undefined end as the end of the string.
    const end = starts[i + 1];
    const raw = leadingStrong(html.slice(starts[i], end), lower.slice(starts[i], end));
    const highlight = raw === null ? null : toHighlight(raw);
    if (highlight !== null) highlights.push(highlight);
  }
  return { highlights, changeCount: starts.length };
}
