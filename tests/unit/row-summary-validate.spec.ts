import { describe, it, expect } from 'vitest';
import {
  ROW_SUMMARY_MAX_FIELDS,
  rowSummaryFieldsProblem,
} from '../../electron/services/rowSummaryValidate';

describe('rowSummaryFieldsProblem', () => {
  it('accepts one to four distinct dotted paths', () => {
    expect(rowSummaryFieldsProblem(['name'])).toBeNull();
    expect(rowSummaryFieldsProblem(['a', 'b.c', 'd', 'e'])).toBeNull();
    expect(ROW_SUMMARY_MAX_FIELDS).toBe(4);
  });

  it('refuses none', () => {
    expect(rowSummaryFieldsProblem([])).toBe('a row summary takes 1 to 4 fields, got 0');
  });

  it('refuses more than four', () => {
    expect(rowSummaryFieldsProblem(['a', 'b', 'c', 'd', 'e'])).toBe(
      'a row summary takes 1 to 4 fields, got 5',
    );
  });

  it('refuses _id, alone or among others', () => {
    expect(rowSummaryFieldsProblem(['_id'])).toBe('a row summary cannot include _id');
    expect(rowSummaryFieldsProblem(['a', '_id'])).toBe('a row summary cannot include _id');
  });

  it('allows a path that merely starts with _id', () => {
    expect(rowSummaryFieldsProblem(['_id.ts', '_ids', 'x_id'])).toBeNull();
  });

  it('refuses a repeated field and names it', () => {
    expect(rowSummaryFieldsProblem(['a', 'b', 'a'])).toBe("a row summary cannot repeat the field 'a'");
  });

  it('refuses an empty or blank field', () => {
    expect(rowSummaryFieldsProblem([''])).toBe('a row summary field cannot be empty');
    expect(rowSummaryFieldsProblem(['a', '  '])).toBe('a row summary field cannot be empty');
  });

  it('treats paths differing only in case or whitespace padding as distinct', () => {
    expect(rowSummaryFieldsProblem(['a', 'A', ' a'])).toBeNull();
  });
});
