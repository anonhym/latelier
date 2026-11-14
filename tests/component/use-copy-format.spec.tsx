import { describe, it, expect, vi } from 'vitest';
import { act, renderHook } from '../helpers/render';
import { installAtelierMock } from '../helpers/atelierMock';
import { resetCopyFormatStore, useCopyFormat } from '../../src/pages/Workspace/views/useCopyFormat';

function deferredGet() {
  let resolve: (v: unknown) => void = () => {};
  const get = vi.fn(() => new Promise((r) => { resolve = r; }));
  const set = vi.fn(async (_k: string, v: unknown) => v);
  installAtelierMock({ prefs: { get, set } } as Parameters<typeof installAtelierMock>[0]);
  return { resolve: (v: unknown) => resolve(v), set };
}

describe('useCopyFormat', () => {
  it('keeps a pick made before the stored value arrives', async () => {
    const stored = deferredGet();
    const { result } = renderHook(() => useCopyFormat());
    act(() => result.current[1]('canonical'));
    await act(async () => stored.resolve('mongosh'));
    expect(result.current[0]).toBe('canonical');
    expect(stored.set).toHaveBeenCalledWith('ui.workspace.copyFormat', 'canonical');
  });

  it('takes the stored value when nothing was picked', async () => {
    const stored = deferredGet();
    const { result } = renderHook(() => useCopyFormat());
    expect(result.current[0]).toBe('readable');
    await act(async () => stored.resolve('mongosh'));
    expect(result.current[0]).toBe('mongosh');
  });

  it('a reset returns to the default and drops a read still in flight', async () => {
    const stored = deferredGet();
    const first = renderHook(() => useCopyFormat());
    act(() => first.result.current[1]('canonical'));
    first.unmount();
    resetCopyFormatStore();
    const again = deferredGet();
    const second = renderHook(() => useCopyFormat());
    expect(second.result.current[0]).toBe('readable');
    await act(async () => stored.resolve('mongosh'));
    expect(second.result.current[0]).toBe('readable');
    await act(async () => again.resolve('canonical'));
    expect(second.result.current[0]).toBe('canonical');
  });
});
