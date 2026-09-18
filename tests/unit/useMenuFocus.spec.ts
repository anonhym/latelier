// @vitest-environment jsdom
//
// Same jsdom-opt-in as useRovingFocus.spec.ts: this hook has real branching
// and its coverage is a `renderHook` against plain `document.createElement`
// nodes — fast and deterministic, no full component mount needed.
import { describe, it, expect, vi } from 'vitest';
import userEvent from '@testing-library/user-event';
import { renderHook } from '../helpers/render';
import { useMenuFocus } from '../../src/hooks/useMenuFocus';

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

type Menu = { returnFocusTo?: HTMLElement | null; focusMenuOnOpen?: boolean } | null;
type Props = { menu: Menu; close: () => void };

describe('useMenuFocus', () => {
  // --- open-time focus grab (carried over from useKeyboardMenuFocus) ---

  it('is a no-op with no menu — a mouse-driven open never calls this at all', () => {
    const { container, button } = mountMenu();
    const trigger = mountTrigger();
    trigger.focus();

    renderHook(() => useMenuFocus({ current: container }, null, () => {}));

    expect(document.activeElement).toBe(trigger);
    expect(document.activeElement).not.toBe(button);
  });

  it('is a no-op when the menu has no returnFocusTo — a mouse-driven right-click', () => {
    const { container, button } = mountMenu();
    const trigger = mountTrigger();
    trigger.focus();

    renderHook(() =>
      useMenuFocus({ current: container }, { returnFocusTo: null }, () => {}),
    );

    expect(document.activeElement).toBe(trigger);
    expect(document.activeElement).not.toBe(button);
  });

  it("focuses the menu's first button when focusMenuOnOpen is set (a keyboard-driven open)", () => {
    const { container, button } = mountMenu();
    const trigger = mountTrigger();
    trigger.focus();

    renderHook(() =>
      useMenuFocus(
        { current: container },
        { returnFocusTo: trigger, focusMenuOnOpen: true },
        () => {},
      ),
    );

    expect(document.activeElement).toBe(button);
  });

  it('does not grab focus into the menu when focusMenuOnOpen is unset, even with returnFocusTo present (a mouse-driven right-click)', () => {
    const { container, button } = mountMenu();
    const trigger = mountTrigger();
    trigger.focus();

    renderHook(() =>
      useMenuFocus({ current: container }, { returnFocusTo: trigger }, () => {}),
    );

    expect(document.activeElement).toBe(trigger);
    expect(document.activeElement).not.toBe(button);
  });

  // --- close-time restore, unconditional case (carried over) ---

  it('returns focus to returnFocusTo once a keyboard-opened menu closes', () => {
    const { container, button } = mountMenu();
    const trigger = mountTrigger();

    const { rerender } = renderHook<void, Props>(
      ({ menu }) => useMenuFocus({ current: container }, menu, () => {}),
      { initialProps: { menu: { returnFocusTo: trigger, focusMenuOnOpen: true }, close: () => {} } },
    );
    expect(document.activeElement).toBe(button);

    rerender({ menu: null, close: () => {} });

    expect(document.activeElement).toBe(trigger);
  });

  it('returns focus to returnFocusTo once a mouse-opened menu closes, despite never having grabbed it', () => {
    const { container } = mountMenu();
    const trigger = mountTrigger();
    trigger.focus();

    const { rerender } = renderHook<void, Props>(
      ({ menu }) => useMenuFocus({ current: container }, menu, () => {}),
      { initialProps: { menu: { returnFocusTo: trigger }, close: () => {} } },
    );
    expect(document.activeElement).toBe(trigger);

    rerender({ menu: null, close: () => {} });

    expect(document.activeElement).toBe(trigger);
  });

  it('does not throw when the menu ref has not attached yet', () => {
    const trigger = mountTrigger();

    expect(() =>
      renderHook(() =>
        useMenuFocus(
          { current: null },
          { returnFocusTo: trigger, focusMenuOnOpen: true },
          () => {},
        ),
      ),
    ).not.toThrow();
  });

  it('does not throw when the menu has no button to focus', () => {
    const container = document.createElement('div');
    document.body.appendChild(container);
    const trigger = mountTrigger();

    expect(() =>
      renderHook(() =>
        useMenuFocus(
          { current: container },
          { returnFocusTo: trigger, focusMenuOnOpen: true },
          () => {},
        ),
      ),
    ).not.toThrow();
  });

  // --- #87: replacement must not fire the restore ---

  it('replacing an open menu with another open (no close in between) never calls returnFocusTo.focus()', () => {
    const { container } = mountMenu();
    const triggerA = mountTrigger();
    const triggerB = mountTrigger();
    const focusSpyA = vi.spyOn(triggerA, 'focus');
    const focusSpyB = vi.spyOn(triggerB, 'focus');

    const { rerender } = renderHook<void, Props>(
      ({ menu }) => useMenuFocus({ current: container }, menu, () => {}),
      { initialProps: { menu: { returnFocusTo: triggerA }, close: () => {} } },
    );

    rerender({ menu: { returnFocusTo: triggerB }, close: () => {} });

    expect(focusSpyA).not.toHaveBeenCalled();
    expect(focusSpyB).not.toHaveBeenCalled();
  });

  // #87's actual regression target: a naive "do nothing on replace" fix
  // would also silently stop grabbing focus into a *replacement* keyboard
  // open. `focusMenuOnOpen` must still fire every time it's set, replacement
  // included.
  it('still grabs focus into the menu on a replacement keyboard open', () => {
    const { container, button } = mountMenu();
    const triggerA = mountTrigger();
    const triggerB = mountTrigger();

    const { rerender } = renderHook<void, Props>(
      ({ menu }) => useMenuFocus({ current: container }, menu, () => {}),
      {
        initialProps: {
          menu: { returnFocusTo: triggerA, focusMenuOnOpen: true },
          close: () => {},
        },
      },
    );
    expect(document.activeElement).toBe(button);

    // Simulate the container being reused for the new menu's own button
    // (the real call sites keep the same DOM node across a replacement).
    button.focus();
    triggerB.focus();
    rerender({
      menu: { returnFocusTo: triggerB, focusMenuOnOpen: true },
      close: () => {},
    });

    expect(document.activeElement).toBe(button);
  });

  // --- #87: suppress-on-outside-click, and its staleness across a replace ---

  describe('outside-click suppression (#87)', () => {
    it('suppresses the restore when a window click lands on another focusable control', async () => {
      const user = userEvent.setup();
      const { container } = mountMenu();
      const trigger = mountTrigger();
      const elsewhere = mountTrigger();
      const close = vi.fn();

      renderHook(() =>
        useMenuFocus({ current: container }, { returnFocusTo: trigger }, close),
      );

      await user.click(elsewhere);

      expect(close).toHaveBeenCalledTimes(1);
      expect(document.activeElement).toBe(elsewhere);
    });

    it('restores when a window click lands on nothing focusable (activeElement falls back to <body>)', async () => {
      const user = userEvent.setup();
      const { container } = mountMenu();
      const trigger = mountTrigger();
      const plain = document.createElement('div');
      document.body.appendChild(plain);
      let menu: Menu = { returnFocusTo: trigger };
      const close = () => {
        menu = null;
        rerender({ menu, close });
      };

      const { rerender } = renderHook<void, Props>(
        ({ menu: m }) => useMenuFocus({ current: container }, m, close),
        { initialProps: { menu, close } },
      );

      await user.click(plain);

      expect(document.activeElement).toBe(trigger);
    });

    it('Escape always restores, ignoring any suppression an earlier click set', async () => {
      const user = userEvent.setup();
      const { container } = mountMenu();
      const trigger = mountTrigger();
      const elsewhere = mountTrigger();
      let menu: Menu = { returnFocusTo: trigger };
      const close = () => {
        menu = null;
        rerender({ menu, close });
      };

      const { rerender } = renderHook<void, Props>(
        ({ menu: m }) => useMenuFocus({ current: container }, m, close),
        { initialProps: { menu, close } },
      );

      await user.keyboard('{Escape}');
      expect(document.activeElement).toBe(trigger);

      // A suppressed close, followed by a reopen, followed by Escape, still
      // restores — but this does NOT on its own prove the reopen resets
      // `suppressRef`. `onKey` clears the flag itself (`suppressRef.current
      // = false` before calling `close()`), so this sequence passes the
      // same way whether or not the reopen's own reset exists — it
      // exercises Escape's own override, not the reset-on-open. The reset
      // is pinned instead by the component-level "a suppressed close does
      // not strand focus after the menu reopens and an item is activated"
      // test (`add-to-filter-menu.spec.tsx`), whose close path — an item's
      // own `onClick` calling `setContextMenu(null)` directly — does not
      // recompute the flag the way `onKey`/`onClick` do, so it is the one
      // path that actually depends on the reopen clearing it.
      elsewhere.focus();
      menu = { returnFocusTo: trigger };
      rerender({ menu, close });
      await user.click(elsewhere); // suppresses
      expect(document.activeElement).toBe(elsewhere);

      menu = { returnFocusTo: trigger };
      rerender({ menu, close });
      await user.keyboard('{Escape}');
      expect(document.activeElement).toBe(trigger);
    });
  });
});
