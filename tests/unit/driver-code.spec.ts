import { describe, it, expect } from 'vitest';
import { EJSON, Long, ObjectId, Int32 } from 'bson';
import { aggregateCode, CODE_LANGS, findCode, type FindCodeInput } from '../../src/utils/driverCode';

const OID = '{"_id":{"$oid":"64b7f0c2a1b2c3d4e5f60718"}}';

const base: FindCodeInput = { collection: 'users', filter: '{"status":"active"}', skip: 0, limit: 20 };

/**
 * Runs a generated JavaScript snippet against a stand-in `db` that records
 * what the driver call received — proof the snippet parses and that every
 * document arrives as the BSON the app sends, not just that the text looks
 * right.
 */
function runJs(code: string): { method: string; args: unknown[] } {
  const calls: { method: string; args: unknown[] }[] = [];
  const coll = {
    find: (...args: unknown[]) => {
      calls.push({ method: 'find', args });
      const cursor = {
        sort: (...a: unknown[]) => (calls.push({ method: 'sort', args: a }), cursor),
        skip: (...a: unknown[]) => (calls.push({ method: 'skip', args: a }), cursor),
        limit: (...a: unknown[]) => (calls.push({ method: 'limit', args: a }), cursor),
      };
      return cursor;
    },
    aggregate: (...args: unknown[]) => calls.push({ method: 'aggregate', args }),
  };
  const db = { getCollection: () => coll, collection: () => coll };
  const require = (m: string) => {
    if (m !== 'bson') throw new Error(`unexpected require(${m})`);
    return { EJSON };
  };
  // A snippet is a script, not an expression: run it as a function body. The
  // block lets the Node snippet's own `const { EJSON }` shadow the global
  // mongosh provides. Only this file's fixed test inputs ever reach it.
  new Function('db', 'require', 'EJSON', `{\n${code}\n}`)(db, require, EJSON);
  return { method: calls[0]!.method, args: [calls[0]!.args, ...calls.slice(1).map((c) => [c.method, ...c.args])] };
}

describe('findCode', () => {
  it('mongosh: a document without a sentinel is pasted verbatim', () => {
    expect(
      findCode('mongosh', {
        ...base,
        projection: '{"_id":1,"name":1}',
        sort: '{"createdAt":-1}',
        skip: 100,
      }),
    ).toBe(
      'db.getCollection("users").find({"status":"active"}, {"_id":1,"name":1})' +
        '.sort({"createdAt":-1}).skip(100).limit(20)',
    );
  });

  it('mongosh: a sentinel switches that document to EJSON.parse, keeping the type', () => {
    const code = findCode('mongosh', { ...base, filter: OID });
    expect(code).toBe(
      'db.getCollection("users").find(EJSON.parse("{\\"_id\\":{\\"$oid\\":\\"64b7f0c2a1b2c3d4e5f60718\\"}}", { relaxed: false })).limit(20)',
    );
    const run = runJs(code);
    const [findArgs] = run.args as [unknown[]];
    expect((findArgs[0] as { _id: unknown })._id).toBeInstanceOf(ObjectId);
  });

  it('mongosh: a sentinel nested in an array still counts', () => {
    expect(findCode('mongosh', { ...base, filter: '{"a":{"$in":[{"$numberLong":"5"}]}}' })).toContain('EJSON.parse(');
    // A `$oid` key beside another key is a sub-document, not a sentinel.
    expect(findCode('mongosh', { ...base, filter: '{"a":{"$oid":"x","b":1}}' })).toBe(
      'db.getCollection("users").find({"a":{"$oid":"x","b":1}}).limit(20)',
    );
  });

  it('mongosh: finds a sentinel anywhere — beside other values, in an array, past a null', () => {
    for (const filter of [
      '{"a":1,"b":{"$oid":"64b7f0c2a1b2c3d4e5f60718"}}',
      '{"a":{"$in":[1,{"$numberLong":"5"}]}}',
      '{"a":null,"b":{"$date":{"$numberLong":"0"}}}',
    ]) {
      expect(findCode('mongosh', { ...base, filter })).toBe(
        `db.getCollection("users").find(EJSON.parse(${JSON.stringify(filter)}, { relaxed: false })).limit(20)`,
      );
    }
    expect(findCode('mongosh', { ...base, filter: '{"a":null,"b":[1,"x"]}' })).toBe(
      'db.getCollection("users").find({"a":null,"b":[1,"x"]}).limit(20)',
    );
  });

  it("keeps the user's spelling of a document that needs no rewrite", () => {
    const filter = '{ "a" : 1,\n  "b": 2.50 }';
    expect(findCode('mongosh', { ...base, filter })).toBe(`db.getCollection("users").find(${filter}).limit(20)`);
    expect(findCode('node', { ...base, filter })).toContain(`EJSON.parse(${JSON.stringify(filter)},`);
  });

  it('a bare integer beyond 2^53 reaches every driver as the exact Long', () => {
    const filter = '{"n":9007199254740993}';
    const mongosh = findCode('mongosh', { ...base, filter });
    expect(mongosh).toContain('\\"$numberLong\\":\\"9007199254740993\\"');
    const [args] = runJs(mongosh).args as [unknown[]];
    expect((args[0] as { n: Long }).n.toString()).toBe('9007199254740993');

    const [nodeArgs] = runJs(findCode('node', { ...base, filter })).args as [unknown[]];
    expect((nodeArgs[0] as { n: Long }).n).toEqual(Long.fromString('9007199254740993'));

    expect(findCode('python', { ...base, filter })).toContain('\\"$numberLong\\":\\"9007199254740993\\"');
  });

  it('a Long sentinel string is unchanged', () => {
    const filter = '{"n":{"$numberLong":"9223372036854775807"}}';
    expect(findCode('node', { ...base, filter })).toContain(JSON.stringify(filter));
    expect(findCode('python', { ...base, filter })).toContain(JSON.stringify(filter));
    expect(findCode('mongosh', { ...base, filter })).toContain(JSON.stringify(filter));
  });

  it('node: parses each document with EJSON and passes the find options', () => {
    const code = findCode('node', {
      ...base,
      filter: '{"age":{"$numberInt":"5"}}',
      projection: '{"name":1}',
      sort: '{"age":-1}',
      skip: 50,
      limit: 10,
    });
    expect(code).toBe(
      [
        "const { EJSON } = require('bson');",
        '',
        'const filter = EJSON.parse("{\\"age\\":{\\"$numberInt\\":\\"5\\"}}", { relaxed: false });',
        'const projection = EJSON.parse("{\\"name\\":1}", { relaxed: false });',
        'const sort = EJSON.parse("{\\"age\\":-1}", { relaxed: false });',
        'const cursor = db.collection("users").find(filter, { projection, sort, skip: 50, limit: 10 });',
      ].join('\n'),
    );
    const [args] = runJs(code).args as [unknown[]];
    expect((args[0] as { age: unknown }).age).toBeInstanceOf(Int32);
    expect(args[1]).toMatchObject({ skip: 50, limit: 10 });
  });

  it('node: omits absent options', () => {
    expect(findCode('node', base).split('\n').at(-1)).toBe(
      'const cursor = db.collection("users").find(filter, { limit: 20 });',
    );
  });

  it('python: json_util.loads per document, sort as a list of pairs', () => {
    expect(
      findCode('python', { ...base, projection: '{"name":1}', sort: '{"age":-1}', skip: 50, limit: 10 }),
    ).toBe(
      [
        'from bson import json_util',
        '',
        'query = json_util.loads("{\\"status\\":\\"active\\"}")',
        'projection = json_util.loads("{\\"name\\":1}")',
        'sort = list(json_util.loads("{\\"age\\":-1}").items())',
        'cursor = db["users"].find(query, projection, sort=sort, skip=50, limit=10)',
      ].join('\n'),
    );
    expect(findCode('python', base).split('\n').at(-1)).toBe('cursor = db["users"].find(query, limit=20)');
  });

  it('escapes quotes and backslashes in values and in the collection name', () => {
    const filter = '{"p":"a\\"b\\\\c"}';
    const code = findCode('node', { ...base, collection: 'we"ird\\coll', filter });
    expect(code).toContain('db.collection("we\\"ird\\\\coll")');
    const [args] = runJs(code).args as [unknown[]];
    expect(args[0]).toEqual({ p: 'a"b\\c' });
    expect(findCode('python', { ...base, collection: 'we"ird', filter })).toContain('db["we\\"ird"]');
    expect(findCode('mongosh', { ...base, collection: 'my-coll' })).toContain('db.getCollection("my-coll")');
  });

  it('refuses a limit that the driver would read as unlimited', () => {
    expect(() => findCode('mongosh', { ...base, limit: 0 })).toThrow(/limit must be positive/);
  });
});

