// X30 §5.2: an Agent Read Log row as Activity shows it — its result in words,
// and what Open as query (or History's Load) may fill a tab with.
import { describe, expect, it } from 'vitest';
import { Decimal128, Long, ObjectId } from 'bson';
import {
  callMatches,
  endReasonWords,
  reachedConnections,
  canOpenAsQuery,
  findSeedPayload,
  isRefusedRow,
  outcomeWords,
  querySeed,
  requestText,
  resultText,
  shortId,
  targetText,
} from '../../src/features/agents/activityRow';
import { hydrateFindPayload } from '../../src/pages/Workspace/legacyBuilder';
import { compileFindOptions, emptyBuilder } from '../../src/pages/Workspace/builder';
import { ejsonParse, ejsonStringify } from '../../src/utils/ejson';
import { callRow } from '../helpers/agentProposalFixture';

const req = (args: Record<string, unknown>) =>
  ejsonStringify({ connectionId: 'c-shop', database: 'shop', collection: 'orders', ...args });

describe('result text', () => {
  it('reads docs and time for an ok call, one doc singular', () => {
    expect(resultText(callRow())).toBe('50 docs · 38 ms');
    expect(resultText(callRow({ docCount: 1, durationMs: 2 }))).toBe('1 doc · 2 ms');
  });

  it('reads a cut result by its bytes', () => {
    expect(resultText(callRow({ truncated: true, bytes: 1_048_576 }))).toMatch(/^truncated · 1(\.0)? ?MB$/);
  });

  it('reads a refusal in words', () => {
    expect(resultText(callRow({ outcome: 'NOT_OPEN' }))).toBe('refused · not open');
    expect(resultText(callRow({ outcome: 'JS_NOT_ALLOWED' }))).toBe('refused · server-side JavaScript');
    // A refused call is refused even when its counters say otherwise.
    expect(resultText(callRow({ outcome: 'TIMEOUT', truncated: true }))).toBe('refused · timed out');
  });

  it('reads a paused call as asking the user to open its Connection', () => {
    expect(resultText(callRow({ outcome: 'INPUT_REQUIRED' }))).toBe('asked you to open Shop (prod)');
    expect(resultText(callRow({ outcome: 'INPUT_REQUIRED', connectionName: null }))).toBe('asked you to open the Connection');
  });

  it('puts every refusal code in words and leaves an unknown code as it is', () => {
    const words: Record<string, string> = {
      NOT_SHARED: 'not shared',
      NOT_OPEN: 'not open',
      ACCESS_OFF: 'Agent Access off',
      NAMESPACE_DENIED: 'database or collection not allowed',
      STAGE_NOT_ALLOWED: 'stage not allowed',
      JS_NOT_ALLOWED: 'server-side JavaScript',
      INVALID_INPUT: 'invalid input',
      BUSY: 'busy',
      TIMEOUT: 'timed out',
      CANCELLED: 'cancelled',
      DB_ERROR: 'database error',
      PROPOSAL_DECLINED: 'pair declined',
      ALREADY_CONFIGURED: 'already configured',
      PROPOSAL_LIMIT: 'too many open Proposals',
    };
    for (const [code, text] of Object.entries(words)) expect(outcomeWords(code)).toBe(text);
    expect(outcomeWords('SOMETHING_NEW')).toBe('SOMETHING_NEW');
    // Inherited keys are not codes.
    expect(outcomeWords('toString')).toBe('toString');
  });

  it('classes refused rows as X27 §16.5 does', () => {
    expect(isRefusedRow({ outcome: 'ok' })).toBe(false);
    expect(isRefusedRow({ outcome: 'INPUT_REQUIRED' })).toBe(false);
    expect(isRefusedRow({ outcome: 'NOT_OPEN' })).toBe(true);
  });

  it('names the target as database.collection, else what it has', () => {
    expect(targetText(callRow())).toBe('shop.orders');
    expect(targetText(callRow({ collection: null }))).toBe('shop');
    expect(targetText(callRow({ database: null }))).toBe('orders');
    expect(targetText(callRow({ database: null, collection: null }))).toBe('Shop (prod)');
    expect(targetText(callRow({ database: null, collection: null, connectionName: null }))).toBe('');
  });

  it('shortens a session id', () => {
    expect(shortId('0123456789abcdef')).toBe('01234567');
    expect(shortId(null)).toBe('');
    expect(shortId(undefined)).toBe('');
  });
});

