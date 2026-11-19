import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

vi.mock('../../src/theme/notifications', () => ({
  notify: { success: vi.fn(), error: vi.fn() },
}));

import { copyToClipboard } from '../../src/utils/clipboard';
import {
  clearCopyOrigin,
  copySourceOf,
  getCopyOrigin,
  recordCopyOrigin,
  sourceFieldPathOf,
  withFieldPath,
} from '../../src/utils/copyOrigin';
import { notify } from '../../src/theme/notifications';

const A = { connectionId: 'conn-a', dbName: 'shop', collection: 'orders' };
const B = { connectionId: 'conn-b', dbName: 'crm', collection: 'users' };
const ID = '507f1f77bcf86cd799439011';

function stubClipboard(writeText: (t: string) => Promise<void>) {
  vi.stubGlobal('navigator', { clipboard: { writeText } });
}

beforeEach(() => clearCopyOrigin());
afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe('Copy Origin store', () => {
  it('holds nothing at first', () => {
    expect(getCopyOrigin()).toBeNull();
  });

  it('records the source, the text and the distinctive values extracted from it', () => {
    recordCopyOrigin(A, `ObjectId("${ID}")`);
    expect(getCopyOrigin()).toEqual({ ...A, text: `ObjectId("${ID}")`, distinctive: [ID], seq: expect.any(Number) });
    expect(getCopyOrigin()).not.toHaveProperty('fieldPath');
  });

  it('keeps only the most recent copy', () => {
    recordCopyOrigin(A, ID);
    recordCopyOrigin(B, 'a-longer-value');
    expect(getCopyOrigin()).toMatchObject({ ...B, text: 'a-longer-value' });
  });

  it('clearCopyOrigin forgets it', () => {
    recordCopyOrigin(A, ID);
    clearCopyOrigin();
    expect(getCopyOrigin()).toBeNull();
  });

  it('copySourceOf keeps the three identity fields and nothing else', () => {
    expect(copySourceOf({ ...A, tabId: 't1', isLoading: false } as typeof A)).toEqual(A);
  });
});

describe('Copy Origin field path and seq', () => {
  it('records the field the text came from', () => {
    recordCopyOrigin({ ...A, fieldPath: 'customerId' }, ID);
    expect(getCopyOrigin()).toMatchObject({ ...A, fieldPath: 'customerId' });
  });

  it('gives every recorded copy a new seq, even after a clear', () => {
    recordCopyOrigin(A, ID);
    const first = getCopyOrigin()!.seq;
    recordCopyOrigin(A, ID);
    const second = getCopyOrigin()!.seq;
    clearCopyOrigin();
    recordCopyOrigin(A, ID);
    expect(second).toBeGreaterThan(first);
    expect(getCopyOrigin()!.seq).toBeGreaterThan(second);
  });

  it('a path through an array names no field', () => {
    expect(sourceFieldPathOf('customerId')).toBe('customerId');
    expect(sourceFieldPathOf('address.city')).toBe('address.city');
    expect(sourceFieldPathOf('items.0.sku')).toBeUndefined();
    expect(sourceFieldPathOf('items.12')).toBeUndefined();
    expect(sourceFieldPathOf('a1.b2')).toBe('a1.b2');
    expect(sourceFieldPathOf('1a.b')).toBe('1a.b');
    expect(sourceFieldPathOf('')).toBeUndefined();
  });

  it('withFieldPath adds the path to the three identity fields, or nothing without an origin', () => {
    expect(withFieldPath({ ...A, tabId: 't1' } as typeof A, '_id')).toEqual({ ...A, fieldPath: '_id' });
    expect(withFieldPath(A, 'items.0')).toStrictEqual(A);
    expect(withFieldPath(undefined, '_id')).toBeUndefined();
  });
});

describe('copyToClipboard and the Copy Origin', () => {
  it('replaces the origin after a successful write that passes one', async () => {
    stubClipboard(async () => undefined);
    recordCopyOrigin(B, 'older-value-here');
    expect(await copyToClipboard(ID, undefined, A)).toBe(true);
    expect(getCopyOrigin()).toMatchObject({ ...A, text: ID });
  });

  it('clears the origin on a successful write that passes none', async () => {
    stubClipboard(async () => undefined);
    recordCopyOrigin(A, ID);
    expect(await copyToClipboard('shop.orders')).toBe(true);
    expect(getCopyOrigin()).toBeNull();
  });

  it('leaves the origin unchanged when the write fails, with or without an origin', async () => {
    stubClipboard(async () => {
      throw new Error('denied');
    });
    recordCopyOrigin(B, 'older-value-here');
    const before = getCopyOrigin();
    expect(await copyToClipboard(ID, undefined, A)).toBe(false);
    expect(getCopyOrigin()).toBe(before);
    expect(await copyToClipboard('shop.orders')).toBe(false);
    expect(getCopyOrigin()).toBe(before);
    expect(notify.error).toHaveBeenCalledTimes(2);
  });

  it('records the origin before nothing else observes the success message', async () => {
    stubClipboard(async () => undefined);
    await copyToClipboard(ID, 'Copied', A);
    expect(notify.success).toHaveBeenCalledOnce();
    expect(getCopyOrigin()).not.toBeNull();
  });
});