describe('aggregateCode', () => {
  const pipelineJson = '[{"$match":{"_id":{"$oid":"64b7f0c2a1b2c3d4e5f60718"}}},{"$limit":{"$numberInt":"5"}}]';

  it('mongosh', () => {
    const code = aggregateCode('mongosh', { collection: 'orders', pipelineJson });
    expect(code).toBe(`db.getCollection("orders").aggregate(EJSON.parse(${JSON.stringify(pipelineJson)}, { relaxed: false }))`);
    const [args] = runJs(code).args as [unknown[]];
    expect((args[0] as [{ $match: { _id: unknown } }])[0].$match._id).toBeInstanceOf(ObjectId);
    expect(aggregateCode('mongosh', { collection: 'orders', pipelineJson: '[{"$count":"n"}]' })).toBe(
      'db.getCollection("orders").aggregate([{"$count":"n"}])',
    );
  });

  it('node', () => {
    const code = aggregateCode('node', { collection: 'orders', pipelineJson });
    expect(code).toBe(
      [
        "const { EJSON } = require('bson');",
        '',
        `const pipeline = EJSON.parse(${JSON.stringify(pipelineJson)}, { relaxed: false });`,
        'const cursor = db.collection("orders").aggregate(pipeline);',
      ].join('\n'),
    );
    const run = runJs(code);
    expect(run.method).toBe('aggregate');
    const [args] = run.args as [unknown[]];
    expect((args[0] as [unknown, { $limit: unknown }])[1].$limit).toBeInstanceOf(Int32);
  });

  it('python', () => {
    expect(aggregateCode('python', { collection: 'orders', pipelineJson })).toBe(
      [
        'from bson import json_util',
        '',
        `pipeline = json_util.loads(${JSON.stringify(pipelineJson)})`,
        'cursor = db["orders"].aggregate(pipeline)',
      ].join('\n'),
    );
  });
});

describe('CODE_LANGS', () => {
  it('lists every language once, with its menu label', () => {
    expect(CODE_LANGS).toEqual([
      { lang: 'mongosh', label: 'mongosh' },
      { lang: 'node', label: 'Node.js' },
      { lang: 'python', label: 'Python' },
    ]);
  });
});
