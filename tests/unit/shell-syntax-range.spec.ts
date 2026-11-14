import { describe, it, expect } from 'vitest';
import { refusalRange, repairToCanonicalEjson } from '../../src/utils/shellSyntax';

const rangeOf = (text: string) => refusalRange(text, repairToCanonicalEjson(text));
const underlined = (text: string) => {
  const r = rangeOf(text);
  return r === null ? null : text.slice(r.start, r.end);
};

describe('refusalRange (W05 §9.3)', () => {
  it('underlines the token after a complete value, skipping the gap before it', () => {
    expect(underlined('{a: 1} nonsense')).toBe('nonsense');
  });

  it('underlines a single punctuation character as its own token', () => {
    expect(underlined('{a: 1,, b: 2}')).toBe(',');
  });

  it('draws an unterminated value on its last character', () => {
    expect(underlined('{a: 1')).toBe('1');
  });

  it('has no range for text that parses, for blank text, or when the parser gives no position', () => {
    expect(rangeOf('{"a":1}')).toBeNull();
    expect(rangeOf('   ')).toBeNull();
    expect(refusalRange('x', { kind: 'failed', reason: 'r' })).toBeNull();
    expect(refusalRange('x', { kind: 'repaired', text: 'y' })).toBeNull();
  });
});
