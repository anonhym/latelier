import { describe, it, expect, afterEach, vi } from 'vitest';
import { render } from '../helpers/render';
import { FlushOnQuit } from '../../src/features/lifecycle/FlushOnQuit';
import { registerFlusher } from '../../src/state/pendingFlush';
import { installAtelierMock, uninstallAtelierMock } from '../helpers/atelierMock';

// Main asks before it quits; the page answers once every held-back edit is out.

afterEach(() => {
  uninstallAtelierMock();
  vi.restoreAllMocks();
});

function mount() {
  let request: (() => void) | null = null;
  const unsubscribe = vi.fn();
  const flushDone = vi.fn(async () => {});
  installAtelierMock({
    app: {
      onFlushRequest: (cb: () => void) => {
        request = cb;
        return unsubscribe;
      },
      flushDone,
    },
  });
  const view = render(<FlushOnQuit />);
  return {
    view,
    flushDone,
    unsubscribe,
    fire: () => {
      if (!request) throw new Error('FlushOnQuit did not subscribe');
      request();
    },
  };
}

describe('FlushOnQuit', () => {
  it('answers only after every registered flusher has finished', async () => {
    let release: () => void = () => {};
    const flusher = vi.fn(() => new Promise<void>((resolve) => { release = resolve; }));
    const unregister = registerFlusher(flusher);
    try {
      const { fire, flushDone } = mount();
      fire();
      expect(flusher).toHaveBeenCalledTimes(1);
      await new Promise((r) => setTimeout(r, 0));
      expect(flushDone).not.toHaveBeenCalled();

      release();
      await vi.waitFor(() => expect(flushDone).toHaveBeenCalledTimes(1));
    } finally {
      unregister();
    }
  });

  it('answers even when nothing is registered', async () => {
    const { fire, flushDone } = mount();
    fire();
    await vi.waitFor(() => expect(flushDone).toHaveBeenCalledTimes(1));
  });

  it('unsubscribes when it unmounts', () => {
    const { view, unsubscribe } = mount();
    expect(unsubscribe).not.toHaveBeenCalled();
    view.unmount();
    expect(unsubscribe).toHaveBeenCalledTimes(1);
  });
});
