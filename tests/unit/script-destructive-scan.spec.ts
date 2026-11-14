import { describe, it, expect } from 'vitest';
import { CONFIRM_DESTRUCTIVE_PREF_KEY, scanDestructive } from '../../src/pages/Workspace/scriptDestructiveScan';

describe('scanDestructive', () => {
  it.each([
    'db.orders.deleteMany({})',
    'db.orders.deleteMany()',
    'db.orders.deleteMany( { } )',
    'db.orders.deleteMany({}, { collation: { locale: "en" } })',
    'db.orders\n  .deleteMany(\n    {}\n  )',
  ])('flags an empty or missing filter: %s', (src) => {
    expect(scanDestructive(src)).toEqual(['deleteMany({})']);
  });

  it('flags .drop() and dropDatabase()', () => {
    expect(scanDestructive('db.orders.drop()')).toEqual(['drop()']);
    expect(scanDestructive('db.dropDatabase()')).toEqual(['dropDatabase()']);
    expect(scanDestructive('db.getSiblingDB("x").dropDatabase()')).toEqual(['dropDatabase()']);
  });

  it('reports each kind once, in a fixed order', () => {
    expect(scanDestructive('db.a.drop(); db.dropDatabase(); db.b.deleteMany({}); db.c.deleteMany()')).toEqual([
      'deleteMany({})',
      'drop()',
      'dropDatabase()',
    ]);
  });

  it.each([
    'db.orders.deleteMany({ status: "x" })',
    'db.orders.deleteMany({ $expr: {} })',
    'db.orders.deleteMany(filter)',
    'db.orders.find({})',
    'db.orders.dropIndex("a_1")',
    'db.orders.dropIndexes()',
    'db.orders.deleteOne({})',
  ])('leaves a call that is not destructive in this sense: %s', (src) => {
    expect(scanDestructive(src)).toEqual([]);
  });

  it('ignores the words inside comments', () => {
    expect(scanDestructive('// db.orders.deleteMany({})\ndb.orders.find()')).toEqual([]);
    expect(scanDestructive('/* db.a.drop()\n db.dropDatabase() */ db.a.find()')).toEqual([]);
  });

  it('ignores the words inside strings and templates, with escaped quotes', () => {
    expect(scanDestructive('print("db.a.deleteMany({})")')).toEqual([]);
    expect(scanDestructive("print('it\\'s db.a.drop()')")).toEqual([]);
    expect(scanDestructive('print(`db.dropDatabase()`)')).toEqual([]);
  });

  it('still sees a call after a string or comment on the same line', () => {
    expect(scanDestructive('print("x"); /* y */ db.a.drop() // z')).toEqual(['drop()']);
  });

  it('does not let an unterminated string or comment hide nothing or throw', () => {
    expect(scanDestructive('print("db.a.drop()')).toEqual([]);
    expect(scanDestructive('/* never closed db.a.drop()')).toEqual([]);
    expect(scanDestructive('')).toEqual([]);
  });

  // A quadratic scan over these sizes takes tens of seconds, so the generous
  // bound still catches it while a loaded machine (Stryker runs this in
  // parallel) does not trip it.
  it('stays linear on long adversarial input', () => {
    const inputs = [
      `db.a.deleteMany(${' '.repeat(200_000)}`,
      `db.a.deleteMany(${'{ '.repeat(50_000)}`,
      'deleteMany('.repeat(20_000),
      `"${'\\"'.repeat(100_000)}`,
      `.drop${' '.repeat(200_000)}`,
    ];
    const started = performance.now();
    for (const src of inputs) scanDestructive(src);
    expect(performance.now() - started).toBeLessThan(5000);
  });

  it('names the setting by its stored key', () => {
    expect(CONFIRM_DESTRUCTIVE_PREF_KEY).toBe('ui.scripts.confirmDestructive');
  });

  it('finds a call at the very start of the source', () => {
    expect(scanDestructive('deleteMany({})')).toEqual(['deleteMany({})']);
    expect(scanDestructive('dropDatabase()')).toEqual(['dropDatabase()']);
  });

  it('sees code after a line comment, and after a division sign', () => {
    expect(scanDestructive('// note\ndb.a.drop()')).toEqual(['drop()']);
    expect(scanDestructive('const half = n / 2; db.a.drop()')).toEqual(['drop()']);
    expect(scanDestructive('const area = w * h; db.a.drop()')).toEqual(['drop()']);
    expect(scanDestructive('const r = 4 / 2;\ndb.a.deleteMany({})')).toEqual(['deleteMany({})']);
  });

  it('ends a block comment at its own */, not an earlier one or one overlapping its opener', () => {
    expect(scanDestructive('/*/ db.a.drop() */')).toEqual([]);
    expect(scanDestructive("/* x' */ db.a.drop()")).toEqual(['drop()']);
    expect(scanDestructive('/* db.a.drop() and more text */ db.a.find()')).toEqual([]);
    expect(scanDestructive('/* never closed db.a.drop()')).toEqual([]);
  });

  it('keeps a block comment a token separator', () => {
    expect(scanDestructive('return/**/deleteMany({})')).toEqual(['deleteMany({})']);
  });

  it('keeps an emptied string argument as an argument', () => {
    expect(scanDestructive('db.a.deleteMany("x")')).toEqual([]);
    expect(scanDestructive('db.a.deleteMany(`x`)')).toEqual([]);
    expect(scanDestructive("db.a.deleteMany('x')")).toEqual([]);
  });

  it('does not match a longer name that merely starts with the call', () => {
    expect(scanDestructive('db.a.deleteManyAll({})')).toEqual([]);
    expect(scanDestructive('db.dropDatabases()')).toEqual([]);
    expect(scanDestructive('db.a.dropIndex("x")')).toEqual([]);
  });

  it('flags dropCollection', () => {
    expect(scanDestructive('db.dropCollection("orders")')).toEqual(['dropCollection()']);
    expect(scanDestructive('await db.admin().dropCollection(name)')).toEqual(['dropCollection()']);
  });

  it.each([
    'db.orders.bulkWrite([{ deleteMany: { filter: {} } }])',
    'db.orders.bulkWrite([{ deleteOne: { filter: { } } }])',
    'db.orders.bulkWrite([{ deleteMany: {} }])',
    'db.orders.bulkWrite([{ "deleteMany": { "filter": {} } }])',
    "db.orders.bulkWrite([{ deleteMany: { filter: {}, collation: { locale: 'en' } } }])",
  ])('flags a bulkWrite delete with an empty filter: %s', (src) => {
    expect(scanDestructive(src)).toEqual(['bulkWrite delete({})']);
  });

  it.each([
    'db.orders.bulkWrite([{ deleteMany: { filter: { status: "x" } } }])',
    'db.orders.bulkWrite([{ insertOne: { document: {} } }])',
    'db.orders.bulkWrite([{ updateOne: { filter: {}, update: { $set: { a: 1 } } } }])',
  ])('leaves a bulkWrite that deletes nothing wholesale: %s', (src) => {
    expect(scanDestructive(src)).toEqual([]);
  });

  it('does not let a quote inside a regex literal blank the rest of the source', () => {
    expect(scanDestructive("const re = /'/; db.a.drop()")).toEqual(['drop()']);
    expect(scanDestructive('const re = /"/g;\ndb.a.deleteMany({})')).toEqual(['deleteMany({})']);
    expect(scanDestructive('const re = /[/\'"]/; db.a.dropDatabase()')).toEqual(['dropDatabase()']);
    expect(scanDestructive('x.replace(/`/g, ""); db.a.drop()')).toEqual(['drop()']);
    expect(scanDestructive("if (ok) return /'/.test(s) && db.a.drop()")).toEqual(['drop()']);
  });

  it('still reads a slash after an operand as division', () => {
    expect(scanDestructive("const a = b / 2; const s = 'x / y'; db.a.drop()")).toEqual(['drop()']);
    expect(scanDestructive('const a = (b) / 2 / 3; db.a.drop()')).toEqual(['drop()']);
    expect(scanDestructive("const a = arr[0] / 2; const t = '/'; db.a.drop()")).toEqual(['drop()']);
  });

  it('a regex that never closes on its line is not taken as one', () => {
    expect(scanDestructive("a = x / 2; b = '/'\ndb.a.drop()")).toEqual(['drop()']);
  });

  it('scans code inside ${} of a template literal', () => {
    expect(scanDestructive('print(`run ${db.a.deleteMany({})}`)')).toEqual(['deleteMany({})']);
    expect(scanDestructive('print(`a ${ `b ${db.a.drop()}` } c`)')).toEqual(['drop()']);
    expect(scanDestructive('print(`x ${ {a: 1}.a } ${db.dropCollection("c")}`)')).toEqual(['dropCollection()']);
  });

  it('keeps the text of a template literal itself blanked', () => {
    expect(scanDestructive('print(`db.a.drop() and ${1 + 1}`)')).toEqual([]);
    expect(scanDestructive('print(`${"db.a.drop()"}`)')).toEqual([]);
  });

  it('copes with unterminated templates and deep ${ nesting without recursing', () => {
    expect(scanDestructive('`${')).toEqual([]);
    expect(scanDestructive('`${`${`${'.repeat(50_000))).toEqual([]);
  });

  it('stays linear on slashes and brackets that never close a regex', () => {
    const started = performance.now();
    scanDestructive('x = (/[ '.repeat(40_000));
    scanDestructive('/'.repeat(200_000));
    scanDestructive('a /[ '.repeat(50_000));
    expect(performance.now() - started).toBeLessThan(5000);
  });

  it.each(['return', 'typeof', 'case', 'in', 'of', 'delete', 'void', 'throw', 'new', 'else', 'do', 'yield', 'await'])(
    'reads a slash after the keyword %s as a regular expression',
    (word) => {
      expect(scanDestructive(`${word} /'/.test(s); db.a.drop()`)).toEqual(['drop()']);
    },
  );

  it('reads a slash after an identifier that only ends like a keyword as division', () => {
    expect(scanDestructive("const x = ofa / 2; s = '/'; db.a.drop()")).toEqual(['drop()']);
    expect(scanDestructive("const x = a_in / 2; s = '/'; db.a.drop()")).toEqual(['drop()']);
  });

  it.each([
    ["a closing paren", "x = (a) / 2; s = '/'; db.a.drop()"],
    ["a closing bracket", "x = a[0] / 2; s = '/'; db.a.drop()"],
    ["a double-quoted string", `x = "a" / 2; s = '/'; db.a.drop()`],
    ["a single-quoted string", "x = 'a' / 2; s = '/'; db.a.drop()"],
    ["a template literal", "x = `a` / 2; s = '/'; db.a.drop()"],
    ["a number", "x = 4 / 2; s = '/'; db.a.drop()"],
    ["a word at the very start", "a / 2; s = '/'; db.a.drop()"],
  ])('reads a slash after %s as division', (_name, src) => {
    expect(scanDestructive(src)).toEqual(['drop()']);
  });

  it.each([
    ['an operator', "x = 1 + /'/.test(s); db.a.drop()"],
    ['an open paren', "f(/'/); db.a.drop()"],
    ['a comma', "f(1, /'/); db.a.drop()"],
    ['a colon', "x = { re: /'/ }; db.a.drop()"],
    ['a block end', "{}\n/'/.test(s); db.a.drop()"],
    ['the start of the source', "/'/.test(s); db.a.drop()"],
    ['a leading blank', "  \n /'/.test(s); db.a.drop()"],
  ])('reads a slash after %s as a regular expression', (_name, src) => {
    expect(scanDestructive(src)).toEqual(['drop()']);
  });

  it('ends a regular expression at its own slash, past an escaped one and one in a class', () => {
    expect(scanDestructive("const re = /\\/'/; db.a.drop()")).toEqual(['drop()']);
    expect(scanDestructive("const re = /[/]'/; db.a.drop()")).toEqual(['drop()']);
    expect(scanDestructive("const re = /[ab/']/; db.a.drop()")).toEqual(['drop()']);
    expect(scanDestructive("const re = /[\\]/']/; db.a.drop()")).toEqual(['drop()']);
  });

  it('blanks a regular expression rather than keeping its text', () => {
    expect(scanDestructive('db.a.deleteMany(/^a/)')).toEqual([]);
    expect(scanDestructive('/db.a.drop()/.test(s)')).toEqual([]);
  });

  it('takes a slash with no closing slash on its line as a division sign', () => {
    expect(scanDestructive('x = {} / 2; db.a.drop()')).toEqual(['drop()']);
    expect(scanDestructive('x = {} / 2\n; db.a.drop()')).toEqual(['drop()']);
  });

  it('carries on after a template, an escaped backtick and a ${} that closes', () => {
    expect(scanDestructive('print(`a`); db.a.drop()')).toEqual(['drop()']);
    expect(scanDestructive('print(`a\\`b db.a.drop()`); db.a.dropDatabase()')).toEqual(['dropDatabase()']);
    expect(scanDestructive('print(`x ${1} y`); db.a.drop()')).toEqual(['drop()']);
    expect(scanDestructive('print(`run ${x} db.a.drop() text`)')).toEqual([]);
  });

  it('keeps counting braces inside a ${}', () => {
    expect(scanDestructive('print(`${ {a: 1}.a + db.a.drop() }`)')).toEqual(['drop()']);
    expect(scanDestructive('print(`${ {a: {b: 1}}.a + db.a.drop() }`)')).toEqual(['drop()']);
    expect(scanDestructive('print(`${ {a: 1}.a } db.a.drop()`)')).toEqual([]);
  });

  it('treats braces outside any template as plain code', () => {
    expect(scanDestructive('if (x) { y() } print(`a ${b} db.a.drop()`)')).toEqual([]);
    expect(scanDestructive('} ; db.a.drop()')).toEqual(['drop()']);
  });

  it('keeps a key written as a string, with spaces or a tab before its colon', () => {
    expect(scanDestructive('db.a.bulkWrite([{ "deleteMany" : { "filter" : {} } }])')).toEqual(['bulkWrite delete({})']);
    expect(scanDestructive("db.a.bulkWrite([{ 'deleteOne'\t: { filter: {} } }])")).toEqual(['bulkWrite delete({})']);
  });

  it('keeps only identifier-like keys, and only when a colon follows', () => {
    expect(scanDestructive('x = { "not a deleteMany": {} }')).toEqual([]);
    expect(scanDestructive('x = { "9deleteMany": {} }')).toEqual([]);
    expect(scanDestructive('x = a ? "deleteMany" /* c */ : {}')).toEqual([]);
    expect(scanDestructive('x = { a: "deleteMany", b: {} }')).toEqual([]);
  });

  it('does not match a bulkWrite key that merely contains the words', () => {
    expect(scanDestructive('x = { deleteMany: { filter: x } }')).toEqual([]);
    expect(scanDestructive('x = { deleteMany:{filter:{}} }')).toEqual(['bulkWrite delete({})']);
    expect(scanDestructive('x = { deleteMany : {} }')).toEqual(['bulkWrite delete({})']);
    expect(scanDestructive('x = { deleteMany: { filterBy: {} } }')).toEqual([]);
    expect(scanDestructive('x = { deleteMany: { filter : {}} }')).toEqual(['bulkWrite delete({})']);
    expect(scanDestructive('db.dropCollectionX("a")')).toEqual([]);
  });
});
