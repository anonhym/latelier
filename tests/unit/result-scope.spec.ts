import { describe, expect, it } from 'vitest';
import { isUnordered, runMeta, stagePreviewMeta } from '../../src/pages/Workspace/Aggregation/resultScope';

const on = (op: string) => ({ op, enabled: true });
const off = (op: string) => ({ op, enabled: false });

describe('isUnordered', () => {
  it.each([
    ['a $match alone', [on('$match')], 0, false],
    ['a $group', [on('$match'), on('$group')], 1, true],
    ['before the $group', [on('$match'), on('$group')], 0, false],
    ['a $sort after the $group', [on('$group'), on('$sort')], 1, false],
    ['a $sort before the $group', [on('$sort'), on('$group')], 1, true],
    ['a $limit after the $group keeps it unordered', [on('$group'), on('$limit')], 1, true],
    ['a $sample', [on('$sample')], 0, true],
    ['a $unionWith', [on('$unionWith')], 0, true],
    ['a $sortByCount after the $group', [on('$group'), on('$sortByCount')], 1, false],
    ['a disabled $group', [off('$group'), on('$match')], 1, false],
    ['a disabled $sort after the $group', [on('$group'), off('$sort')], 1, true],
    ['an index past the end', [on('$group')], 5, true],
    ['no stages', [], -1, false],
  ])('%s', (_name, stages, index, expected) => {
    expect(isUnordered(stages, index)).toBe(expected);
  });
});

describe('stagePreviewMeta', () => {
  it('names the sample size out of the exact count', () => {
    expect(stagePreviewMeta({ op: '$match', shown: 5, count: 43, unordered: false })).toBe(
      '$match · first 5 of 43 docs',
    );
  });
  it('groups thousands', () => {
    expect(stagePreviewMeta({ op: '$match', shown: 5, count: 12345, unordered: false })).toBe(
      '$match · first 5 of 12,345 docs',
    );
  });
  it('says only the count when everything is shown', () => {
    expect(stagePreviewMeta({ op: '$match', shown: 3, count: 3, unordered: false })).toBe('$match · 3 docs');
  });
  it('still states the scope when the count is unknown', () => {
    expect(stagePreviewMeta({ op: '$match', shown: 5, count: undefined, unordered: false })).toBe(
      '$match · first 5 docs',
    );
  });
  it('claims no documents when nothing was sampled', () => {
    expect(stagePreviewMeta({ op: '$match', shown: 0, count: undefined, unordered: false })).toBe('$match');
    expect(stagePreviewMeta({ op: '$match', shown: 0, count: 12, unordered: false })).toBe('$match · 12 docs');
    expect(stagePreviewMeta({ op: '$match', shown: 0, count: 0, unordered: false })).toBe('$match · 0 docs');
    expect(stagePreviewMeta({ op: '$group', shown: 0, count: undefined, unordered: true })).toBe('$group · unordered');
  });
  it('appends unordered', () => {
    expect(stagePreviewMeta({ op: '$group', shown: 5, count: 9, unordered: true })).toBe(
      '$group · first 5 of 9 docs · unordered',
    );
  });
});

describe('runMeta', () => {
  it('states the docs and the time', () => {
    expect(runMeta({ rows: 7, durationMs: 12, hasMore: false, unordered: false })).toBe('7 docs · 12 ms');
  });
  it('says row limit reached when the row cap cut it short', () => {
    expect(runMeta({ rows: 1000, durationMs: 12, hasMore: true, unordered: false })).toBe(
      'first 1,000 docs, row limit reached · 12 ms',
    );
  });
  it('appends unordered', () => {
    expect(runMeta({ rows: 7, durationMs: 12, hasMore: false, unordered: true })).toBe('7 docs · 12 ms · unordered');
  });
});
