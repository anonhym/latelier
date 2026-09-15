import React from 'react';
import { api } from '../../api/atelier';
import { BUILDER_DEFAULT_PCT } from './panelSizes';

export function useWorkspacePanelPrefs(): {
  prefsReady: boolean;
  leftWidth: number;
  setLeftWidth: React.Dispatch<React.SetStateAction<number>>;
  commitLeftWidth: (v: number) => void;
  refDrawerWidth: number;
  setRefDrawerWidth: React.Dispatch<React.SetStateAction<number>>;
  commitRefDrawerWidth: (v: number) => void;
  innerHSplit: number;
  commitInnerHSplit: (v: number) => void;
  shellSplit: number;
  commitShellSplit: (v: number) => void;
  sidebarCollapsed: boolean;
  toggleSidebar: () => void;
  builderCollapsed: boolean;
  commitBuilderCollapsed: (next: boolean) => void;
} {
  const [leftWidth, setLeftWidth] = React.useState(206);
  // Pixels, not a percentage: a plain flex column resized via the bespoke ResizeHandle, not a react-resizable-panels Panel.
  const [refDrawerWidth, setRefDrawerWidth] = React.useState(380);
  const [innerHSplit, setInnerHSplit] = React.useState(BUILDER_DEFAULT_PCT);
  const [shellSplit, setShellSplit] = React.useState(25);
  // Panels render with default sizes immediately; the key flip on ready re-mounts with persisted sizes, avoiding a layout shift.
  const [prefsReady, setPrefsReady] = React.useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = React.useState(false);
  const [builderCollapsed, setBuilderCollapsed] = React.useState(false);

  React.useEffect(() => {
    let active = true;
    void (async () => {
      try {
        const [l, rdw, ihs, ss, collapsed, builderC] = await Promise.all([
          api.prefs.get<number>('ui.workspace.leftWidth'),
          api.prefs.get<number>('ui.workspace.refDrawerWidth'),
          api.prefs.get<number>('ui.workspace.innerHSplit'),
          api.prefs.get<number>('ui.workspace.shellSplit'),
          api.prefs.get<boolean>('ui.workspace.sidebarCollapsed'),
          api.prefs.get<boolean>('ui.workspace.builderCollapsed'),
        ]);
        if (!active) return;
        if (typeof l === 'number') setLeftWidth(l);
        if (typeof rdw === 'number') setRefDrawerWidth(rdw);
        if (typeof ihs === 'number') setInnerHSplit(ihs);
        if (typeof ss === 'number') setShellSplit(ss);
        if (typeof collapsed === 'boolean') setSidebarCollapsed(collapsed);
        if (typeof builderC === 'boolean') setBuilderCollapsed(builderC);
      } catch {
        // keep defaults
      } finally {
        if (active) setPrefsReady(true);
      }
    })();
    return () => {
      active = false;
    };
  }, []);

  const toggleSidebar = React.useCallback(() => {
    const next = !sidebarCollapsed;
    setSidebarCollapsed(next);
    void api.prefs.set('ui.workspace.sidebarCollapsed', next).catch(() => {});
  }, [sidebarCollapsed]);

  const commitLeftWidth = React.useCallback((v: number) => {
    void api.prefs.set('ui.workspace.leftWidth', v).catch(() => {});
  }, []);

  const commitRefDrawerWidth = React.useCallback((v: number) => {
    void api.prefs.set('ui.workspace.refDrawerWidth', v).catch(() => {});
  }, []);

  const commitShellSplit = React.useCallback((v: number) => {
    setShellSplit(v);
    void api.prefs.set('ui.workspace.shellSplit', v).catch(() => {});
  }, []);

  const commitInnerHSplit = React.useCallback((v: number) => {
    setInnerHSplit(v);
    void api.prefs.set('ui.workspace.innerHSplit', v).catch(() => {});
  }, []);

  const commitBuilderCollapsed = React.useCallback((next: boolean) => {
    setBuilderCollapsed(next);
    void api.prefs.set('ui.workspace.builderCollapsed', next).catch(() => {});
  }, []);

  return {
    prefsReady,
    leftWidth,
    setLeftWidth,
    commitLeftWidth,
    refDrawerWidth,
    setRefDrawerWidth,
    commitRefDrawerWidth,
    innerHSplit,
    commitInnerHSplit,
    shellSplit,
    commitShellSplit,
    sidebarCollapsed,
    toggleSidebar,
    builderCollapsed,
    commitBuilderCollapsed,
  };
}
