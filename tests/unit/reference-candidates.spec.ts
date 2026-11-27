import { describe, it, expect } from 'vitest';
import {
  DEFAULT_CANDIDATE_DOCS,
  detectCandidateFieldsFromDocs,
  matchCandidates,
  pluralize,
  singularize,
  stemGuesses,
} from '../../electron/services/referenceCandidates';
import { detectCandidateFieldsFromDocs as reExported } from '../../electron/services/ReferenceRulesService';

describe('referenceCandidates', () => {
  it('is the same function the Reference Rules service exports', () => {
    expect(reExported).toBe(detectCandidateFieldsFromDocs);
  });

  describe('singularize', () => {
    it.each([
      ['contacts', 'contact'],
      ['categories', 'category'],
      ['addresses', 'address'],
      ['bus', 'bu'],
      ['ox', 'ox'],
      ['is', 'is'],
      ['person', 'person'],
      ['iesx', 'iesx'],
      ['sesx', 'sesx'],
      ['sx', 'sx'],
      ['abc', 'abc'],
    ])('%s → %s', (word, expected) => {
      expect(singularize(word)).toBe(expected);
    });
  });

  describe('pluralize', () => {
    it.each([
      ['contact', 'contacts'],
      ['category', 'categories'],
      ['day', 'days'],
      ['key', 'keys'],
      ['toy', 'toys'],
      ['guy', 'guys'],
      ['boy', 'boys'],
      ['ay', 'ays'],
      ['y', 'ies'],
      ['mayfly', 'mayflies'],
      ['yak', 'yaks'],
      ['orders', 'orders'],
      ['sx', 'sxs'],
    ])('%s → %s', (word, expected) => {
      expect(pluralize(word)).toBe(expected);
    });
  });

  describe('stemGuesses', () => {
    it('tries the plural, the stem itself, then the plural of its singular, without repeats', () => {
      expect(stemGuesses('user')).toEqual(['users', 'user']);
      expect(stemGuesses('users')).toEqual(['users']);
      expect(stemGuesses('category')).toEqual(['categories', 'category']);
      expect(stemGuesses('statuses')).toEqual(['statuses', 'status']);
      expect(stemGuesses('addresses')).toEqual(['addresses', 'address']);
    });
  });

  describe('detectCandidateFieldsFromDocs', () => {
    it('reads 25 documents by default', () => {
      expect(DEFAULT_CANDIDATE_DOCS).toBe(25);
      const docs = Array.from({ length: 30 }, (_, i) => ({ [`f${i}_id`]: i }));
      expect(detectCandidateFieldsFromDocs(docs)).toHaveLength(25);
    });

    it('honours a larger limit, up to the documents given', () => {
      const docs = Array.from({ length: 250 }, (_, i) => ({ [`f${i}_id`]: i }));
      const out = detectCandidateFieldsFromDocs(docs, 200);
      expect(out).toHaveLength(200);
      expect(out.at(-1)).toEqual({ sourceField: 'f199_id', stem: 'f199' });
      expect(detectCandidateFieldsFromDocs(docs.slice(0, 3), 200)).toHaveLength(3);
    });

    it('reads the first three elements of an array and no more', () => {
      const out = detectCandidateFieldsFromDocs([[{ a_id: 1 }, { b_id: 1 }, { c_id: 1 }, { d_id: 1 }]]);
      expect(out.map((c) => c.sourceField)).toEqual(['a_id', 'b_id', 'c_id']);
    });

    it('skips nulls, scalars and an _id at any level, and does not walk below one nested level', () => {
      const out = detectCandidateFieldsFromDocs([
        null,
        undefined,
        7,
        'x',
        { _id: 1, meta: { _id: 2, owner_id: 1, deep: { user_id: 1 } }, list: [{ tag_id: 1 }] },
      ]);
      expect(out).toEqual([{ sourceField: 'meta.owner_id', stem: 'owner' }]);
    });

    it('does not walk into an object holding any $-key, wherever it sits', () => {
      const out = detectCandidateFieldsFromDocs([{ ref: { a_id: 1, $oid: 'x' } }, { other: { b_id: 1 } }]);
      expect(out.map((c) => c.sourceField)).toEqual(['other.b_id']);
    });

    it('takes the stem from snake_case before camelCase, and keeps the first stem seen per path', () => {
      expect(detectCandidateFieldsFromDocs([{ ownerId_id: 1 }])).toEqual([{ sourceField: 'ownerId_id', stem: 'ownerId' }]);
      expect(detectCandidateFieldsFromDocs([{ x_id: 1 }, { x_id: 2 }])).toEqual([{ sourceField: 'x_id', stem: 'x' }]);
    });

    it('never walks into the _id, even when it is a plain object', () => {
      expect(detectCandidateFieldsFromDocs([{ _id: { user_id: 1 } }])).toEqual([]);
    });

    it('matches the whole key, so a name with a line break in it is not cut at the break', () => {
      expect(detectCandidateFieldsFromDocs([{ 'a\nb_id': 1, 'c\ndId': 1 }])).toEqual([]);
    });

    it('does not match a key that only contains the suffix', () => {
      expect(detectCandidateFieldsFromDocs([{ a_idx: 1, aIdx: 1, _id_: 1, id: 1 }])).toEqual([]);
    });
  });

  describe('matchCandidates', () => {
    const names = new Set(['users', 'category', 'statuses', 'orders']);

    it('pairs a stem with the first guess that names a collection', () => {
      const out = matchCandidates(
        [
          { sourceField: 'user_id', stem: 'user' },
          { sourceField: 'categoryId', stem: 'category' },
          { sourceField: 'statuses_id', stem: 'statuses' },
          { sourceField: 'status_id', stem: 'status' },
          { sourceField: 'missing_id', stem: 'missing' },
        ],
        names,
        'shop',
        new Set(['categoryId']),
      );
      expect(out).toEqual([
        { sourceField: 'user_id', targetDb: 'shop', targetCollection: 'users', targetField: '_id', alreadyConfigured: false },
        { sourceField: 'categoryId', targetDb: 'shop', targetCollection: 'category', targetField: '_id', alreadyConfigured: true },
        { sourceField: 'statuses_id', targetDb: 'shop', targetCollection: 'statuses', targetField: '_id', alreadyConfigured: false },
      ]);
    });

    it('prefers the plural over the stem when both exist', () => {
      const out = matchCandidates([{ sourceField: 'order_id', stem: 'order' }], new Set(['order', 'orders']), 'd', new Set());
      expect(out[0]!.targetCollection).toBe('orders');
    });

    it('falls back to the plural of the singular', () => {
      const out = matchCandidates([{ sourceField: 'statuses_id', stem: 'statuses' }], new Set(['status']), 'd', new Set());
      expect(out[0]!.targetCollection).toBe('status');
    });

    it('finds nothing in an empty collection list', () => {
      expect(matchCandidates([{ sourceField: 'user_id', stem: 'user' }], new Set(), 'd', new Set())).toEqual([]);
    });

    it('gives what autodetect gave on its fixtures', () => {
      const docs = [{ _id: 1, contact_id: 'x', user_id: 'y', customerId: 'z', meta: { owner_id: 1 } }];
      const out = matchCandidates(detectCandidateFieldsFromDocs(docs), new Set(['contacts', 'users', 'customer', 'owners']), 'crm', new Set(['user_id']));
      expect(out.map((c) => [c.sourceField, c.targetCollection, c.alreadyConfigured])).toEqual([
        ['contact_id', 'contacts', false],
        ['user_id', 'users', true],
        ['customerId', 'customer', false],
        ['meta.owner_id', 'owners', false],
      ]);
    });
  });
});
