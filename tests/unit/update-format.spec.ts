import { describe, it, expect } from 'vitest';
import {
  checkOutcome,
  checkedLine,
  clampPercent,
  formatDownloaded,
  lastCheckedAt,
  offReasonText,
  paletteHint,
  relativeAgo,
  statusCard,
  archLabel,
  identityLine,
  platformLabel,
  CHANGELOG_URL,
  RELEASES_URL,
} from '../../src/features/updates/updateFormat';
import type { UpdateState } from '../../shared/types';

const MIN = 60_000;
const NOW = Date.UTC(2026, 10, 16, 12, 0, 0);
const ago = (ms: number) => new Date(NOW - ms).toISOString();

const ready: UpdateState = {
  status: 'ready',
  version: '0.20.0',
  highlights: [],
  changeCount: null,
  releaseUrl: 'https://github.com/anonhym/latelier/releases/tag/v0.20.0',
  lastCheckedAt: ago(5 * MIN),
  downloadedAt: ago(2 * MIN),
};

describe('page links', () => {
  it('point at this project on GitHub', () => {
    expect(RELEASES_URL).toBe('https://github.com/anonhym/latelier/releases');
    expect(CHANGELOG_URL).toBe('https://github.com/anonhym/latelier/blob/main/CHANGELOG.md');
  });
});

describe('lastCheckedAt', () => {
  it('is null before a first check and while off', () => {
    expect(lastCheckedAt({ status: 'off', reason: 'linux' })).toBeNull();
    expect(lastCheckedAt({ status: 'idle' })).toBeNull();
  });

  it('is the state’s own timestamp otherwise, null included', () => {
    expect(lastCheckedAt({ status: 'checking', lastCheckedAt: null })).toBeNull();
    expect(lastCheckedAt({ status: 'failed', message: 'x', lastCheckedAt: null })).toBeNull();
    expect(lastCheckedAt({ status: 'up-to-date', lastCheckedAt: '2026-11-16T10:00:00.000Z' })).toBe(
      '2026-11-16T10:00:00.000Z',
    );
    expect(lastCheckedAt(ready)).toBe(ready.status === 'ready' ? ready.lastCheckedAt : '');
  });
});

describe('relativeAgo', () => {
  it.each([
    [0, 'just now', 'just now'],
    [59_999, 'just now', 'just now'],
    [MIN, '1 minute ago', '1 min ago'],
    [2 * MIN, '2 minutes ago', '2 min ago'],
    [59 * MIN, '59 minutes ago', '59 min ago'],
    [60 * MIN, '1 hour ago', '1 h ago'],
    [3 * 60 * MIN, '3 hours ago', '3 h ago'],
    [23 * 60 * MIN, '23 hours ago', '23 h ago'],
    [24 * 60 * MIN, '1 day ago', '1 d ago'],
    [3 * 24 * 60 * MIN, '3 days ago', '3 d ago'],
  ])('%i ms ago reads %s / %s', (ms, long, short) => {
    expect(relativeAgo(ago(ms), NOW, 'long')).toBe(long);
    expect(relativeAgo(ago(ms), NOW, 'short')).toBe(short);
  });

  it('reads a timestamp in the future as just now', () => {
    expect(relativeAgo(new Date(NOW + 5 * MIN).toISOString(), NOW, 'long')).toBe('just now');
  });

  it('is null for a timestamp that does not parse', () => {
    expect(relativeAgo('yesterday', NOW, 'long')).toBeNull();
    expect(relativeAgo('', NOW, 'short')).toBeNull();
  });
});

describe('checkedLine and paletteHint', () => {
  it('say when the last check was', () => {
    const s: UpdateState = { status: 'up-to-date', lastCheckedAt: ago(2 * MIN) };
    expect(checkedLine(s, NOW)).toBe('Last checked 2 minutes ago · checks at launch and every 4 hours');
    expect(paletteHint(s, NOW)).toBe('last checked 2 min ago');
  });

  it('say there was no check yet for idle and for a missing or bad timestamp', () => {
    expect(checkedLine({ status: 'idle' }, NOW)).toBe('Not checked yet · checks at launch and every 4 hours');
    expect(paletteHint({ status: 'idle' }, NOW)).toBe('not checked yet');
    const bad: UpdateState = { status: 'up-to-date', lastCheckedAt: 'garbage' };
    expect(checkedLine(bad, NOW)).toContain('Not checked yet');
    expect(paletteHint(bad, NOW)).toBe('not checked yet');
  });
});

describe('offReasonText', () => {
  it('has the §5.3 copy for each reason', () => {
    expect(offReasonText('development')).toBe('Updates are off in development builds.');
    expect(offReasonText('linux')).toBe(
      "Updates aren't available on Linux yet. Download new versions from GitHub.",
    );
  });
});

describe('formatDownloaded', () => {
  const at = (y: number, mo: number, d: number, h: number, mi: number) => new Date(y, mo, d, h, mi).toISOString();
  const now = new Date(2026, 10, 16, 18, 30).getTime();

  it('says today, yesterday, or the date, with a two-digit local clock', () => {
    expect(formatDownloaded(at(2026, 10, 16, 14, 2), now)).toBe('today at 14:02');
    expect(formatDownloaded(at(2026, 10, 16, 9, 5), now)).toBe('today at 09:05');
    expect(formatDownloaded(at(2026, 10, 15, 23, 59), now)).toBe('yesterday at 23:59');
    expect(formatDownloaded(at(2026, 10, 12, 9, 30), now)).toBe('on 12 Nov 2026 at 09:30');
  });

  it('names every month', () => {
    const names = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    names.forEach((name, month) => {
      expect(formatDownloaded(at(2026, month, 1, 8, 0), new Date(2027, 5, 1).getTime())).toBe(`on 1 ${name} 2026 at 08:00`);
    });
  });

  it('is null for a timestamp that does not parse', () => {
    expect(formatDownloaded('nope', now)).toBeNull();
  });
});

