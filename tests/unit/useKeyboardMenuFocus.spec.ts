// @vitest-environment jsdom
//
// Same jsdom-opt-in as useRovingFocus.spec.ts: this hook has real branching
// (`if (!menu?.returnFocusTo) return;`, `if (focusMenuOnOpen) ...`) and its
// coverage is a `renderHook` against plain `document.createElement` nodes —
// fast and deterministic, no full component mount needed.
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

  it('focuses the menu\'s first button when focusMenuOnOpen is set (a keyboard-driven open)', () => {
    const { container, button } = mountMenu();
    const trigger = mountTrigger();
    trigger.focus();

    renderHook(() =>
      useKeyboardMenuFocus(
        { current: container },
        { returnFocusTo: trigger, focusMenuOnOpen: true },
      ),
    );

    expect(document.activeElement).toBe(button);
  });

  // #69 — `returnFocusTo` is now set on a mouse-driven right-click too (so
  // Escape/click-away has somewhere to restore focus to), but that open
  // itself must not steal focus into the menu the way a keyboard open does.
  // `focusMenuOnOpen` is the flag that keeps those two independent.
  it('does not grab focus into the menu when focusMenuOnOpen is unset, even with returnFocusTo present (a mouse-driven right-click)', () => {
    const { container, button } = mountMenu();
    const trigger = mountTrigger();
    trigger.focus();

    renderHook(() =>
      useKeyboardMenuFocus({ current: container }, { returnFocusTo: trigger }),
    );

    expect(document.activeElement).toBe(trigger);
    expect(document.activeElement).not.toBe(button);
  });

  it('returns focus to returnFocusTo once a keyboard-opened menu closes', () => {
    const { container, button } = mountMenu();
    const trigger = mountTrigger();

    type Props = {
      menu: { returnFocusTo?: HTMLElement | null; focusMenuOnOpen?: boolean } | null;
    };
    const { rerender } = renderHook<void, Props>(
      ({ menu }) => useKeyboardMenuFocus({ current: container }, menu),
      { initialProps: { menu: { returnFocusTo: trigger, focusMenuOnOpen: true } } },
    );
    expect(document.activeElement).toBe(button);

    rerender({ menu: null });

    expect(document.activeElement).toBe(trigger);
  });

  // #69's actual fix, at this hook's own level: a mouse-driven open never
  // grabs focus into the menu (previous test), but closing it still must
  // restore focus — this is the half that used to strand it on `<body>`.
  it('returns focus to returnFocusTo once a mouse-opened menu closes, despite never having grabbed it', () => {
    const { container } = mountMenu();
    const trigger = mountTrigger();
    trigger.focus();

    type Props = {
      menu: { returnFocusTo?: HTMLElement | null; focusMenuOnOpen?: boolean } | null;
    };
    const { rerender } = renderHook<void, Props>(
      ({ menu }) => useKeyboardMenuFocus({ current: container }, menu),
      { initialProps: { menu: { returnFocusTo: trigger } } },
    );
    expect(document.activeElement).toBe(trigger);

    rerender({ menu: null });

    expect(document.activeElement).toBe(trigger);
  });

  // `menuRef.current` is `null` on the first render before the DOM ref
  // callback runs — a keyboard open that reaches this hook before the menu's
  // node has attached must not throw.
  it('does not throw when the menu ref has not attached yet', () => {
    const trigger = mountTrigger();

    expect(() =>
      renderHook(() =>
        useKeyboardMenuFocus(
          { current: null },
          { returnFocusTo: trigger, focusMenuOnOpen: true },
        ),
      ),
    ).not.toThrow();
  });

  // A menu that (however transiently) renders no `<button>` at all — the
  // `querySelector` miss must not throw either.
  it('does not throw when the menu has no button to focus', () => {
    const container = document.createElement('div');
    document.body.appendChild(container);
    const trigger = mountTrigger();

    expect(() =>
      renderHook(() =>
        useKeyboardMenuFocus(
          { current: container },
          { returnFocusTo: trigger, focusMenuOnOpen: true },
        ),
      ),
    ).not.toThrow();
  });
});
