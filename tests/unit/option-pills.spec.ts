import { describe, it, expect } from 'vitest';
import type { BuilderState, CollectionTabState } from '@shared/types';
import {
  formatElapsed,
  optionPills,
  PILL_LOOK,
  runLabel,
  runProblem,
  runProblemKey,
  runWarning,
  splitPills,
  stripText,
  type OptionKey,
} from '../../src/pages/Workspace/optionPills';

const builder = (overrides: Partial<BuilderState> = {}): BuilderState => ({
  projection: [],
  sort: '',
  limit: '',
  ...overrides,
});

const query = (overrides: Partial<BuilderState> = {}, queryRaw = '{}') => ({
  queryRaw,
  builder: builder(overrides),
});

function pills(overrides: Partial<BuilderState> = {}, page = 0, pageSize = 50) {
  const state: Pick<CollectionTabState, 'builder' | 'page' | 'pageSize'> = {
    builder: builder(overrides),
    page,
    pageSize,
  };
  return optionPills(state);
}

function pill(key: OptionKey, overrides: Partial<BuilderState> = {}, page = 0) {
  const found = pills(overrides, page).find((p) => p.key === key);
  if (!found) throw new Error(`no pill for ${key}`);
  return found;
}

describe('optionPills', () => {
  it('draws every option in row order, each a bare name while unset', () => {
    expect(pills()).toEqual([
      { key: 'sort', name: 'Sort', label: 'Sort', status: 'unset' },
      { key: 'project', name: 'Project', label: 'Project', status: 'unset' },
      { key: 'limit', name: 'Limit', label: 'Limit', status: 'unset' },
      { key: 'skip', name: 'Skip', label: 'Skip', status: 'unset' },
      { key: 'collation', name: 'Collation', label: 'Collation', status: 'unset' },
      { key: 'hint', name: 'Hint', label: 'Hint', status: 'unset' },
      { key: 'maxTimeMS', name: 'Max time', label: 'Max time', status: 'unset' },
      { key: 'readPreference', name: 'Read preference', label: 'Read preference', status: 'unset' },
    ]);
  });

  it.each([
    ['{"_id":-1}', 'Sort: _id ↓'],
    ['{"a":1,"b":-1}', 'Sort: a ↑, b ↓'],
    ['{ a: 1 }', 'Sort: a ↑'],
    ['{"a":1,"b":-1,"c":1}', 'Sort: 3 fields'],
    ['{"score":{"$meta":"textScore"}}', 'Sort: 1 field'],
    ['{"a":1,"score":{"$meta":"textScore"}}', 'Sort: 2 fields'],
  ])('a sort of %s reads %s', (sort, label) => {
    expect(pill('sort', { sort })).toMatchObject({ label, status: 'set' });
  });

  it('a blank or empty sort is unset, and one that cannot run is invalid', () => {
    expect(pill('sort', { sort: '   ' }).status).toBe('unset');
    expect(pill('sort', { sort: '{}' })).toMatchObject({ label: 'Sort', status: 'unset' });
    expect(pill('sort', { sort: '{"a":' })).toMatchObject({ label: 'Sort: invalid', status: 'invalid' });
    expect(pill('sort', { sort: '{"a":2}' }).status).toBe('invalid');
    expect(pill('sort', { sort: '[1]' }).status).toBe('invalid');
  });

  it('a projection counts its fields, drawn or raw', () => {
    expect(pill('project', { projection: ['a'] })).toMatchObject({ label: 'Project: 1 field', status: 'set' });
    expect(pill('project', { projection: ['a', 'b', 'c'] }).label).toBe('Project: 3 fields');
    expect(pill('project', { projection: ['a'], projectionRaw: '{"x":1,"y":0}' }).label).toBe('Project: 2 fields');
    expect(pill('project', { projectionRaw: '  ' }).status).toBe('unset');
    expect(pill('project', { projectionRaw: '{}' })).toMatchObject({ label: 'Project', status: 'unset' });
    expect(pill('project', { projectionRaw: '{"x":' })).toMatchObject({
      label: 'Project: invalid',
      status: 'invalid',
    });
  });

  it('a limit shows what runs, a coerced one included', () => {
    expect(pill('limit', { limit: '100' })).toMatchObject({ label: 'Limit: 100', status: 'set' });
    expect(pill('limit', { limit: '5xyz' }).label).toBe('Limit: 5');
    expect(pill('limit', { limit: 'abc' })).toMatchObject({ label: 'Limit: none', status: 'set' });
    expect(pill('limit', { limit: ' ' }).status).toBe('unset');
  });

  it('skip is the page offset, unset on the first page', () => {
    expect(pill('skip', {}, 0).status).toBe('unset');
    expect(pill('skip', {}, 1)).toMatchObject({ label: 'Skip: 50', status: 'set' });
    expect(pills({}, 3, 20).find((p) => p.key === 'skip')?.label).toBe('Skip: 60');
  });

  it('a collation shows its locale, or "set" without one', () => {
    expect(pill('collation', { collation: '{"locale":"en","strength":2}' }).label).toBe('Collation: en');
    expect(pill('collation', { collation: '{ locale: "fr" }' }).label).toBe('Collation: fr');
    expect(pill('collation', { collation: '{"strength":2}' })).toMatchObject({
      label: 'Collation: set',
      status: 'set',
    });
    expect(pill('collation', { collation: '{"locale":1}' }).label).toBe('Collation: set');
    expect(pill('collation', { collation: '{"locale"' })).toMatchObject({
      label: 'Collation: invalid',
      status: 'invalid',
    });
    expect(pill('collation', { collation: '  ' }).status).toBe('unset');
  });

  it('a hint is shown as typed, clipped past 24 characters', () => {
    expect(pill('hint', { hint: ' _id_ ' })).toMatchObject({ label: 'Hint: _id_', status: 'set' });
    expect(pill('hint', { hint: 'x'.repeat(24) }).label).toBe(`Hint: ${'x'.repeat(24)}`);
    expect(pill('hint', { hint: 'x'.repeat(25) }).label).toBe(`Hint: ${'x'.repeat(24)}…`);
    expect(pill('hint', { hint: '{"a":' })).toMatchObject({ label: 'Hint: invalid', status: 'invalid' });
    expect(pill('hint', { hint: '  ' }).status).toBe('unset');
  });

  it('max time shows milliseconds, at the cap past it', () => {
    expect(pill('maxTimeMS', { maxTimeMS: '500' })).toMatchObject({ label: 'Max time: 500 ms', status: 'set' });
    expect(pill('maxTimeMS', { maxTimeMS: '999999999999' }).label).toBe('Max time: 30000 ms');
    expect(pill('maxTimeMS', { maxTimeMS: 'abc' })).toMatchObject({
      label: 'Max time: invalid',
      status: 'invalid',
    });
    expect(pill('maxTimeMS', { maxTimeMS: ' ' }).status).toBe('unset');
  });

  it('a read preference shows its mode', () => {
    expect(pill('readPreference', { readPreference: 'secondary' })).toMatchObject({
      label: 'Read preference: secondary',
      status: 'set',
    });
    expect(pill('readPreference', { readPreference: 'nope' })).toMatchObject({
      label: 'Read preference: invalid',
      status: 'invalid',
    });
    expect(pill('readPreference', { readPreference: '' }).status).toBe('unset');
  });
});

