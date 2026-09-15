import { describe, it, expect, afterEach, vi } from 'vitest';
import React from 'react';
import { render, waitFor, act } from '../helpers/render';
import { useTheme, type ThemeMode } from '../../src/ThemeContext';
import { installAtelierMock, uninstallAtelierMock } from '../helpers/atelierMock';

interface Captured {
  dark: boolean;
  toggle: () => void;
}

function Probe({ onChange }: { onChange: (s: Captured) => void }) {
  const [dark, toggle] = useTheme();
  React.useEffect(() => {
    onChange({ dark, toggle });
  }, [dark, toggle, onChange]);
  return null;
}

describe('useTheme (renderer)', () => {
  afterEach(() => {
    uninstallAtelierMock();
    try {
      localStorage.clear();
    } catch {
      /* ignore */
    }
  });

  it('migrates legacy localStorage value into prefs and clears it', async () => {
    localStorage.setItem('ml-theme', 'dark');
    const setTheme = vi.fn(async () => undefined);
    installAtelierMock({
      prefs: {
        getTheme: async () => 'dark',
        setTheme,
        onThemeChanged: () => () => {},
      },
    });

    render(<Probe onChange={() => {}} />);

    await waitFor(() => {
      expect(setTheme).toHaveBeenCalledWith('dark');
    });
    expect(localStorage.getItem('ml-theme')).toBeNull();
  });

  it('reacts to onThemeChanged broadcasts from main', async () => {
    let broadcast: ((mode: ThemeMode) => void) | null = null;
    installAtelierMock({
      prefs: {
        getTheme: async () => 'light',
        setTheme: async () => undefined,
        onThemeChanged: (cb) => {
          broadcast = cb;
          return () => {};
        },
      },
    });

    const states: Captured[] = [];
    render(<Probe onChange={(s) => states.push(s)} />);

    await waitFor(() => {
      expect(broadcast).not.toBeNull();
    });

    act(() => broadcast!('dark'));
    await waitFor(() => {
      expect(states.at(-1)?.dark).toBe(true);
    });
  });
});