describe('requestText', () => {
  it('indents the request and keeps a big number as written', () => {
    expect(requestText(callRow({ request: '{"filter":{"n":9007199254740993}}' }))).toBe('{\n  "filter": {\n    "n": 9007199254740993\n  }\n}');
  });

  it('shows text that is not JSON as stored, and nothing when none was stored', () => {
    expect(requestText(callRow({ request: 'not json' }))).toBe('not json');
    expect(requestText(callRow({ request: null }))).toBeNull();
  });
});

describe('querySeed', () => {
  it('seeds a find with its filter, sort and projection as Filter Bar text', () => {
    const seed = querySeed(callRow({ request: req({ filter: { status: 'shipped' }, sort: { at: -1 }, projection: { _id: 0 }, limit: 5 }) }));
    expect(seed).toEqual({
      kind: 'find',
      connectionId: 'c-shop',
      database: 'shop',
      collection: 'orders',
      queryRaw: '{"status":"shipped"}',
      sort: '{"at":-1}',
      projectionRaw: '{"_id":0}',
    });
  });

  it('seeds an empty filter and blank sort and projection when the Agent sent none', () => {
    expect(querySeed(callRow({ request: req({}) }))).toMatchObject({ queryRaw: '{}', sort: '', projectionRaw: '' });
  });

  it('seeds a count with its filter only', () => {
    const seed = querySeed(callRow({ tool: 'count', request: req({ filter: { a: 1 }, sort: { b: 1 }, projection: { c: 1 } }) }));
    expect(seed).toMatchObject({ kind: 'find', queryRaw: '{"a":1}', sort: '', projectionRaw: '' });
  });

  it('seeds an aggregate with one stage per pipeline entry, enabled, numbered from one', () => {
    const seed = querySeed(callRow({ tool: 'aggregate', request: req({ pipeline: [{ $match: { a: 1 } }, { $limit: 5 }] }) }));
    expect(seed).toEqual({
      kind: 'aggregate',
      connectionId: 'c-shop',
      database: 'shop',
      collection: 'orders',
      stages: [
        { id: 1, op: '$match', body: '{"a":1}', enabled: true },
        { id: 2, op: '$limit', body: '5', enabled: true },
      ],
    });
  });

  it('offers nothing for a refused, paused, or cut call, or another tool', () => {
    expect(querySeed(callRow({ outcome: 'NOT_OPEN' }))).toBeNull();
    expect(querySeed(callRow({ outcome: 'INPUT_REQUIRED' }))).toBeNull();
    expect(querySeed(callRow({ requestTruncated: true }))).toBeNull();
    expect(querySeed(callRow({ request: null }))).toBeNull();
    for (const tool of ['explain_find', 'collection_schema', 'list_indexes', 'propose_reference_rule']) {
      expect(canOpenAsQuery(callRow({ tool }))).toBe(false);
    }
    expect(canOpenAsQuery(callRow())).toBe(true);
    expect(canOpenAsQuery(callRow({ tool: 'count' }))).toBe(true);
    expect(canOpenAsQuery(callRow({ tool: 'aggregate', request: req({ pipeline: [] }) }))).toBe(true);
  });

  it('offers nothing when the row has no Connection, database or collection', () => {
    expect(querySeed(callRow({ connectionId: null }))).toBeNull();
    expect(querySeed(callRow({ database: null }))).toBeNull();
    expect(querySeed(callRow({ collection: null }))).toBeNull();
  });

  it('offers nothing for a request that does not parse into the tool’s shape', () => {
    expect(querySeed(callRow({ request: 'not json' }))).toBeNull();
    expect(querySeed(callRow({ request: '[1,2]' }))).toBeNull();
    expect(querySeed(callRow({ request: '"text"' }))).toBeNull();
    expect(querySeed(callRow({ request: req({ filter: [1] }) }))).toBeNull();
    expect(querySeed(callRow({ request: req({ filter: 'x' }) }))).toBeNull();
    expect(querySeed(callRow({ request: req({ sort: 1 }) }))).toBeNull();
    expect(querySeed(callRow({ request: req({ projection: [] }) }))).toBeNull();
    // The filter must be a plain document, not a BSON value.
    expect(querySeed(callRow({ request: req({ filter: new ObjectId('65a1b2c3d4e5f60718293a4b') }) }))).toBeNull();
    expect(querySeed(callRow({ tool: 'aggregate', request: req({}) }))).toBeNull();
    expect(querySeed(callRow({ tool: 'aggregate', request: req({ pipeline: { $match: {} } }) }))).toBeNull();
    expect(querySeed(callRow({ tool: 'aggregate', request: req({ pipeline: [{ $match: {}, $limit: 1 }] }) }))).toBeNull();
    expect(querySeed(callRow({ tool: 'aggregate', request: req({ pipeline: [{}] }) }))).toBeNull();
    expect(querySeed(callRow({ tool: 'aggregate', request: req({ pipeline: [5] }) }))).toBeNull();
  });

  it('never seeds a pipeline that writes', () => {
    for (const op of ['$out', '$merge']) {
      expect(querySeed(callRow({ tool: 'aggregate', request: req({ pipeline: [{ $match: {} }, { [op]: 'x' }] }) }))).toBeNull();
    }
  });

  it('reads only the request’s own keys', () => {
    const request = '{"connectionId":"c","database":"shop","collection":"orders","__proto__":{"filter":{"evil":1}}}';
    expect(querySeed(callRow({ request }))).toMatchObject({ queryRaw: '{}' });
    const agg = '{"__proto__":{"pipeline":[{"$match":{}}]}}';
    expect(querySeed(callRow({ tool: 'aggregate', request: agg }))).toBeNull();
  });
});