describe('PILL_LOOK', () => {
  it('is a ghost while unset, soft-filled once set, red when it cannot run', () => {
    expect(PILL_LOOK).toEqual({
      unset: { variant: 'subtle', color: 'gray' },
      set: { variant: 'light', color: undefined },
      invalid: { variant: 'light', color: 'red' },
    });
  });
});

describe('splitPills', () => {
  const keys = (list: { key: OptionKey }[]) => list.map((p) => p.key);

  it('keeps Sort, Project and Limit in the row and the rest in More', () => {
    const { row, more } = splitPills(pills(), null);
    expect(keys(row)).toEqual(['sort', 'project', 'limit']);
    expect(keys(more)).toEqual(['skip', 'collation', 'hint', 'maxTimeMS', 'readPreference']);
  });

  it('promotes a set or invalid option out of More', () => {
    const { row, more } = splitPills(pills({ hint: '_id_', maxTimeMS: 'abc' }, 2), null);
    expect(keys(row)).toEqual(['sort', 'project', 'limit', 'skip', 'hint', 'maxTimeMS']);
    expect(keys(more)).toEqual(['collation', 'readPreference']);
  });

  it('promotes the option whose editor is open, so it has a pill to anchor to', () => {
    const { row, more } = splitPills(pills(), 'collation');
    expect(keys(row)).toEqual(['sort', 'project', 'limit', 'collation']);
    expect(keys(more)).not.toContain('collation');
  });
});

