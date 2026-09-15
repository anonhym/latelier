import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  CompletionContext as RealCompletionContext,
  type CompletionContext,
  type CompletionResult,
} from '@codemirror/autocomplete';
import { EditorState } from '@codemirror/state';
import { javascript } from '@codemirror/lang-javascript';
import { ensureSyntaxTree } from '@codemirror/language';
import { mongoCompletionSource } from '../../src/components/scriptEditor/mongoCompletions';
import {
  invalidateSampleSchemaCache,
  setSampleSchemaCacheTtl,
} from '../../src/features/fieldSuggestions/sources';

vi.mock('../../src/api/atelier', () => ({
  api: {
    meta: {
      sampleSchema: vi.fn(async () => ({
        docs: [
          { name: 'alice', age: 30, address: { city: 'NYC' } },
          { name: 'bob', age: 25, address: { city: 'SF' } },
        ],
      })),
    },
  },
  isIpcError: () => false,
}));

/**
 * The source only reads `matchBefore`, `pos`, and `explicit` off
 * CompletionContext. Build the smallest stub that satisfies that surface
 * so we can exercise the four completion branches without spinning up an
 * EditorState in node.
 */
function fakeCtx(line: string, opts: { explicit?: boolean } = {}): CompletionContext {
  const pos = line.length;
  return {
    pos,
    explicit: opts.explicit ?? false,
    matchBefore(re: RegExp): { from: number; to: number; text: string } | null {
      // Mirror CodeMirror's matchBefore: anchor regex at end-of-buffer.
      const sticky = new RegExp(re.source, re.flags.includes('g') ? re.flags : re.flags + 'g');
      let match: RegExpExecArray | null = null;
      let probe: RegExpExecArray | null;
      sticky.lastIndex = 0;
      while ((probe = sticky.exec(line))) {
        if (probe.index + probe[0].length === pos) match = probe;
        if (probe.index === sticky.lastIndex) sticky.lastIndex++;
      }
      if (!match || match[0].length === 0) return null;
      return { from: match.index, to: match.index + match[0].length, text: match[0] };
    },
  } as unknown as CompletionContext;
}

function labels(result: CompletionResult | null): string[] {
  return result?.options.map((o) => o.label) ?? [];
}

describe('mongoCompletionSource', () => {
  const source = mongoCompletionSource({
    getCollections: () => ['users', 'orders', 'sessions'],
  });

  it('suggests collection names after `db.`', () => {
    const result = source(fakeCtx('db.')) as CompletionResult | null;
    expect(result).not.toBeNull();
    expect(labels(result)).toEqual(['users', 'orders', 'sessions']);
    expect(result!.from).toBe(3); // caret position; partial is empty
  });

  it('replaces the partial token after `db.us`', () => {
    const result = source(fakeCtx('db.us')) as CompletionResult | null;
    expect(result).not.toBeNull();
    expect(labels(result)).toContain('users');
    expect(result!.from).toBe(3); // start of "us"
  });

  it('skips `db.<coll>` branch when the collection list is empty', () => {
    const empty = mongoCompletionSource({ getCollections: () => [] });
    const result = empty(fakeCtx('db.')) as CompletionResult | null;
    expect(result).toBeNull();
  });

  it('suggests collection methods after `db.users.`', () => {
    const result = source(fakeCtx('db.users.')) as CompletionResult | null;
    expect(result).not.toBeNull();
    const found = labels(result);
    expect(found).toEqual(expect.arrayContaining(['find', 'findOne', 'aggregate', 'insertOne', 'updateMany']));
  });

  it('narrows methods after `db.users.fin`', () => {
    const result = source(fakeCtx('db.users.fin')) as CompletionResult | null;
    expect(result).not.toBeNull();
    // Source returns the full list — CodeMirror filters by `validFor` /
    // prefix matching on the renderer side. Our contract is just the `from`.
    expect(result!.from).toBe('db.users.'.length);
    expect(labels(result)).toContain('find');
  });

  it('suggests MQL operators after `$`', () => {
    const result = source(fakeCtx('{ $')) as CompletionResult | null;
    expect(result).not.toBeNull();
    const found = labels(result);
    expect(found).toEqual(expect.arrayContaining(['$match', '$group', '$gte', '$in', '$or']));
    expect(result!.from).toBe(2); // start of `$`
  });

  it('narrows operators after `$gr`', () => {
    const result = source(fakeCtx('$gr')) as CompletionResult | null;
    expect(result).not.toBeNull();
    expect(labels(result)).toContain('$group');
    expect(result!.from).toBe(0);
  });

  it('suggests sandbox globals on a bare identifier', () => {
    const result = source(fakeCtx('Obj')) as CompletionResult | null;
    expect(result).not.toBeNull();
    const found = labels(result);
    expect(found).toEqual(expect.arrayContaining(['db', 'ObjectId', 'EJSON', 'print', 'use', 'ISODate']));
  });

  it('returns null on whitespace without explicit trigger', () => {
    expect(source(fakeCtx('   '))).toBeNull();
  });

  it('returns globals on explicit Ctrl-Space at empty caret', () => {
    const result = source(fakeCtx('', { explicit: true })) as CompletionResult | null;
    expect(result).not.toBeNull();
    expect(labels(result)).toContain('db');
  });
});