describe('the seed loads into the tab the runner then sends unchanged', () => {
  it('keeps ObjectId, Date, a Long past 2^53 and a Decimal128 through hydrate and compile', () => {
    const filter = {
      _id: new ObjectId('65a1b2c3d4e5f60718293a4b'),
      at: { $gte: new Date('2026-01-02T03:04:05.678Z') },
      big: Long.fromString('9007199254740993'),
      price: Decimal128.fromString('19.99'),
      n: 7,
    };
    const sort = { at: -1, _id: 1 };
    const projection = { _id: 0, at: 1 };
    const seed = querySeed(callRow({ request: req({ filter, sort, projection }) }));
    expect(seed?.kind).toBe('find');
    if (seed?.kind !== 'find') return;
    const patch = hydrateFindPayload(findSeedPayload(seed), { ...emptyBuilder(), limit: '20', collation: '{"locale":"fr"}' });
    // The runner sends `queryRaw` as the filter, and the compiled sort and
    // projection; compared as the canonical EJSON main receives.
    const wire = (text: string) => ejsonStringify(ejsonParse(text));
    expect(wire(patch.queryRaw)).toBe(ejsonStringify(filter));
    const compiled = compileFindOptions(patch.builder);
    expect(wire(compiled.sort!)).toBe(ejsonStringify(sort));
    expect(wire(compiled.projection!)).toBe(ejsonStringify(projection));
    // Nothing else of the tab's query is kept: the Agent sent nothing else.
    expect(compiled.limit).toBeNull();
    expect(compiled.collation).toBeUndefined();
  });

  it('compiles a count’s seed to no sort and no projection', () => {
    const seed = querySeed(callRow({ tool: 'count', request: req({}) }));
    if (seed?.kind !== 'find') throw new Error('expected a find seed');
    const patch = hydrateFindPayload(findSeedPayload(seed), { ...emptyBuilder(), sort: '{"x":1}', projectionRaw: '{"y":1}' });
    expect(patch.queryRaw).toBe('{}');
    const compiled = compileFindOptions(patch.builder);
    expect(compiled.sort).toBeUndefined();
    expect(compiled.projection).toBeUndefined();
  });

  it('writes the payload as a saved find with a blank builder around the seed', () => {
    expect(
      findSeedPayload({ kind: 'find', connectionId: 'c', database: 'd', collection: 'e', queryRaw: '{"a":1}', sort: '{"b":1}', projectionRaw: '{"c":1}' }),
    ).toEqual({
      kind: 'find',
      queryRaw: '{"a":1}',
      builder: { conditions: [], logic: 'AND', sort: '{"b":1}', limit: '', projection: [], projectionRaw: '{"c":1}' },
    });
  });
});

