import { describe, it, expect } from 'vitest';
import { isCrossConnectionPaste, type PasteCheck } from '../../src/utils/crossConnectionPaste';
import { MAX_SCAN_CHARS } from '../../src/utils/distinctiveValues';

const ID = '507f1f77bcf86cd799439011';

function check(over: Partial<PasteCheck> = {}): boolean {
  return isCrossConnectionPaste({
    origin: { connectionId: 'a', distinctive: [ID] },
    focusedConnectionId: 'b',
    pasted: `{ _id: ObjectId("${ID}") }`,
    enabled: true,
    ...over,
  });
}

describe('isCrossConnectionPaste', () => {
  it('is one when a distinctive value from another Connection is pasted', () => {
    expect(check()).toBe(true);
  });

  it('is not one on the same Connection, whatever the Collection', () => {
    expect(check({ focusedConnectionId: 'a' })).toBe(false);
  });

  it('is not one when the preference is off', () => {
    expect(check({ enabled: false })).toBe(false);
  });

  it('is not one without a remembered copy', () => {
    expect(check({ origin: null })).toBe(false);
  });

  it('is not one when the pasted text carries none of the values', () => {
    expect(check({ pasted: '{ _id: 1 }' })).toBe(false);
    expect(check({ origin: { connectionId: 'a', distinctive: [] } })).toBe(false);
  });

  it('is one when any one of several values matches', () => {
    expect(check({ origin: { connectionId: 'a', distinctive: ['nothing-here', ID] } })).toBe(true);
  });

  it('matches an id regardless of the case it is pasted in', () => {
    expect(check({ pasted: ID.toUpperCase() })).toBe(true);
  });

  it('matches a string value exactly', () => {
    const origin = { connectionId: 'a', distinctive: ['Alice Wonderland'] };
    expect(check({ origin, pasted: '{ name: "Alice Wonderland" }' })).toBe(true);
    expect(check({ origin, pasted: '{ name: "alice wonderland" }' })).toBe(false);
  });

  it('reads at most 256 KB of the pasted text', () => {
    expect(check({ pasted: `${' '.repeat(MAX_SCAN_CHARS)}${ID}` })).toBe(false);
    expect(check({ pasted: `${' '.repeat(MAX_SCAN_CHARS - 30)}${ID}` })).toBe(true);
  });
});
