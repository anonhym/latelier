import { describe, it, expect, afterEach, vi } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';
import { installAtelierMock, uninstallAtelierMock } from '../helpers/atelierMock';
import { notifyReferenceRulesChanged, useReferenceRules } from '../../src/features/references/useReferenceRules';
import type { IpcApi } from '@shared/ipc';

afterEach(() => uninstallAtelierMock());

describe('useReferenceRules — a Family change', () => {
  it('re-asks for the effective rules when a Family change is announced, and stops after unmount', async () => {
    const list = vi.fn<IpcApi['refs']['list']>(async () => []);
    installAtelierMock({ refs: { list } });
    const { unmount } = renderHook(() => useReferenceRules('c1', 'shop', 'orders'));
    await waitFor(() => expect(list).toHaveBeenCalledTimes(1));

    act(() => notifyReferenceRulesChanged());
    await waitFor(() => expect(list).toHaveBeenCalledTimes(2));
    expect(list.mock.calls[1]![0]).toEqual({ connectionId: 'c1', dbName: 'shop', collection: 'orders', effective: true });

    unmount();
    act(() => notifyReferenceRulesChanged());
    expect(list).toHaveBeenCalledTimes(2);
  });
});
