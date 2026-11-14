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
});
