import { describe, it, expect } from 'vitest';
import { displayName, hasUnsafeChars } from '../../electron/agent/safeText';

describe('hasUnsafeChars', () => {
  it.each([
    ['a newline', 'a\nb'],
    ['a tab', 'a\tb'],
    ['NUL', 'a\u0000b'],
    ['the bidi override U+202E', 'abc\u202Edef'],
    ['the bidi isolate U+2066', '\u2066abc'],
    ['a zero-width space U+200B', 'a\u200Bb'],
    ['a zero-width joiner U+200D', 'a\u200Db'],
    ['the byte order mark U+FEFF', '\uFEFFabc'],
    ['the line separator U+2028', 'a\u2028b'],
    ['the paragraph separator U+2029', 'a\u2029b'],
    ['a private-use character U+E000', 'ab'],
    ['an unassigned code point U+0378', 'a͸b'],
    ['a lone surrogate', 'a\uD800b'],
    ['a C1 control U+0085', 'a\u0085b'],
  ])('flags %s', (_name, text) => {
    expect(hasUnsafeChars(text)).toBe(true);
  });

  it.each(['Claude Code, laptop', 'Café 笔记本', 'Ünïcode — dash', 'a b', '日本語のエージェント', 'x'])(
    'accepts the ordinary name %j',
    (text) => {
      expect(hasUnsafeChars(text)).toBe(false);
    },
  );

  it('keeps a plain space and the no-break space, which are separators of no line', () => {
    expect(hasUnsafeChars('a b c')).toBe(false);
  });
});

describe('displayName', () => {
  it('leaves a safe name as it is', () => {
    expect(displayName('Café 笔记本')).toBe('Café 笔记本');
  });

  it('turns each run of unsafe characters into one space', () => {
    expect(displayName('Claude\n\n\u202ETurn on?')).toBe('Claude Turn on?');
    expect(displayName('a\u200B\u200Bb')).toBe('a b');
  });

  it('removes a leading or trailing unsafe run entirely', () => {
    expect(displayName('\u202Eabc\u2028')).toBe('abc');
  });

  it('cuts to 80 characters by default and to the limit it is given', () => {
    expect(displayName('x'.repeat(200))).toHaveLength(80);
    expect(displayName('x'.repeat(200), 10)).toBe('x'.repeat(10));
  });

  it('keeps a name of exactly the limit', () => {
    expect(displayName('x'.repeat(80))).toBe('x'.repeat(80));
  });

  it('is empty for a name made only of unsafe characters', () => {
    expect(displayName('\u200B\u202E\n')).toBe('');
  });
});