function realCtx(doc: string, cursor: string = '█'): CompletionContext {
  const pos = doc.indexOf(cursor);
  if (pos < 0) throw new Error(`cursor token ${cursor} not found in doc`);
  const stripped = doc.slice(0, pos) + doc.slice(pos + cursor.length);
  const state = EditorState.create({ doc: stripped, extensions: [javascript()] });
  // Lezer parses incrementally; force a synchronous parse so `syntaxTree`
  // returns a complete tree for the detector to walk.
  ensureSyntaxTree(state, stripped.length, 5_000);
  return new RealCompletionContext(state, pos, false);
}

describe('mongoCompletionSource — field-position branch', () => {
  const source = mongoCompletionSource({
    getCollections: () => ['users', 'orders'],
    getFieldContext: () => ({ connectionId: 'c1', dbName: 'mydb' }),
  });

  beforeEach(() => {
    invalidateSampleSchemaCache();
    setSampleSchemaCacheTtl();
  });

  it('suggests fields inside db.users.find({ █ })', async () => {
    const result = (await source(realCtx('db.users.find({ █ })'))) as CompletionResult | null;
    expect(result).not.toBeNull();
    expect(labels(result)).toEqual(expect.arrayContaining(['name', 'age', 'address.city']));
    // Logical query operators are merged in alongside fields.
    expect(labels(result)).toEqual(expect.arrayContaining(['$or', '$and', '$nor']));
  });

  it('suggests fields after a partial identifier', async () => {
    const result = (await source(realCtx('db.users.find({ na█ })'))) as CompletionResult | null;
    expect(result).not.toBeNull();
    // CodeMirror filters by `from`/`validFor` — our contract is the range.
    const text = 'db.users.find({ ';
    expect(result!.from).toBe(text.length);
    expect(labels(result)).toContain('name');
  });

  it('suggests fields inside aggregate $match stage', async () => {
    const result = (await source(
      realCtx('db.orders.aggregate([{ $match: { █ } }])'),
    )) as CompletionResult | null;
    expect(result).not.toBeNull();
    expect(labels(result)).toEqual(expect.arrayContaining(['name', 'age']));
  });

  it('suggests fields inside updateOne $set payload', async () => {
    const result = (await source(
      realCtx('db.users.updateOne({ a: 1 }, { $set: { █ } })'),
    )) as CompletionResult | null;
    expect(result).not.toBeNull();
    expect(labels(result)).toEqual(expect.arrayContaining(['name', 'age']));
  });

  it('suggests fields inside a nested $or array element', async () => {
    const result = (await source(
      realCtx('db.users.find({ $or: [{ █ }] })'),
    )) as CompletionResult | null;
    expect(result).not.toBeNull();
    expect(labels(result)).toEqual(expect.arrayContaining(['name', 'age']));
  });

  it('suggests fields inside an $elemMatch sub-filter', async () => {
    const result = (await source(
      realCtx('db.users.find({ tags: { $elemMatch: { █ } } })'),
    )) as CompletionResult | null;
    expect(result).not.toBeNull();
    expect(labels(result)).toEqual(expect.arrayContaining(['name', 'age']));
  });

  it('suggests fields inside $or nested under aggregate $match', async () => {
    const result = (await source(
      realCtx('db.orders.aggregate([{ $match: { $or: [{ █ }] } }])'),
    )) as CompletionResult | null;
    expect(result).not.toBeNull();
    expect(labels(result)).toEqual(expect.arrayContaining(['name', 'age']));
  });

  it('returns no field branch for the value slot', async () => {
    const result = await source(realCtx('db.users.find({ name: █ })'));
    // The field branch returns null; the source then falls through to other
    // branches. With cursor right after `:`, no other branch matches either.
    // Either way: no field suggestions.
    if (result) {
      expect(labels(result as CompletionResult)).not.toEqual(
        expect.arrayContaining(['name', 'age']),
      );
    }
  });

  it('returns no field branch for the top-level update document', async () => {
    // updateOne arg 1 keys are operators ($set/$inc/...), not field names.
    const result = await source(realCtx('db.users.updateOne({}, { █ })'));
    if (result) {
      const found = labels(result as CompletionResult);
      expect(found).not.toContain('name');
      expect(found).not.toContain('age');
    }
  });

  it('returns no field branch for the top-level aggregation stage object', async () => {
    // The outer `{ █ }` here is a stage spec; its keys are stage operators.
    const result = await source(realCtx('db.orders.aggregate([{ █ }])'));
    if (result) {
      const found = labels(result as CompletionResult);
      expect(found).not.toContain('name');
    }
  });

  it('skips field branch when there is no enclosing db.<coll> call', async () => {
    const result = await source(realCtx('const x = { █ }'));
    if (result) {
      const found = labels(result as CompletionResult);
      expect(found).not.toEqual(expect.arrayContaining(['name', 'age']));
    }
  });

  it('skips field branch when getFieldContext returns null', async () => {
    const noCtxSource = mongoCompletionSource({
      getCollections: () => [],
      getFieldContext: () => null,
    });
    const result = await noCtxSource(realCtx('db.users.find({ █ })'));
    // No field branch fires; the regex-based branches don't match an empty
    // slot either, so the source returns null.
    expect(result).toBeNull();
  });

  it('handles a string-literal property key', async () => {
    const result = (await source(
      realCtx('db.users.find({ "na█" })'),
    )) as CompletionResult | null;
    expect(result).not.toBeNull();
    expect(labels(result)).toContain('name');
    // Inside a string slot we don't merge operator suggestions.
    expect(labels(result)).not.toContain('$or');
  });
});
