import { describe, it, expect } from 'vitest';
import { toggleRegexOption, regexOptionsText } from '../../src/pages/Workspace/regexOptions';

describe('toggleRegexOption', () => {
  it('turns a letter on in imsx order and off again', () => {
    expect(toggleRegexOption('', 'x')).toBe('x');
    expect(toggleRegexOption('x', 'i')).toBe('ix');
    expect(toggleRegexOption('ims', 'm')).toBe('is');
    expect(toggleRegexOption('i', 'i')).toBe('');
  });
});

describe('regexOptionsText', () => {
  it('names the lit options, capitalised', () => {
    expect(regexOptionsText('')).toBeNull();
    expect(regexOptionsText('i')).toBe('Ignore case');
    expect(regexOptionsText('im')).toBe('Ignore case, match each line');
  });
  it('says nothing about letters a row does not hold', () => {
    expect(regexOptionsText('u')).toBeNull();
  });
});
