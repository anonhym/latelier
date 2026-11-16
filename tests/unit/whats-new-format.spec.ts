import { describe, it, expect } from 'vitest';
import { formatReleaseDate, splitLead, whatsNewSubtitle } from '../../src/features/updates/whatsNewFormat';

describe('whatsNewFormat', () => {
  it('formats an ISO date as day, short month, year', () => {
    expect(formatReleaseDate('2026-11-13')).toBe('13 Nov 2026');
    expect(formatReleaseDate('2026-01-05')).toBe('5 Jan 2026');
  });

  it('leaves a date it cannot read as it was', () => {
    expect(formatReleaseDate('soon')).toBe('soon');
    expect(formatReleaseDate('2026-13-01')).toBe('2026-13-01');
  });

  it('words the subtitle for an update and for a reread', () => {
    expect(whatsNewSubtitle('0.19.0', '0.20.0', 2)).toBe('Updated from 0.19.0 to 0.20.0 · 2 releases');
    expect(whatsNewSubtitle('0.19.0', '0.20.0', 1)).toBe('Updated from 0.19.0 to 0.20.0 · 1 release');
    expect(whatsNewSubtitle(null, '0.20.0', 1)).toBe('Version 0.20.0');
  });

  it('splits the bold lead off an item, and copes with a lead the text no longer starts with', () => {
    expect(splitLead({ lead: 'Big news.', text: 'Big news. Details.' })).toEqual({ strong: 'Big news', rest: '. Details.' });
    expect(splitLead({ lead: 'Why?', text: 'Why? Because.' })).toEqual({ strong: 'Why?', rest: ' Because.' });
    expect(splitLead({ lead: 'Other.', text: 'Different' })).toEqual({ strong: '', rest: 'Different' });
    expect(splitLead({ lead: null, text: 'Plain' })).toEqual({ strong: '', rest: 'Plain' });
  });
});
