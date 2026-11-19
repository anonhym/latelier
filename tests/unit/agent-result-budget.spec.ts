import { describe, it, expect } from 'vitest';
import { Decimal128, Long, ObjectId } from 'bson';
import { MAX_RESPONSE_BYTES, describeResult, takeWithinBudget } from '../../electron/agent/resultBudget';

const doc = (n: number, pad = 0) => ({ _id: n, v: 'x'.repeat(pad) });
const size = (value: unknown) => Buffer.byteLength(JSON.stringify(value));

async function* stream<T>(items: T[], onClose?: () => void): AsyncGenerator<T> {
  try {
    for (const item of items) yield item;
  } finally {
    onClose?.();
  }
}

describe('takeWithinBudget', () => {
  it('returns an empty array for no documents', async () => {
    const r = await takeWithinBudget([], { limit: 10 });
    expect(r).toEqual({ json: '[]', count: 0, bytes: 2, truncated: false, appliedLimits: [] });
  });

  it('returns every document, untruncated, when fewer than the limit arrive', async () => {
    const r = await takeWithinBudget([doc(1), doc(2)], { limit: 3 });
    expect(JSON.parse(r.json)).toEqual([doc(1), doc(2)]);
    expect(r).toMatchObject({ count: 2, truncated: false, appliedLimits: [] });
    expect(r.bytes).toBe(Buffer.byteLength(r.json));
  });

  it('is not truncated when exactly `limit` documents arrive', async () => {
    const r = await takeWithinBudget([doc(1), doc(2)], { limit: 2 });
    expect(r).toMatchObject({ count: 2, truncated: false, appliedLimits: [] });
  });

  it('stops at the limit with ["limit"] when one more document exists', async () => {
    const r = await takeWithinBudget([doc(1), doc(2), doc(3)], { limit: 2 });
    expect(JSON.parse(r.json)).toEqual([doc(1), doc(2)]);
    expect(r).toMatchObject({ count: 2, truncated: true, appliedLimits: ['limit'] });
  });

  it('closes an async source that it stops reading', async () => {
    let closed = false;
    await takeWithinBudget(stream([doc(1), doc(2), doc(3)], () => (closed = true)), { limit: 1 });
    expect(closed).toBe(true);
  });

  it('reads an async source to its end when nothing stops it', async () => {
    let closed = false;
    const r = await takeWithinBudget(stream([doc(1), doc(2)], () => (closed = true)), { limit: 5 });
    expect(r.count).toBe(2);
    expect(closed).toBe(true);
  });

  describe('byte budget', () => {
    const one = size(doc(1, 20));

    it('fits documents whose array is exactly the budget, and stops at the one that is a byte over', async () => {
      const exact = 2 + one + 1 + one;
      const fits = await takeWithinBudget([doc(1, 20), doc(2, 20)], { limit: 10, maxBytes: exact });
      expect(fits).toMatchObject({ count: 2, truncated: false, bytes: exact });
      const tight = await takeWithinBudget([doc(1, 20), doc(2, 20)], { limit: 10, maxBytes: exact - 1 });
      expect(tight).toMatchObject({ count: 1, truncated: true, appliedLimits: ['bytes'] });
      expect(JSON.parse(tight.json)).toEqual([doc(1, 20)]);
    });

    it('accounts for the brackets and the separators', async () => {
      const r = await takeWithinBudget([doc(1, 20), doc(2, 20), doc(3, 20)], { limit: 10, maxBytes: 2 + one * 2 + 1 });
      expect(r.count).toBe(2);
      expect(r.bytes).toBe(2 + one * 2 + 1);
      expect(r.json).toBe(`[${JSON.stringify(doc(1, 20))},${JSON.stringify(doc(2, 20))}]`);
    });

    it('measures UTF-8 bytes, not characters', async () => {
      const wide = { _id: 1, v: 'é'.repeat(30) };
      const bytes = size(wide);
      expect(bytes).toBeGreaterThan(JSON.stringify(wide).length);
      const r = await takeWithinBudget([wide, wide], { limit: 10, maxBytes: 2 + bytes + 1 + bytes - 1 });
      expect(r.count).toBe(1);
      const fits = await takeWithinBudget([wide, wide], { limit: 10, maxBytes: 2 + bytes + 1 + bytes });
      expect(fits.count).toBe(2);
    });

    it('stops at the first document that does not fit, and does not skip ahead to a smaller one', async () => {
      // The second fits the budget alone, but not beside the first; the third would fit and must not be taken.
      const r = await takeWithinBudget([doc(1, 20), doc(2, 260), doc(3, 0)], { limit: 10, maxBytes: 300 });
      expect(size(doc(2, 260)) + 2).toBeLessThanOrEqual(300);
      expect(r.count).toBe(1);
      expect(r.appliedLimits).toEqual(['bytes']);
    });

    it('defaults to 1 MiB', async () => {
      expect(MAX_RESPONSE_BYTES).toBe(1_048_576);
      const big = (n: number) => ({ _id: n, v: 'x'.repeat(300_000) });
      const r = await takeWithinBudget([big(1), big(2), big(3), big(4)], { limit: 10 });
      expect(r.count).toBe(3);
      expect(r.appliedLimits).toEqual(['bytes']);
      expect(r.bytes).toBeLessThanOrEqual(MAX_RESPONSE_BYTES);
    });

    it('closes an async source when the budget stops it', async () => {
      let closed = false;
      await takeWithinBudget(stream([doc(1, 20), doc(2, 20)], () => (closed = true)), { limit: 10, maxBytes: 2 + one });
      expect(closed).toBe(true);
    });
  });

  describe('a single oversize document', () => {
    it('becomes a stub with its _id and size, counted as returned and as a byte cut', async () => {
      const huge = { _id: new ObjectId('507f1f77bcf86cd799439011'), blob: 'x'.repeat(5_000) };
      const bytes = Buffer.byteLength(JSON.stringify({ _id: { $oid: '507f1f77bcf86cd799439011' }, blob: huge.blob }));
      const r = await takeWithinBudget([huge], { limit: 10, maxBytes: 1_000 });
      expect(JSON.parse(r.json)).toEqual([{ _id: { $oid: '507f1f77bcf86cd799439011' }, _latelierOmitted: { bytes } }]);
      expect(r).toMatchObject({ count: 1, truncated: true, appliedLimits: ['bytes'] });
    });

    it('does not hide the documents after it', async () => {
      const r = await takeWithinBudget([doc(1), { _id: 2, v: 'x'.repeat(5_000) }, doc(3)], { limit: 10, maxBytes: 1_000 });
      const parsed = JSON.parse(r.json) as Array<Record<string, unknown>>;
      expect(parsed.map((d) => d._id)).toEqual([1, 2, 3]);
      expect(parsed[1]).toHaveProperty('_latelierOmitted');
      expect(parsed[0]).not.toHaveProperty('_latelierOmitted');
      expect(r.appliedLimits).toEqual(['bytes']);
    });

    it('treats a document that is exactly the budget as fitting, and one byte more as oversize', async () => {
      const d = { _id: 1, v: 'x'.repeat(50) };
      const exact = size(d) + 2;
      expect(JSON.parse((await takeWithinBudget([d], { limit: 1, maxBytes: exact })).json)).toEqual([d]);
      const over = await takeWithinBudget([d], { limit: 1, maxBytes: exact - 1 });
      expect(JSON.parse(over.json)[0]).toHaveProperty('_latelierOmitted');
    });

    it('leaves out _id when the document has none, or when it is too large to repeat', async () => {
      const noId = await takeWithinBudget([{ v: 'x'.repeat(5_000) }], { limit: 1, maxBytes: 1_000 });
      expect(JSON.parse(noId.json)).toEqual([{ _latelierOmitted: { bytes: size({ v: 'x'.repeat(5_000) }) } }]);
      const bigId = { _id: 'i'.repeat(2_000), v: 'x'.repeat(5_000) };
      const r = await takeWithinBudget([bigId], { limit: 1, maxBytes: 5_000 });
      expect(Buffer.byteLength(r.json)).toBeLessThan(200);
      expect(JSON.parse(r.json)).toEqual([{ _latelierOmitted: { bytes: size(bigId) } }]);
    });

    it('leaves out an _id EJSON cannot serialise, and copes with a document that is null', async () => {
      const fnId = await takeWithinBudget([{ _id: () => 1, v: 'x'.repeat(5_000) }], { limit: 1, maxBytes: 1_000 });
      expect(JSON.parse(fnId.json)).toEqual([{ _latelierOmitted: { bytes: size({ v: 'x'.repeat(5_000) }) } }]);
      // A null document is oversize only in a budget too small for any stub: it is stopped at, not crashed on.
      const nothing = await takeWithinBudget([null], { limit: 1, maxBytes: 5 });
      expect(nothing).toMatchObject({ json: '[]', count: 0, appliedLimits: ['bytes'] });
    });

    it('keeps an _id of exactly 1024 bytes, and drops one a byte longer', async () => {
      const idOf = (n: number) => 'i'.repeat(n - 2);
      const exact = { _id: idOf(1_024), v: 'x'.repeat(5_000) };
      const kept = await takeWithinBudget([exact], { limit: 1, maxBytes: 6_000 });
      expect(Buffer.byteLength(JSON.stringify(idOf(1_024)))).toBe(1_024);
      expect(JSON.parse(kept.json)[0]._id).toBe(idOf(1_024));
      const longer = { _id: idOf(1_025), v: 'x'.repeat(5_000) };
      const dropped = await takeWithinBudget([longer], { limit: 1, maxBytes: 6_000 });
      expect(JSON.parse(dropped.json)[0]).not.toHaveProperty('_id');
    });

    it('stops rather than overflow when even the stub does not fit beside what is already taken', async () => {
      const r = await takeWithinBudget([doc(1, 100), { _id: 2, v: 'x'.repeat(5_000) }], { limit: 10, maxBytes: 2 + size(doc(1, 100)) + 5 });
      expect(r.count).toBe(1);
      expect(r.appliedLimits).toEqual(['bytes']);
      expect(JSON.parse(r.json)).toEqual([doc(1, 100)]);
    });

    it('reports both reasons when a stub was sent and the limit was hit', async () => {
      const r = await takeWithinBudget([{ _id: 1, v: 'x'.repeat(5_000) }, doc(2)], { limit: 1, maxBytes: 1_000 });
      expect(r.appliedLimits).toEqual(['limit', 'bytes']);
      expect(r.truncated).toBe(true);
    });

    it('reports only the limit when the byte budget never binds', async () => {
      const r = await takeWithinBudget([doc(1), doc(2), doc(3)], { limit: 2, maxBytes: 1_000 });
      expect(r.appliedLimits).toEqual(['limit']);
    });
  });

  describe('Relaxed EJSON', () => {
    it('writes BSON types as their relaxed markers', async () => {
      const r = await takeWithinBudget(
        [
          {
            _id: new ObjectId('507f1f77bcf86cd799439011'),
            when: new Date('2024-01-02T03:04:05.678Z'),
            small: Long.fromNumber(5),
            wide: Long.fromString('9007199254740993'),
            dec: Decimal128.fromString('1.50'),
            nan: Number.NaN,
            inf: Number.POSITIVE_INFINITY,
            re: /ab+c/i,
            nothing: null,
            nested: { arr: [1, { z: 2 }] },
          },
        ],
        { limit: 1 },
      );
      expect(JSON.parse(r.json)[0]).toEqual({
        _id: { $oid: '507f1f77bcf86cd799439011' },
        when: { $date: '2024-01-02T03:04:05.678Z' },
        small: 5,
        wide: { $numberLong: '9007199254740993' },
        dec: { $numberDecimal: '1.50' },
        nan: { $numberDouble: 'NaN' },
        inf: { $numberDouble: 'Infinity' },
        re: { $regularExpression: { pattern: 'ab+c', options: 'i' } },
        nothing: null,
        nested: { arr: [1, { z: 2 }] },
      });
    });

    it('refuses a document EJSON cannot serialise, with an INTERNAL error', async () => {
      await expect(takeWithinBudget([() => 1], { limit: 1 })).rejects.toMatchObject({
        code: 'INTERNAL',
        message: 'a document could not be serialised',
      });
    });
  });

  it('accepts a plain iterable', async () => {
    const r = await takeWithinBudget(new Set([doc(1), doc(2)]), { limit: 5 });
    expect(r.count).toBe(2);
  });
});

describe('describeResult', () => {
  it('states the count, singular and plural, when nothing was cut', () => {
    expect(describeResult({ count: 1, appliedLimits: [] }, 50)).toBe('Returned 1 document.');
    expect(describeResult({ count: 0, appliedLimits: [] }, 50)).toBe('Returned 0 documents.');
    expect(describeResult({ count: 7, appliedLimits: [] }, 50)).toBe('Returned 7 documents.');
  });

  it('names the limit that stopped it', () => {
    expect(describeResult({ count: 50, appliedLimits: ['limit'] }, 50)).toBe(
      'Returned 50 documents; stopped at the limit of 50 documents, so more exist.',
    );
  });

  it('names the size limit', () => {
    expect(describeResult({ count: 3, appliedLimits: ['bytes'] }, 50)).toBe('Returned 3 documents; stopped at the 1 MiB size limit.');
  });

  it('names both reasons', () => {
    expect(describeResult({ count: 1, appliedLimits: ['limit', 'bytes'] }, 1)).toBe(
      'Returned 1 document; stopped at the limit of 1 documents, so more exist and stopped at the 1 MiB size limit.',
    );
  });
});
