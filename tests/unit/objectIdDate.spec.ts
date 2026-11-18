import { describe, it, expect } from 'vitest';
import { formatLocalDateTime, objectIdTimestamp } from '../../src/pages/Workspace/objectIdDate';

describe('objectIdTimestamp', () => {
  it('reads the first four bytes as seconds since the epoch', () => {
    expect(objectIdTimestamp('507f1f77bcf86cd799439011')?.toISOString()).toBe('2012-10-17T21:13:27.000Z');
  });

  it('accepts upper-case hex', () => {
    expect(objectIdTimestamp('507F1F77BCF86CD799439011')?.getTime()).toBe(0x507f1f77 * 1000);
  });

  it('is the epoch for a zero timestamp and the 32-bit maximum for ffffffff', () => {
    expect(objectIdTimestamp('000000000000000000000000')?.getTime()).toBe(0);
    expect(objectIdTimestamp('ffffffffffffffffffffffff')?.getTime()).toBe(0xffffffff * 1000);
  });

  it.each([
    ['empty', ''],
    ['too short', '507f1f77bcf86cd79943901'],
    ['too long', '507f1f77bcf86cd7994390111'],
    ['not hex', '507f1f77bcf86cd79943901g'],
    ['padded', ' 507f1f77bcf86cd799439011'],
    ['newline-terminated', '507f1f77bcf86cd799439011\n'],
  ])('is null for %s', (_label, text) => {
    expect(objectIdTimestamp(text)).toBeNull();
  });
});

describe('formatLocalDateTime', () => {
  const date = new Date('2026-11-18T13:01:24Z');

  it('formats in UTC', () => {
    expect(formatLocalDateTime(date, 'UTC')).toBe('2026-11-18 13:01:24 UTC');
  });

  it('formats in a named zone with its short name (standard time)', () => {
    expect(formatLocalDateTime(date, 'America/Toronto')).toBe('2026-11-18 08:01:24 EST');
  });

  it('uses daylight time when the zone is on it', () => {
    expect(formatLocalDateTime(new Date('2026-07-18T13:01:24Z'), 'America/Toronto')).toBe('2026-07-18 09:01:24 EDT');
  });

  it('crosses the date line with the zone', () => {
    expect(formatLocalDateTime(new Date('2026-11-18T03:00:00Z'), 'America/Toronto')).toBe('2026-11-17 22:00:00 EST');
  });

  it('shows midnight as 00, not 24', () => {
    expect(formatLocalDateTime(new Date('2026-11-18T00:00:05Z'), 'UTC')).toBe('2026-11-18 00:00:05 UTC');
  });

  it('defaults to the machine zone', () => {
    const local = Intl.DateTimeFormat().resolvedOptions().timeZone;
    expect(formatLocalDateTime(date)).toBe(formatLocalDateTime(date, local));
  });

  it('throws on an unknown zone instead of guessing', () => {
    expect(() => formatLocalDateTime(date, 'Mars/Olympus')).toThrow(RangeError);
  });
});
