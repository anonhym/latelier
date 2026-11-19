import { describe, it, expect, afterEach, vi } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';
import { installAtelierMock, uninstallAtelierMock } from '../helpers/atelierMock';
import { useRowSummary } from '../../src/features/rowSummary/useRowSummary';
import { useReferenceRules } from '../../src/features/references/useReferenceRules';
import { useConnectionFamily } from '../../src/features/connections/useConnectionFamily';
import type { IpcApi } from '@shared/ipc';
import type { EffectiveRowSummary } from '@shared/types';

afterEach(() => uninstallAtelierMock());

const summaryOf = (collection: string): EffectiveRowSummary => ({
  id: collection,
  owner: { connectionId: 'c1' },
  dbName: 'shop',
  collection,
  fields: [collection],
  updatedAt: 'u',
  origin: 'local',
});

describe('settings readers — a slower answer for the previous namespace', () => {
  it('useRowSummary shows nothing of the old Collection while the new one loads, and ignores its late answer', async () => {
    let settleA!: (v: EffectiveRowSummary | null) => void;
    const get = vi.fn<IpcApi['rowSummary']['get']>(({ collection }) =>
      collection === 'a' ? new Promise((res) => { settleA = res; }) : new Promise(() => {}),
    );
    installAtelierMock({ rowSummary: { get } });
    const { result, rerender } = renderHook(({ c }) => useRowSummary('c1', 'shop', c), { initialProps: { c: 'a' } });
    await waitFor(() => expect(get).toHaveBeenCalledTimes(1));
    rerender({ c: 'b' });
    await waitFor(() => expect(get).toHaveBeenCalledTimes(2));
    await act(async () => settleA(summaryOf('a')));
    expect(result.current.summary).toBeNull();
    expect(result.current.loaded).toBe(false);
  });

  it('useReferenceRules ignores a late answer for the previous Collection', async () => {
    let settleA!: (v: never[]) => void;
    const list = vi.fn<IpcApi['refs']['list']>((input) =>
      'collection' in input && input.collection === 'a' ? new Promise((res) => { settleA = res as never; }) : Promise.resolve([{ id: 'rb', enabled: true, sourceField: 'f' } as never]),
    );
    installAtelierMock({ refs: { list } });
    const { result, rerender } = renderHook(({ c }) => useReferenceRules('c1', 'shop', c), { initialProps: { c: 'a' } });
    await waitFor(() => expect(list).toHaveBeenCalledTimes(1));
    rerender({ c: 'b' });
    await waitFor(() => expect(result.current.rules.map((r) => r.id)).toEqual(['rb']));
    await act(async () => settleA([{ id: 'ra', enabled: true, sourceField: 'f' } as never]));
    expect(result.current.rules.map((r) => r.id)).toEqual(['rb']);
  });
});

describe('useConnectionFamily', () => {
  it('does not offer the previous Connection\'s Family to the next one, whether its read is slow or fails', async () => {
    const list = vi
      .fn<IpcApi['families']['list']>()
      .mockResolvedValueOnce([{ id: 'f1', name: 'Prod', memberIds: ['c1'], createdAt: 'x', updatedAt: 'x' }])
      .mockRejectedValueOnce(new Error('boom'));
    installAtelierMock({ families: { list } });
    const { result, rerender } = renderHook(({ c }) => useConnectionFamily(c), { initialProps: { c: 'c1' } });
    await waitFor(() => expect(result.current).toEqual({ id: 'f1', name: 'Prod' }));
    rerender({ c: 'c2' });
    expect(result.current).toBeNull();
    await waitFor(() => expect(list).toHaveBeenCalledTimes(2));
    expect(result.current).toBeNull();
  });
});
