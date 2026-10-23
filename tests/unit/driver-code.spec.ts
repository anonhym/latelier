import { describe, it, expect } from 'vitest';
import { EJSON, Long, ObjectId } from 'bson';
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

const ej = (json: string) => `EJSON.parse(${JSON.stringify(json)}, { relaxed: false })`;
const OID_SENTINEL = '{"$oid":"64b7f0c2a1b2c3d4e5f60718"}';

describe('findCode', () => {
  it('mongosh: a document without a sentinel is a plain literal', () => {
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

  it('mongosh: a sentinel goes through EJSON.parse on its own, keeping the type', () => {
    const code = findCode('mongosh', { ...base, filter: OID });
    expect(code).toBe(`db.getCollection("users").find({"_id":${ej(OID_SENTINEL)}}).limit(20)`);
    const [findArgs] = runJs(code).args as [unknown[]];
    expect((findArgs[0] as { _id: unknown })._id).toBeInstanceOf(ObjectId);
  });

  it('finds a sentinel anywhere: beside other values, in an array, past a null', () => {
    expect(findCode('mongosh', { ...base, filter: '{"a":null,"b":[1,"x",{"$numberLong":"5"}],"c":{"$date":{"$numberLong":"0"}}}' })).toBe(
      `db.getCollection("users").find({"a":null,"b":[1,"x",${ej('{"$numberLong":"5"}')}],"c":${ej('{"$date":{"$numberLong":"0"}}')}}).limit(20)`,
    );
    // A `$oid` key beside another key is a sub-document, not a sentinel.
    expect(findCode('mongosh', { ...base, filter: '{"a":{"$oid":"x","b":1}}' })).toBe(
      'db.getCollection("users").find({"a":{"$oid":"x","b":1}}).limit(20)',
    );
  });

  it('writes an int32 and a fractional double bare, which every driver sends as that type', () => {
    const filter =
      '{"i":{"$numberInt":"-12"},"f":{"$numberDouble":"1.5"},"d":{"$numberDouble":"2.0"},"n":{"$numberDouble":"NaN"},"x":{"$numberInt":"1e3"}}';
    expect(findCode('node', { ...base, filter }).split('\n')[2]).toBe(
      `const filter = {"i":-12,"f":1.5,"d":${ej('{"$numberDouble":"2.0"}')},"n":${ej('{"$numberDouble":"NaN"}')},"x":${ej('{"$numberInt":"1e3"}')}};`,
    );
    expect(findCode('node', { ...base, filter: '{"y":{"$numberDouble":"Infinity"}}' })).toContain(ej('{"$numberDouble":"Infinity"}'));
  });

  it('a bare integer beyond 2^53 reaches every driver as the exact Long', () => {
    const filter = '{"n":9007199254740993}';
    const mongosh = findCode('mongosh', { ...base, filter });
    expect(mongosh).toContain(ej('{"$numberLong":"9007199254740993"}'));
    const [args] = runJs(mongosh).args as [unknown[]];
    expect((args[0] as { n: Long }).n.toString()).toBe('9007199254740993');

    const [nodeArgs] = runJs(findCode('node', { ...base, filter })).args as [unknown[]];
    expect((nodeArgs[0] as { n: Long }).n).toEqual(Long.fromString('9007199254740993'));

    expect(findCode('python', { ...base, filter })).toContain('json_util.loads("{\\"$numberLong\\":\\"9007199254740993\\"}")');
  });

  it('a Long sentinel string is unchanged', () => {
    const long = '{"$numberLong":"9223372036854775807"}';
    const filter = `{"n":${long}}`;
    for (const lang of ['node', 'python', 'mongosh'] as const) {
      expect(findCode(lang, { ...base, filter })).toContain(JSON.stringify(long));
    }
  });

  it('node: one literal per document, and the find options', () => {
    const code = findCode('node', {
      ...base,
      filter: '{"age":{"$numberLong":"5"}}',
      projection: '{"name":1}',
      sort: '{"age":-1}',
      skip: 50,
      limit: 10,
    });
    expect(code).toBe(
      [
        "const { EJSON } = require('bson');",
        '',
        `const filter = {"age":${ej('{"$numberLong":"5"}')}};`,
        'const projection = {"name":1};',
        'const sort = {"age":-1};',
        'const cursor = db.collection("users").find(filter, { projection, sort, skip: 50, limit: 10 });',
      ].join('\n'),
    );
    const [args] = runJs(code).args as [unknown[]];
    expect((args[0] as { age: unknown }).age).toBeInstanceOf(Long);
    expect(args[1]).toMatchObject({ skip: 50, limit: 10 });
  });

  it('node and mongosh spell null, true, false and -0 as JavaScript', () => {
    const filter = '{"a":null,"b":true,"c":[false,-0]}';
    for (const lang of ['node', 'mongosh'] as const) {
      const [args] = runJs(findCode(lang, { ...base, filter })).args as [unknown[]];
      expect(args[0]).toEqual({ a: null, b: true, c: [false, -0] });
      expect(Object.is((args[0] as { c: number[] }).c[1], -0)).toBe(true);
    }
  });

  it('node: omits absent options', () => {
    expect(findCode('node', base).split('\n').at(-1)).toBe(
      'const cursor = db.collection("users").find(filter, { limit: 20 });',
    );
  });

  it('python: a dict literal per document, sort as a list of pairs', () => {
    expect(
      findCode('python', { ...base, projection: '{"name":1}', sort: '{"age":-1}', skip: 50, limit: 10 }),
    ).toBe(
      [
        'from bson import json_util',
        '',
        'query = {"status":"active"}',
        'projection = {"name":1}',
        'sort = list({"age":-1}.items())',
        'cursor = db["users"].find(query, projection, sort=sort, skip=50, limit=10)',
      ].join('\n'),
    );
    expect(findCode('python', base).split('\n').at(-1)).toBe('cursor = db["users"].find(query, limit=20)');
  });

  it('escapes quotes and backslashes in keys, values and the collection name', () => {
    const filter = '{"k\\"1":"a\\"b\\\\c"}';
    const code = findCode('node', { ...base, collection: 'we"ird\\coll', filter });
    expect(code).toContain('db.collection("we\\"ird\\\\coll")');
    const [args] = runJs(code).args as [unknown[]];
    expect(args[0]).toEqual({ 'k"1': 'a"b\\c' });
    expect(findCode('python', { ...base, collection: 'we"ird', filter })).toContain('db["we\\"ird"]');
    expect(findCode('mongosh', { ...base, collection: 'my-coll' })).toContain('db.getCollection("my-coll")');
  });

  it('refuses a limit that the driver would read as unlimited', () => {
    expect(() => findCode('mongosh', { ...base, limit: 0 })).toThrow(/limit must be positive/);
  });
});

describe('a "__proto__" key survives the JS literal', () => {
  // In an object literal `"__proto__": v` sets the prototype instead of
  // adding a field, so the clause would silently vanish from the query.
  it('mongosh and node keep it as an own field, nested too', () => {
    const filter = '{"__proto__":{"$eq":1},"a":{"__proto__":2}}';
    for (const lang of ['mongosh', 'node'] as const) {
      const code = findCode(lang, { ...base, filter });
      const [args] = runJs(code).args as [unknown[]];
      expect(Object.keys(args[0] as object)).toEqual(['__proto__', 'a']);
      expect(Object.getOwnPropertyDescriptor(args[0], '__proto__')?.value).toEqual({ $eq: 1 });
      expect(Object.keys((args[0] as { a: object }).a)).toEqual(['__proto__']);
    }
    expect(findCode('python', { ...base, filter }).split('\n')[2]).toBe('query = {"__proto__":{"$eq":1},"a":{"__proto__":2}}');
  });
});

describe('only exact sentinels are revived', () => {
  // bson's EJSON.parse revives a `$regex` key into a BSONRegExp whatever sits
  // beside it, dropping `$ne`; the app's own ejsonParse leaves this an
  // operator document, so the snippet has to as well.
  const filter = '{"name":{"$regex":"^A","$ne":"Admin"},"_id":{"$oid":"64b7f0c2a1b2c3d4e5f60718"}}';

  it('node and mongosh keep an operator document that holds a sentinel-like key', () => {
    for (const lang of ['node', 'mongosh'] as const) {
      const [args] = runJs(findCode(lang, { ...base, filter })).args as [unknown[]];
      const doc = args[0] as { name: unknown; _id: unknown };
      expect(doc.name).toEqual({ $regex: '^A', $ne: 'Admin' });
      expect(doc._id).toBeInstanceOf(ObjectId);
    }
  });

  it('python parses only the sentinel itself with json_util', () => {
    expect(findCode('python', { ...base, filter }).split('\n')[2]).toBe(
      'query = {"name":{"$regex":"^A","$ne":"Admin"},"_id":json_util.loads("{\\"$oid\\":\\"64b7f0c2a1b2c3d4e5f60718\\"}")}',
    );
  });

  it('python spells null, true and false its own way', () => {
    expect(findCode('python', { ...base, filter: '{"a":null,"b":true,"c":[false,1.5,-0]}' }).split('\n')[2]).toBe(
      'query = {"a":None,"b":True,"c":[False,1.5,-0.0]}',
    );
  });
});

describe('python sort directions', () => {
  // PyMongo sends a string direction as is, and the server refuses it
  // ("Illegal key in $sort specification"); the Node driver maps it itself.
  it('maps the direction words the app accepts to 1/-1 and keeps $meta', () => {
    const code = findCode('python', {
      ...base,
      sort: '{"a":"desc","b":"ASC","c":{"$meta":"textScore"},"d":-1,"e":"descending","f":"ascending","g":"-1","h":"1"}',
    });
    expect(code).toContain('sort = list({"a":-1,"b":1,"c":{"$meta":"textScore"},"d":-1,"e":-1,"f":1,"g":-1,"h":1}.items())');
  });
});

describe('aggregateCode', () => {
  const pipelineJson = `[{"$match":{"_id":${OID_SENTINEL}}},{"$limit":{"$numberInt":"5"}}]`;

  it('mongosh', () => {
    const code = aggregateCode('mongosh', { collection: 'orders', pipelineJson });
    expect(code).toBe(`db.getCollection("orders").aggregate([{"$match":{"_id":${ej(OID_SENTINEL)}}},{"$limit":5}])`);
    const [args] = runJs(code).args as [unknown[]];
    expect((args[0] as [{ $match: { _id: unknown } }])[0].$match._id).toBeInstanceOf(ObjectId);
  });

  it('node', () => {
    const code = aggregateCode('node', { collection: 'orders', pipelineJson });
    expect(code).toBe(
      [
        "const { EJSON } = require('bson');",
        '',
        `const pipeline = [{"$match":{"_id":${ej(OID_SENTINEL)}}},{"$limit":5}];`,
        'const cursor = db.collection("orders").aggregate(pipeline);',
      ].join('\n'),
    );
    const run = runJs(code);
    expect(run.method).toBe('aggregate');
    const [args] = run.args as [unknown[]];
    expect((args[0] as [{ $match: { _id: unknown } }])[0].$match._id).toBeInstanceOf(ObjectId);
  });

  it('python', () => {
    expect(aggregateCode('python', { collection: 'orders', pipelineJson })).toBe(
      [
        'from bson import json_util',
        '',
        `pipeline = [{"$match":{"_id":json_util.loads(${JSON.stringify(OID_SENTINEL)})}},{"$limit":5}]`,
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
