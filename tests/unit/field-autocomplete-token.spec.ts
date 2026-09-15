import { describe, it, expect } from 'vitest';
import { __test__ } from '../../src/features/fieldSuggestions/FieldAutocompleteInput';

const { computeToken } = __test__;

describe('computeToken — whole', () => {
  it('emits the entire value as a single token', () => {
    const t = computeToken('contact_id', 5, 'whole');
    expect(t).toEqual({ token: 'contact_id', start: 0, end: 10, active: true });
  });

  it('handles empty value', () => {
    const t = computeToken('', 0, 'whole');
    expect(t).toEqual({ token: '', start: 0, end: 0, active: true });
  });
});

describe('computeToken — csv', () => {
  it('caret in first segment', () => {
    const t = computeToken('name, email, phone', 2, 'csv');
    expect(t.token).toBe('name');
    expect('name, email, phone'.slice(t.start, t.end)).toBe('name');
  });

  it('caret in middle segment trims surrounding whitespace', () => {
    const t = computeToken('name, email, phone', 8, 'csv');
    expect(t.token).toBe('email');
    expect('name, email, phone'.slice(t.start, t.end)).toBe('email');
  });

  it('caret in last segment with no trailing comma', () => {
    const t = computeToken('name, email, phone', 18, 'csv');
    expect(t.token).toBe('phone');
    expect('name, email, phone'.slice(t.start, t.end)).toBe('phone');
  });

  it('caret in empty trailing segment after a comma', () => {
    const t = computeToken('name, ', 6, 'csv');
    expect(t.token).toBe('');
    expect(t.active).toBe(true);
  });
});

describe('computeToken — brace', () => {
  it('inactive when no open brace before caret', () => {
    const t = computeToken('hello world', 5, 'brace');
    expect(t.active).toBe(false);
  });

  it('inactive when caret is past a closed brace', () => {
    const t = computeToken('hi {name} there', 12, 'brace');
    expect(t.active).toBe(false);
  });

  it('active inside an open brace, captures inner token', () => {
    const t = computeToken('hi {nam', 7, 'brace');
    expect(t.active).toBe(true);
    expect(t.token).toBe('nam');
    expect('hi {nam'.slice(t.start, t.end)).toBe('nam');
  });

  it('active inside a complete placeholder, replaces just the inner', () => {
    const v = 'hi {name} there';
    const caret = 7; // somewhere inside {name}
    const t = computeToken(v, caret, 'brace');
    expect(t.active).toBe(true);
    expect(t.token).toBe('name');
    expect(v.slice(t.start, t.end)).toBe('name');
  });

  it('handles multiple placeholders — only the active one matters', () => {
    const v = '{a} {b}';
    const t = computeToken(v, 5, 'brace'); // caret right after {b
    expect(t.active).toBe(true);
    expect(t.token).toBe('b');
  });
});
