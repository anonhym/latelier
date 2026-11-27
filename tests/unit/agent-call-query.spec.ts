import { describe, it, expect } from 'vitest';
import { callsFilter, isTruncatedMarker, REFUSED_OUTCOME_SQL, sessionsFilter } from '../../electron/agent/callQuery';

describe('callsFilter', () => {
  it('has no WHERE for every outcome and no filter', () => {
    expect(callsFilter({ outcome: 'all', limit: 50 })).toEqual({ where: '', params: {} });
  });

  it('binds each named filter to its column, by name', () => {
    expect(
      callsFilter({
        outcome: 'all',
        limit: 10,
        sessionId: 's',
        tokenId: 't',
        connectionId: 'c',
        database: 'd',
        collection: 'k',
        tool: 'find',
      }),
    ).toEqual({
      where:
        'WHERE session_id = @sessionId AND token_id = @tokenId AND connection_id = @connectionId AND database = @database AND collection = @collection AND tool = @tool',
      params: { sessionId: 's', tokenId: 't', connectionId: 'c', database: 'd', collection: 'k', tool: 'find' },
    });
  });

  it('keeps an empty-string filter: it names a value, not an absence', () => {
    expect(callsFilter({ outcome: 'all', limit: 1, database: '' })).toEqual({ where: 'WHERE database = @database', params: { database: '' } });
  });

  it('maps ok to the ok outcome only', () => {
    expect(callsFilter({ outcome: 'ok', limit: 1 }).where).toBe("WHERE outcome = 'ok'");
  });

  it('maps refused to every outcome but ok and the asking round', () => {
    expect(REFUSED_OUTCOME_SQL).toBe("outcome NOT IN ('ok', 'INPUT_REQUIRED')");
    expect(callsFilter({ outcome: 'refused', limit: 1 }).where).toBe(`WHERE ${REFUSED_OUTCOME_SQL}`);
  });

  it('pages strictly after the last row on (ts, id)', () => {
    expect(callsFilter({ outcome: 'all', limit: 1, tool: 'count', before: { ts: '2026-01-01T00:00:00.000Z', id: 'z' } })).toEqual({
      where: 'WHERE tool = @tool AND (ts < @beforeTs OR (ts = @beforeTs AND id < @beforeId))',
      params: { tool: 'count', beforeTs: '2026-01-01T00:00:00.000Z', beforeId: 'z' },
    });
  });
});

describe('sessionsFilter', () => {
  it('lists only live sessions unless ended ones are asked for', () => {
    expect(sessionsFilter({ includeEnded: false, limit: 5 })).toEqual({ where: 'WHERE ended_at IS NULL', params: {} });
    expect(sessionsFilter({ includeEnded: true, limit: 5 })).toEqual({ where: '', params: {} });
  });

  it('filters by token and pages strictly after the last row on (started_at, id)', () => {
    expect(sessionsFilter({ tokenId: 't', includeEnded: true, limit: 5, before: { startedAt: 'S', id: 'i' } })).toEqual({
      where: 'WHERE token_id = @tokenId AND (started_at < @beforeStartedAt OR (started_at = @beforeStartedAt AND id < @beforeId))',
      params: { tokenId: 't', beforeStartedAt: 'S', beforeId: 'i' },
    });
  });
});

describe('isTruncatedMarker', () => {
  const marker = (o: unknown) => JSON.stringify(o);

  it('recognises the marker capRequestJson writes', () => {
    expect(isTruncatedMarker(marker({ truncated: true, bytes: 20_000, head: '{"filter"' }), 16_384)).toBe(true);
  });

  it('needs the size to be over the cap', () => {
    expect(isTruncatedMarker(marker({ truncated: true, bytes: 16_384, head: '' }), 16_384)).toBe(false);
    expect(isTruncatedMarker(marker({ truncated: true, bytes: 16_385, head: '' }), 16_384)).toBe(true);
  });

  it.each([
    ['an Agent that sends {"truncated":true} itself', { truncated: true }],
    ['a fourth key', { truncated: true, bytes: 20_000, head: '', more: 1 }],
    ['a false flag', { truncated: false, bytes: 20_000, head: '' }],
    ['a string flag', { truncated: 'true', bytes: 20_000, head: '' }],
    ['a string size', { truncated: true, bytes: '20000', head: '' }],
    ['a non-string head', { truncated: true, bytes: 20_000, head: 5 }],
    ['a missing head', { truncated: true, bytes: 20_000, other: '' }],
    ['a missing size', { truncated: true, head: '', other: 1 }],
  ])('refuses %s', (_name, value) => {
    expect(isTruncatedMarker(marker(value), 16_384)).toBe(false);
  });

  it('refuses text that does not open like the marker, and text that is not JSON', () => {
    expect(isTruncatedMarker(marker({ bytes: 20_000, truncated: true, head: '' }), 16_384)).toBe(false);
    expect(isTruncatedMarker(' {"truncated":true,"bytes":20000,"head":""}', 16_384)).toBe(false);
    expect(isTruncatedMarker('{"truncated":true,"bytes":20000,"head":', 16_384)).toBe(false);
    expect(isTruncatedMarker('{"filter":{}}', 16_384)).toBe(false);
    // Opens like the marker, but a repeated key leaves the flag false.
    expect(isTruncatedMarker('{"truncated":true,"truncated":false,"bytes":20000,"head":""}', 16_384)).toBe(false);
  });
});