describe('clampPercent', () => {
  it('rounds and clamps to 0–100, and reads a non-number as 0', () => {
    expect(clampPercent(41.6)).toBe(42);
    expect(clampPercent(-3)).toBe(0);
    expect(clampPercent(140)).toBe(100);
    expect(clampPercent(0)).toBe(0);
    expect(clampPercent(100)).toBe(100);
    expect(clampPercent(Number.NaN)).toBe(0);
    expect(clampPercent(Number.POSITIVE_INFINITY)).toBe(0);
  });
});

describe('statusCard', () => {
  const card = (s: UpdateState) => statusCard(s, '0.19.1', NOW);

  it('has no card for idle and off', () => {
    expect(card({ status: 'idle' })).toBeNull();
    expect(card({ status: 'off', reason: 'development' })).toBeNull();
  });

  it('ready: an accent card with Restart now', () => {
    const c = statusCard(ready, '0.19.1', NOW);
    expect(c).toMatchObject({
      tone: 'accent',
      title: 'Version 0.20.0 is ready to install',
      action: 'restart',
      percent: null,
      spinner: false,
    });
    // From downloadedAt (2 min ago), not lastCheckedAt (5 min ago): the clock time tells them apart.
    expect(c?.detail).toBe(`Downloaded ${formatDownloaded(ago(2 * MIN), NOW)}.`);
  });

  it('ready with an unreadable timestamp drops the detail', () => {
    expect(card({ ...(ready as Extract<UpdateState, { status: 'ready' }>), downloadedAt: 'x' })?.detail).toBeNull();
  });

  it('up to date: check icon, the current version and when', () => {
    expect(card({ status: 'up-to-date', lastCheckedAt: ago(10_000) })).toEqual({
      tone: 'neutral',
      title: "You're up to date",
      detail: '0.19.1 is the latest version. Checked just now.',
      percent: null,
      spinner: false,
      icon: 'check',
      action: null,
    });
    expect(card({ status: 'up-to-date', lastCheckedAt: ago(3 * MIN) })?.detail).toBe(
      '0.19.1 is the latest version. Checked 3 minutes ago.',
    );
    expect(card({ status: 'up-to-date', lastCheckedAt: 'x' })?.detail).toBe('0.19.1 is the latest version.');
  });

  it('checking: a spinner', () => {
    expect(card({ status: 'checking', lastCheckedAt: null })).toEqual({
      tone: 'neutral',
      title: 'Checking for updates…',
      detail: null,
      percent: null,
      spinner: true,
      icon: null,
      action: null,
    });
  });

  it('downloading: the version, a whole percent and the reassurance', () => {
    expect(card({ status: 'downloading', version: '0.20.0', percent: 41.6, lastCheckedAt: ago(MIN) })).toEqual({
      tone: 'neutral',
      title: 'Downloading 0.20.0',
      detail: "Keep working; you'll be offered a restart when it's done.",
      percent: 42,
      spinner: false,
      icon: null,
      action: null,
    });
  });

  it('failed: a warning card with the message and Try again', () => {
    expect(card({ status: 'failed', message: 'offline', lastCheckedAt: null })).toEqual({
      tone: 'warning',
      title: "Couldn't check for updates",
      detail: 'offline',
      percent: null,
      spinner: false,
      icon: 'warning',
      action: 'retry',
    });
  });
});

describe('checkOutcome', () => {
  it('has one toast per settled outcome', () => {
    expect(checkOutcome({ status: 'up-to-date', lastCheckedAt: ago(0) })).toEqual({
      kind: 'success',
      message: "You're up to date",
    });
    expect(checkOutcome({ status: 'downloading', version: '0.20.0', percent: 0, lastCheckedAt: ago(0) })).toEqual({
      kind: 'info',
      message: 'Found 0.20.0, downloading',
    });
    expect(checkOutcome(ready)).toEqual({ kind: 'success', message: 'Update ready' });
    expect(checkOutcome({ status: 'failed', message: 'offline', lastCheckedAt: null })).toEqual({
      kind: 'error',
      message: "Couldn't check for updates: offline",
    });
  });

  it('has none for a check that was already running, or for idle and off', () => {
    expect(checkOutcome({ status: 'checking', lastCheckedAt: null })).toBeNull();
    expect(checkOutcome({ status: 'idle' })).toBeNull();
    expect(checkOutcome({ status: 'off', reason: 'linux' })).toBeNull();
  });
});

describe('platform and architecture labels', () => {
  it('names the platforms, and passes an unknown one through', () => {
    expect(platformLabel('darwin')).toBe('macOS');
    expect(platformLabel('win32')).toBe('Windows');
    expect(platformLabel('linux')).toBe('Linux');
    expect(platformLabel('freebsd')).toBe('freebsd');
  });

  it('names the architecture by platform, and passes an unknown one through', () => {
    expect(archLabel('darwin', 'arm64')).toBe('Apple silicon');
    expect(archLabel('darwin', 'x64')).toBe('Intel');
    expect(archLabel('win32', 'arm64')).toBe('ARM64');
    expect(archLabel('linux', 'x64')).toBe('x64');
    expect(archLabel('darwin', 'ia32')).toBe('ia32');
  });

  it('builds the identity line', () => {
    expect(identityLine('0.19.1', 'darwin', 'arm64')).toBe('Version 0.19.1 · macOS · Apple silicon');
    expect(identityLine('0.19.1', 'win32', 'x64')).toBe('Version 0.19.1 · Windows · x64');
  });
});