describe('callMatches', () => {
  const call = callRow({ sessionId: 's1', tokenId: 't1', connectionId: 'c-shop', database: 'shop', collection: 'orders', tool: 'find' });

  it('matches every field the filter names, and ignores the ones it leaves out', () => {
    expect(callMatches(call, { outcome: 'all' })).toBe(true);
    expect(callMatches(call, { outcome: 'all', sessionId: 's1', tokenId: 't1', connectionId: 'c-shop', database: 'shop', collection: 'orders', tool: 'find' })).toBe(true);
    expect(callMatches(call, { outcome: 'all', sessionId: 's2' })).toBe(false);
    expect(callMatches(call, { outcome: 'all', tokenId: 't2' })).toBe(false);
    expect(callMatches(call, { outcome: 'all', connectionId: 'c2' })).toBe(false);
    expect(callMatches(call, { outcome: 'all', database: 'crm' })).toBe(false);
    expect(callMatches(call, { outcome: 'all', collection: 'customers' })).toBe(false);
    expect(callMatches(call, { outcome: 'all', tool: 'count' })).toBe(false);
  });

  it('filters by outcome as main does: refused is neither ok nor a paused call', () => {
    const refused = callRow({ outcome: 'NOT_OPEN' });
    const paused = callRow({ outcome: 'INPUT_REQUIRED' });
    expect(callMatches(call, { outcome: 'ok' })).toBe(true);
    expect(callMatches(refused, { outcome: 'ok' })).toBe(false);
    expect(callMatches(paused, { outcome: 'ok' })).toBe(false);
    expect(callMatches(refused, { outcome: 'refused' })).toBe(true);
    expect(callMatches(call, { outcome: 'refused' })).toBe(false);
    expect(callMatches(paused, { outcome: 'refused' })).toBe(false);
    expect(callMatches(paused, { outcome: 'all' })).toBe(true);
  });
});

describe('reachedConnections', () => {
  it('reads a Connection reached once as reached, whatever else was refused on it', () => {
    expect(
      reachedConnections([
        callRow({ connectionId: 'a', connectionName: 'Local', outcome: 'NOT_OPEN', ts: '2026-11-27T10:00:00.000Z' }),
        callRow({ connectionId: 'a', connectionName: 'Local', outcome: 'ok', ts: '2026-11-27T09:00:00.000Z' }),
      ]),
    ).toEqual([{ connectionId: 'a', label: 'Local', tone: 'ok' }]);
  });

  it('reads one only refused by its newest refusal, in words', () => {
    expect(
      reachedConnections([
        callRow({ connectionId: 'b', connectionName: 'Shop (prod)', outcome: 'BUSY', ts: '2026-11-27T09:00:00.000Z' }),
        callRow({ connectionId: 'b', connectionName: 'Shop (prod)', outcome: 'NOT_OPEN', ts: '2026-11-27T10:00:00.000Z' }),
        callRow({ connectionId: 'b', connectionName: 'Shop (prod)', outcome: 'TIMEOUT', ts: '2026-11-27T08:00:00.000Z' }),
      ]),
    ).toEqual([{ connectionId: 'b', label: 'Shop (prod) · refused, not open', tone: 'warn' }]);
  });

  it('keeps the first of two refusals at the same instant, the newer in a newest-first list', () => {
    expect(
      reachedConnections([
        callRow({ connectionId: 'b', connectionName: 'Shop (prod)', outcome: 'NOT_OPEN', ts: '2026-11-27T10:00:00.000Z' }),
        callRow({ connectionId: 'b', connectionName: 'Shop (prod)', outcome: 'BUSY', ts: '2026-11-27T10:00:00.000Z' }),
      ]),
    ).toEqual([{ connectionId: 'b', label: 'Shop (prod) · refused, not open', tone: 'warn' }]);
  });

  it('reads one only asked about as asked to open, names a nameless one, skips calls with no Connection, sorts by label', () => {
    expect(
      reachedConnections([
        callRow({ connectionId: 'z', connectionName: 'Zeta', outcome: 'ok' }),
        callRow({ connectionId: 'c', connectionName: 'Archive', outcome: 'INPUT_REQUIRED' }),
        callRow({ connectionId: 'n', connectionName: null, outcome: 'ok' }),
        callRow({ connectionId: null, connectionName: 'none', outcome: 'ok' }),
      ]),
    ).toEqual([
      { connectionId: 'c', label: 'Archive · asked to open', tone: 'warn' },
      { connectionId: 'n', label: 'Connection', tone: 'ok' },
      { connectionId: 'z', label: 'Zeta', tone: 'ok' },
    ]);
  });
});

describe('endReasonWords', () => {
  it('says why a session ended', () => {
    expect(endReasonWords('client-closed')).toBe('the client closed it');
    expect(endReasonWords('user-ended')).toBe('you ended it');
    expect(endReasonWords('token-revoked')).toBe('its token was revoked');
    expect(endReasonWords('access-off')).toBe('Agent Access was turned off');
    expect(endReasonWords('app-quit')).toBe("L'Atelier quit");
    expect(endReasonWords('unknown')).toBe('reason not known');
    expect(endReasonWords(null)).toBe('reason not known');
  });
});