describe('runProblem', () => {
  it('is null for a query that runs', () => {
    expect(runProblem(query())).toBeNull();
    expect(
      runProblem(
        query({
          sort: '{"a":1}',
          projectionRaw: '{"a":1}',
          collation: '{"locale":"en"}',
          hint: '_id_',
          maxTimeMS: '10',
          readPreference: 'primary',
        }),
      ),
    ).toBeNull();
  });

  it('does not refuse Shell Syntax the transform repairs', () => {
    expect(runProblem(query({ sort: '{ createdAt: -1 }' }, '{ _id: ObjectId("507f1f77bcf86cd799439011") }'))).toBeNull();
  });

  it('names the transform\'s own reason, with its position, for text it refuses', () => {
    expect(runProblem(query({}, '{ a: b }'))).toEqual({
      clause: 'filter',
      message: expect.stringMatching(/^Line 1, column 6: /),
      range: { start: 5, end: 6 },
    });
    expect(runProblem(query({ sort: '{ a: b }' }))).toEqual({
      clause: 'sort',
      message: expect.stringMatching(/^Line 1, column 6: /),
    });
  });

  it('applies each clause\'s own rule to text the transform accepts', () => {
    expect(runProblem(query({}, ''))).toEqual({
      clause: 'filter',
      message: 'Enter a filter, like { "status": "active" }, or {} to match every document.',
    });
    expect(runProblem(query({}, '[1]'))).toEqual({
      clause: 'filter',
      message: 'A filter must be a document, like { "status": "active" }.',
    });
    expect(runProblem(query({ sort: '{ a: 2 }' }))).toEqual({
      clause: 'sort',
      message: 'Sort direction for "a" must be 1, -1, "asc" or "desc".',
    });
  });

  it.each([
    [{ projectionRaw: '{"x":' }, 'project', 'Can\'t parse this projection. Expected EJSON like { "_id": 0 }.'],
    [
      { collation: '{"x"' },
      'collation',
      'Can\'t parse this collation. Expected EJSON like { "locale": "en", "strength": 2 }.',
    ],
    [
      { hint: '{"a":' },
      'hint',
      'Can\'t parse this hint. Expected an index name like _id_ or a key pattern like { "a": 1 }.',
    ],
    [{ maxTimeMS: 'abc' }, 'maxTimeMS', 'maxTimeMS must be a whole number of milliseconds, at least 1.'],
  ] as const)('refuses %o on the %s clause', (overrides, clause, message) => {
    expect(runProblem(query(overrides))).toEqual({ clause, message });
  });

  it('refuses an unknown read preference', () => {
    expect(runProblem(query({ readPreference: 'nope' }))).toMatchObject({ clause: 'readPreference' });
  });

  it('reports the first problem in clause order', () => {
    const all = {
      sort: '{"a":2}',
      projectionRaw: '{"x":',
      collation: '{"x"',
      hint: '{"a":',
      maxTimeMS: 'abc',
      readPreference: 'nope',
    };
    expect(runProblem(query(all, '[1]'))?.clause).toBe('filter');
    expect(runProblem(query(all))?.clause).toBe('sort');
    expect(runProblem(query({ ...all, sort: '' }))?.clause).toBe('project');
    expect(runProblem(query({ ...all, sort: '', projectionRaw: '' }))?.clause).toBe('collation');
    expect(runProblem(query({ hint: all.hint, maxTimeMS: all.maxTimeMS, readPreference: 'nope' }))?.clause).toBe('hint');
    expect(runProblem(query({ maxTimeMS: all.maxTimeMS, readPreference: 'nope' }))?.clause).toBe('maxTimeMS');
  });
});

