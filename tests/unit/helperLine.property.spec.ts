import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { pickHelperLine, type HelperCandidate, type HelperKind } from '../../src/pages/Workspace/helperLine';

const ORDER: HelperKind[] = ['error', 'undo', 'hint', 'info'];
const rank = (k: HelperKind) => ORDER.indexOf(k);

const candidate = fc.record({
  kind: fc.constantFrom<HelperKind>(...ORDER),
  text: fc.string(),
});

describe('pickHelperLine properties', () => {
  it('returns one of the candidates, or null only when there are none', () => {
    fc.assert(
      fc.property(fc.array(candidate), (cs) => {
        const got = pickHelperLine(cs);
        if (cs.length === 0) expect(got).toBeNull();
        else expect(cs.some((c) => c === got)).toBe(true);
      }),
    );
  });

  it('the result has the minimal rank among the candidates', () => {
    fc.assert(
      fc.property(fc.array(candidate, { minLength: 1 }), (cs) => {
        const got = pickHelperLine(cs) as HelperCandidate;
        expect(rank(got.kind)).toBe(Math.min(...cs.map((c) => rank(c.kind))));
      }),
    );
  });

  it('the result is the first candidate of that rank', () => {
    fc.assert(
      fc.property(fc.array(candidate, { minLength: 1 }), (cs) => {
        const got = pickHelperLine(cs);
        expect(got).toBe(cs.find((c) => c.kind === got?.kind));
      }),
    );
  });

  it('empty entries never change the result', () => {
    fc.assert(
      fc.property(fc.array(candidate), (cs) => {
        const padded = cs.flatMap((c) => [null, c, false as const]);
        expect(pickHelperLine(padded)).toBe(pickHelperLine(cs));
      }),
    );
  });
});
