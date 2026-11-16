import { describe, it, expect } from 'vitest';
import { extractHighlights } from '../../electron/updater/releaseNotes';

// The shape GitHub renders a release body to: a heading per group, a list per
// heading, a bold lead then the sentence.
const GITHUB_BODY = `<h3>Changed</h3>
<ul>
<li><strong>The dark theme reads in layers.</strong> The window, panels and raised controls are distinct shades.</li>
<li><strong>Filters remember their last join,</strong> AND / OR / NOR.</li>
<li><strong>Tabs reopen where you left them</strong> after a restart.</li>
<li><strong>A fourth lead.</strong> Not shown.</li>
</ul>
<h3>Fixed</h3>
<ul>
<li>A bullet with no bold lead at all.</li>
</ul>`;

describe('extractHighlights', () => {
  it('takes the first three leading strongs and counts every list item', () => {
    expect(extractHighlights(GITHUB_BODY)).toEqual({
      highlights: [
        'The dark theme reads in layers.',
        'Filters remember their last join.',
        'Tabs reopen where you left them.',
      ],
      changeCount: 5,
    });
  });

  it('strips tags nested inside the strong and decodes the basic entities', () => {
    const html = '<ul><li><strong>Use <code>$match</code> &amp; <em>friends</em> &lt;3 &quot;q&quot; it&#39;s</strong> x</li></ul>';
    expect(extractHighlights(html).highlights).toEqual([`Use $match & friends <3 "q" it's.`]);
  });

  it('decodes in one pass, so an escaped entity stays text', () => {
    expect(extractHighlights('<li><strong>a &amp;lt; b</strong></li>').highlights).toEqual(['a &lt; b.']);
  });

  it('drops one trailing comma or period, trims, and adds a single period', () => {
    const html = [
      '<li><strong>  spaced  </strong></li>',
      '<li><strong>comma,</strong></li>',
      '<li><strong>period.</strong></li>',
    ].join('');
    expect(extractHighlights(html).highlights).toEqual(['spaced.', 'comma.', 'period.']);
  });

  it('keeps a lone trailing character it only strips once', () => {
    expect(extractHighlights('<li><strong>end..</strong></li>').highlights).toEqual(['end..']);
  });

  it('accepts li attributes, upper-case tags, a leading paragraph and whitespace before the strong', () => {
    const html = '<UL><LI class="x">\n  <P><STRONG id="a">Loud.</STRONG></P></LI></UL>';
    expect(extractHighlights(html)).toEqual({ highlights: ['Loud.'], changeCount: 1 });
  });

  it('does not treat <link> or <lines> as list items, nor a mid-item strong as a lead', () => {
    const html = '<link rel="x"><lines></lines><ul><li>text <strong>not leading</strong></li></ul>';
    expect(extractHighlights(html)).toEqual({ highlights: [], changeCount: 1 });
  });

  it('skips an item whose strong is empty or unclosed, without losing later items', () => {
    const html = '<li><strong></strong></li><li><strong>unclosed</li><li><strong>Good.</strong></li>';
    expect(extractHighlights(html)).toEqual({ highlights: ['Good.'], changeCount: 3 });
  });

  it('does not take <strongest> for a strong', () => {
    expect(extractHighlights('<li><strongest>x</strongest></li>').highlights).toEqual([]);
  });

  it('a list with no strong leads gives no highlights but still a count', () => {
    expect(extractHighlights('<ul><li>a</li><li>b</li></ul>')).toEqual({ highlights: [], changeCount: 2 });
  });

  it('a body with no list is nothing found', () => {
    expect(extractHighlights('<p>Just prose.</p>')).toEqual({ highlights: [], changeCount: null });
  });

  it.each([[''], [null], [undefined]] as const)('empty input %s is nothing found', (input) => {
    expect(extractHighlights(input)).toEqual({ highlights: [], changeCount: null });
  });

  it('joins an array of notes, treating a null note as empty', () => {
    const notes = [
      { version: '1.0.0', note: '<li><strong>Old.</strong></li>' },
      { version: '2.0.0', note: null },
      { version: '3.0.0', note: '<li><strong>New.</strong></li>' },
    ];
    expect(extractHighlights(notes)).toEqual({ highlights: ['Old.', 'New.'], changeCount: 2 });
  });

  it('uses only the note for the given version when one matches', () => {
    const notes = [
      { version: '1.0.0', note: '<li><strong>Old.</strong></li>' },
      { version: '2.0.0', note: '<li><strong>Two.</strong></li><li>x</li>' },
    ];
    expect(extractHighlights(notes, '2.0.0')).toEqual({ highlights: ['Two.'], changeCount: 2 });
  });

  it('falls back to every note when none matches the version', () => {
    const notes = [{ version: '1.0.0', note: '<li><strong>Old.</strong></li>' }];
    expect(extractHighlights(notes, '9.9.9')).toEqual({ highlights: ['Old.'], changeCount: 1 });
  });

  it('keeps indices aligned when the text holds characters whose lower-casing changes length', () => {
    const html = '<li><strong>İstanbul.</strong></li><li><strong>Two.</strong></li>';
    expect(extractHighlights(html).highlights).toEqual(['İstanbul.', 'Two.']);
  });

  it.each(['>', ' ', '\t', '\n', '\r', '/'])('accepts %j right after <li> and <strong>', (ch) => {
    const li = ch === '>' ? '<li>' : `<li${ch}x>`;
    const strong = ch === '>' ? '<strong>' : `<strong${ch}x>`;
    expect(extractHighlights(`${li}${strong}A</strong></li>`)).toEqual({ highlights: ['A.'], changeCount: 1 });
  });

  it('decodes &gt;', () => {
    expect(extractHighlights('<li><strong>a &gt; b</strong></li>').highlights).toEqual(['a > b.']);
  });

  it('skips whitespace between <p> and the strong', () => {
    expect(extractHighlights('<li><p> \n <strong>A</strong></p></li>').highlights).toEqual(['A.']);
  });

  it('does not take an item that merely contains a closing strong for a lead', () => {
    expect(extractHighlights('<li>abcdefg >hello</strong></li>')).toEqual({ highlights: [], changeCount: 1 });
  });

  it('survives an item that ends inside an unterminated strong tag', () => {
    expect(extractHighlights('<li><strong x </strong')).toEqual({ highlights: [], changeCount: 1 });
    expect(extractHighlights('<li><strong')).toEqual({ highlights: [], changeCount: 1 });
  });

  it('removes the space left before a trailing comma', () => {
    expect(extractHighlights('<li><strong>word ,</strong></li>').highlights).toEqual(['word.']);
  });

  it('keeps separate notes apart when joining, so a tag is not fused across them', () => {
    const notes = [
      { version: '1.0.0', note: '<li><strong>A' },
      { version: '2.0.0', note: 'B</strong></li>' },
    ];
    expect(extractHighlights(notes).highlights).toEqual(['A\nB.']);
  });

  it('finishes a 1 MB hostile input in linear time', () => {
    const inputs = [
      '<li><strong>'.repeat(90_000),
      '<li>'.repeat(250_000),
      `<li><strong>${'<'.repeat(1_000_000)}`,
      `<li><strong>${'a'.repeat(1_000_000)}`,
    ];
    for (const html of inputs) {
      const t0 = performance.now();
      const out = extractHighlights(html);
      expect(performance.now() - t0).toBeLessThan(1500);
      expect(out.highlights.length).toBeLessThanOrEqual(3);
    }
  });
});
