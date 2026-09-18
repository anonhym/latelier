// @vitest-environment jsdom
//
// Same jsdom-opt-in as useRovingFocus.spec.ts: this hook has real branching
// (`if (!menu?.returnFocusTo) return;`) and its coverage is a `renderHook`
// against plain `document.createElement` nodes — fast and deterministic, no
// full component mount needed.
import { describe, it, expect } from 'vitest';
import { renderHook } from '../helpers/render';
import { useKeyboardMenuFocus } from '../../src/hooks/useKeyboardMenuFocus';

if (typeof window.matchMedia !== 'function') {
  window.matchMedia = (query: string): MediaQueryList => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => false,
  });
}

/** A menu container with one focusable button inside, mounted in the document
 *  (jsdom only tracks `document.activeElement` for attached nodes). */
function mountMenu() {
  const container = document.createElement('div');
  const button = document.createElement('button');
  container.appendChild(button);
  document.body.appendChild(container);
  return { container, button };
}

function mountTrigger() {
  const trigger = document.createElement('button');
  document.body.appendChild(trigger);
  return trigger;
}

describe('useKeyboardMenuFocus', () => {
  it('is a no-op with no menu — a mouse-driven open never calls this at all', () => {
    const { container, button } = mountMenu();
    const trigger = mountTrigger();
    trigger.focus();

    renderHook(() => useKeyboardMenuFocus({ current: container }, null));

    expect(document.activeElement).toBe(trigger);
    expect(document.activeElement).not.toBe(button);
  });

  it('is a no-op when the menu has no returnFocusTo — a mouse-driven right-click', () => {
    const { container, button } = mountMenu();
    const trigger = mountTrigger();
    trigger.focus();

    renderHook(() => useKeyboardMenuFocus({ current: container }, { returnFocusTo: null }));

    expect(document.activeElement).toBe(trigger);
    expect(document.activeElement).not.toBe(button);
  });

  it('focuses the menu\'s first button on a keyboard-driven open', () => {
    const { container, button } = mountMenu();
    const trigger = mountTrigger();
    trigger.focus();

    renderHook(() => useKeyboardMenuFocus({ current: container }, { returnFocusTo: trigger }));

    expect(document.activeElement).toBe(button);
  });

  it('returns focus to returnFocusTo once the menu closes', () => {
    const { container, button } = mountMenu();
    const trigger = mountTrigger();

    type Props = { menu: { returnFocusTo?: HTMLElement | null } | null };
    const { rerender } = renderHook<void, Props>(
      ({ menu }) => useKeyboardMenuFocus({ current: container }, menu),
      { initialProps: { menu: { returnFocusTo: trigger } } },
    );
    expect(document.activeElement).toBe(button);

    rerender({ menu: null });

    expect(document.activeElement).toBe(trigger);
  });

  // `menuRef.current` is `null` on the first render before the DOM ref
  // callback runs — a keyboard open that reaches this hook before the menu's
  // node has attached must not throw.
  it('does not throw when the menu ref has not attached yet', () => {
    const trigger = mountTrigger();

    expect(() =>
      renderHook(() => useKeyboardMenuFocus({ current: null }, { returnFocusTo: trigger })),
    ).not.toThrow();
  });

  // A menu that (however transiently) renders no `<button>` at all — the
  // `querySelector` miss must not throw either.
  it('does not throw when the menu has no button to focus', () => {
    const container = document.createElement('div');
    document.body.appendChild(container);
    const trigger = mountTrigger();

    expect(() =>
      renderHook(() => useKeyboardMenuFocus({ current: container }, { returnFocusTo: trigger })),
    ).not.toThrow();
  });
});
