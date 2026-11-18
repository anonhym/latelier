import { describe, it, expect } from 'vitest';
import { pickHelperLine, type HelperCandidate } from '../../src/pages/Workspace/helperLine';

const error: HelperCandidate = { kind: 'error', text: 'e' };
const undo: HelperCandidate = { kind: 'undo', text: 'u' };
const hint: HelperCandidate = { kind: 'hint', text: 'h' };
const info: HelperCandidate = { kind: 'info', text: 'i' };

describe('pickHelperLine', () => {
  it('returns null when there is nothing to say', () => {
    expect(pickHelperLine([])).toBeNull();
    expect(pickHelperLine([null, undefined, false])).toBeNull();
  });

  it('returns the only candidate', () => {
    expect(pickHelperLine([info])).toBe(info);
  });

  it('ranks error over undo over hint over info', () => {
    expect(pickHelperLine([info, hint, undo, error])).toBe(error);
    expect(pickHelperLine([info, hint, undo])).toBe(undo);
    expect(pickHelperLine([info, hint])).toBe(hint);
    expect(pickHelperLine([hint, info])).toBe(hint);
    expect(pickHelperLine([undo, error])).toBe(error);
    expect(pickHelperLine([hint, undo])).toBe(undo);
  });

  it('keeps the first of equal kinds', () => {
    const second: HelperCandidate = { kind: 'hint', text: 'second' };
    expect(pickHelperLine([hint, second])).toBe(hint);
    expect(pickHelperLine([second, hint])).toBe(second);
  });

  it('skips empty entries between candidates', () => {
    expect(pickHelperLine([null, info, false, hint, undefined])).toBe(hint);
  });
});