describe('runWarning', () => {
  it('is null when every value runs as typed', () => {
    expect(runWarning(query({ limit: '10', maxTimeMS: '10' }))).toBeNull();
  });

  it('says what a coerced limit runs as', () => {
    expect(runWarning(query({ limit: 'abc' }))).toEqual({
      clause: 'limit',
      message: '"abc" is not a positive number — running with no limit.',
    });
  });

  it('says a max time over the cap runs at the cap, after any limit warning', () => {
    expect(runWarning(query({ maxTimeMS: '999999999999' }))).toEqual({
      clause: 'maxTimeMS',
      message: 'Running with maxTimeMS 30000, the most a query may run.',
    });
    expect(runWarning(query({ limit: 'abc', maxTimeMS: '999999999999' }))?.clause).toBe('limit');
  });
});

describe('runProblemKey', () => {
  const base = query({ sort: '{"a":1}' }, '{"a":1}');

  it('is the same before and after a repair is committed', () => {
    expect(runProblemKey(query({ sort: '{ a: 1 }' }, '{ a: 1 }'))).toBe(
      runProblemKey(query({ sort: '{ "a": 1 }' }, '{ "a": 1 }')),
    );
  });

  it.each([
    ['the filter', { ...base, queryRaw: '{"a":2}' }],
    ['the sort', query({ sort: '{"a":-1}' }, '{"a":1}')],
    ['the drawn projection', query({ sort: '{"a":1}', projection: ['a'] }, '{"a":1}')],
    ['the raw projection', query({ sort: '{"a":1}', projectionRaw: '{"a":1}' }, '{"a":1}')],
    ['the limit', query({ sort: '{"a":1}', limit: '5' }, '{"a":1}')],
    ['the collation', query({ sort: '{"a":1}', collation: '{"locale":"en"}' }, '{"a":1}')],
    ['the hint', query({ sort: '{"a":1}', hint: '_id_' }, '{"a":1}')],
    ['the max time', query({ sort: '{"a":1}', maxTimeMS: '5' }, '{"a":1}')],
    ['the read preference', query({ sort: '{"a":1}', readPreference: 'primary' }, '{"a":1}')],
  ])('changes with %s', (_what, changed) => {
    expect(runProblemKey(changed)).not.toBe(runProblemKey(base));
  });

  it('keeps unparseable text as typed', () => {
    expect(runProblemKey(query({}, '{ a: b'))).not.toBe(runProblemKey(query({}, '{ a: c')));
  });
});

describe('stripText', () => {
  it('gives the filter\'s message as it is and names any other clause first', () => {
    expect(stripText({ clause: 'filter', message: 'Nope.' })).toBe('Nope.');
    expect(stripText({ clause: 'sort', message: 'Nope.' })).toBe('Sort — Nope.');
    expect(stripText({ clause: 'maxTimeMS', message: 'Nope.' })).toBe('Max time — Nope.');
    expect(stripText({ clause: 'project', message: 'Nope.' })).toBe('Projection — Nope.');
  });
});

describe('runLabel', () => {
  it.each([
    [null, 'Run'],
    ['filter', 'Fix filter to run'],
    ['sort', 'Fix sort to run'],
    ['project', 'Fix projection to run'],
    ['collation', 'Fix collation to run'],
    ['hint', 'Fix hint to run'],
    ['maxTimeMS', 'Fix max time to run'],
    ['readPreference', 'Fix read preference to run'],
  ] as const)('%s reads %s', (clause, label) => {
    expect(runLabel(clause === null ? null : { clause, message: 'x' })).toBe(label);
  });
});

describe('formatElapsed', () => {
  it.each([
    [0, false, '0 s'],
    [3500, false, '3 s'],
    [3500, true, '3.5 s'],
    [3549, true, '3.5 s'],
    [59_999, false, '59 s'],
    [60_000, false, '1 min 0 s'],
    [60_000, true, '1 min 0 s'],
    [65_900, false, '1 min 5 s'],
    [125_000, true, '2 min 5 s'],
  ])('%d ms (tenths %s) reads %s', (ms, tenths, text) => {
    expect(formatElapsed(ms, tenths)).toBe(text);
  });

  it('counts whole seconds unless asked for tenths', () => {
    expect(formatElapsed(1900)).toBe('1 s');
  });
});
