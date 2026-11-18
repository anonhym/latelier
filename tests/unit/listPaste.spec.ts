import { describe, it, expect } from 'vitest';
import { splitPastedList } from '../../src/pages/Workspace/listPaste';

describe('splitPastedList', () => {
  it('splits on comma, newline and tab', () => {
    expect(splitPastedList('a,b\nc\td')).toEqual(['a', 'b', 'c', 'd']);
  });
  it('splits Windows line breaks without an empty chip between', () => {
    expect(splitPastedList('a\r\nb')).toEqual(['a', 'b']);
  });
  it('trims each piece and drops empty ones', () => {
    expect(splitPastedList('  a , ,\n\n b\t\t')).toEqual(['a', 'b']);
  });
  it('keeps inner spaces', () => {
    expect(splitPastedList('new york,los angeles')).toEqual(['new york', 'los angeles']);
  });
  it('leaves quotes for the chip parser', () => {
    expect(splitPastedList('"42",x')).toEqual(['"42"', 'x']);
  });
  it('returns nothing for blank text', () => {
    expect(splitPastedList(' \n\t,')).toEqual([]);
  });
});
