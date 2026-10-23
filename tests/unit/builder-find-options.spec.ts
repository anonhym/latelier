import { describe, it, expect } from 'vitest';
import { DEFAULT_COLLECTION_TAB_STATE } from '@shared/defaults';
import type { BuilderState } from '@shared/types';
import {
  compileFindOptions,
  emptyBuilder,
  findOptionProblems,
  findProblem,
  maxTimeMSWarning,
  optionsProblem,
  READ_PREFERENCE_MODES,
} from '../../src/pages/Workspace/builder';

const b = (over: Partial<BuilderState> = {}): BuilderState => ({ ...emptyBuilder(), ...over });

// W14 §9 — the find options the query bar's options row edits.
describe('compileFindOptions: find options', () => {
  it('leaves every option unset for a builder that has none, or only blank ones', () => {
    for (const builder of [b(), b({ collation: '  ', hint: '\t', maxTimeMS: ' ', readPreference: '' })]) {
      const c = compileFindOptions(builder);
      expect([c.collation, c.hint, c.maxTimeMS, c.readPreference]).toEqual([
        undefined,
        undefined,
        undefined,
        undefined,
      ]);
    }
  });

  it('sends collation and hint as trimmed text, maxTimeMS as a number', () => {
    const c = compileFindOptions(
      b({ collation: ' {"locale":"en"} ', hint: ' _id_ ', maxTimeMS: ' 40000 ', readPreference: 'nearest' }),
    );
    expect(c).toMatchObject({ collation: '{"locale":"en"}', hint: '_id_', maxTimeMS: 40000, readPreference: 'nearest' });
  });

  it('sends no maxTimeMS or readPreference that would not run', () => {
    for (const maxTimeMS of ['0', '-5', '1.5', '5xyz', 'abc', '9'.repeat(20)]) {
      expect([maxTimeMS, compileFindOptions(b({ maxTimeMS })).maxTimeMS]).toEqual([maxTimeMS, undefined]);
    }
    expect(compileFindOptions(b({ maxTimeMS: '1' })).maxTimeMS).toBe(1);
    expect(compileFindOptions(b({ readPreference: 'secondaryOnly' })).readPreference).toBeUndefined();
  });

  it('takes every driver read preference mode', () => {
    expect(READ_PREFERENCE_MODES).toEqual([
      'primary',
      'primaryPreferred',
      'secondary',
      'secondaryPreferred',
      'nearest',
    ]);
    for (const mode of READ_PREFERENCE_MODES) {
      expect(compileFindOptions(b({ readPreference: mode })).readPreference).toBe(mode);
    }
  });
});

describe('findOptionProblems / optionsProblem', () => {
  it('has no problem for unset or blank options, nor for valid ones', () => {
    expect(findOptionProblems(b())).toEqual({});
    expect(findOptionProblems(b({ collation: ' ', hint: ' ', maxTimeMS: ' ', readPreference: '' }))).toEqual({});
    expect(
      findOptionProblems(
        b({ collation: '{"locale":"en","strength":2}', hint: '{"a":1}', maxTimeMS: '500', readPreference: 'primary' }),
      ),
    ).toEqual({});
    expect(optionsProblem(b({ hint: '_id_' }))).toBeNull();
  });

  it('names each option that cannot run', () => {
    expect(
      findOptionProblems(b({ collation: '{"locale":', hint: '{"a":', maxTimeMS: '1.5', readPreference: 'x' })),
    ).toEqual({
      collation: 'Can\'t parse this collation. Expected EJSON like { "locale": "en", "strength": 2 }.',
      hint: 'Can\'t parse this hint. Expected an index name like _id_ or a key pattern like { "a": 1 }.',
      maxTimeMS: 'maxTimeMS must be a whole number of milliseconds, at least 1.',
      readPreference:
        '"x" is not a read preference. Expected one of primary, primaryPreferred, secondary, secondaryPreferred, nearest.',
    });
  });

  it('refuses a collation that parses but is not a document', () => {
    for (const collation of ['[1]', '"en"', 'null', '{"$oid":"507f1f77bcf86cd799439011"}']) {
      expect([collation, findOptionProblems(b({ collation })).collation]).toEqual([
        collation,
        expect.stringMatching(/collation/),
      ]);
    }
  });

  it('reads a hint as an index name unless it opens with a brace', () => {
    for (const hint of ['_id_', 'name_1', 'a}', '[1]']) {
      expect([hint, findOptionProblems(b({ hint })).hint]).toEqual([hint, undefined]);
    }
    expect(findOptionProblems(b({ hint: ' {"a":1 ' })).hint).toMatch(/hint/);
  });

  it('refuses a maxTimeMS of 0, a negative, a fraction or trailing junk', () => {
    for (const maxTimeMS of ['0', '-1', '2.5', '10ms', '1e3']) {
      expect([maxTimeMS, findOptionProblems(b({ maxTimeMS })).maxTimeMS]).toEqual([
        maxTimeMS,
        expect.stringMatching(/maxTimeMS/),
      ]);
    }
  });

  it('optionsProblem reports the first problem in row order', () => {
    expect(optionsProblem(b({ maxTimeMS: '0', readPreference: 'x' }))).toMatch(/maxTimeMS/);
    expect(optionsProblem(b({ readPreference: 'x' }))).toMatch(/read preference/);
    expect(optionsProblem(b({ collation: '[', hint: '{' }))).toMatch(/collation/);
  });

  it('gates Run, Copy and Open as pipeline through findProblem', () => {
    const state = { ...DEFAULT_COLLECTION_TAB_STATE, queryRaw: '{}' };
    expect(findProblem({ ...state, builder: b({ collation: '{"locale":"en"}' }) })).toBeNull();
    expect(findProblem({ ...state, builder: b({ collation: 'en' }) })).toMatch(/collation/);
    // The filter is still reported first.
    expect(findProblem({ ...state, queryRaw: '{', builder: b({ collation: 'en' }) })).toMatch(/filter/);
  });
});

describe('maxTimeMSWarning', () => {
  it('says a value over the 30 s cap runs at the cap, and nothing otherwise', () => {
    expect(maxTimeMSWarning('40000')).toBe('Running with maxTimeMS 30000, the most a query may run.');
    for (const raw of [undefined, '', '30000', '1', 'abc', '0']) {
      expect([raw, maxTimeMSWarning(raw)]).toEqual([raw, null]);
    }
    expect(maxTimeMSWarning('30001')).not.toBeNull();
  });
});
