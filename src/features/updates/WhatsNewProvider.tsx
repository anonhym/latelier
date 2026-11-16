import React from 'react';
import { api } from '../../api/atelier';
import { usePaletteOpen } from '../../commands/paletteOpenState';
import { useHints } from '../../hints/HintsContext';
import { readLaunchTabCount, useRestoreHintSettled } from '../../hints/launchRestore';
import { logFailure } from '../../utils/rendererLog';
import { BUNDLED_RELEASES } from './bundledChangelog';
import { compareVersions, isVersion, releasesBetween, type Release } from './changelog';
import { WhatsNewContext, type WhatsNewControls } from './whatsNewContext';
import { WhatsNewWindow } from './WhatsNewWindow';

const LAST_SEEN_KEY = 'whatsNew.lastSeenVersion';

interface Showing {
  releases: Release[];
  from: string | null;
}

export interface WhatsNewProviderProps {
  children: React.ReactNode;
  /** The running version; tests pass their own. */
  currentVersion?: string;
  /** The parsed changelog; tests pass their own. */
  releases?: Release[];
}

/**
 * Decides, once per launch, whether the What's new window opens (X22 §6.2),
 * and offers `useWhatsNew().open()` to reopen it for the current release.
 */
export function WhatsNewProvider({
  children,
  currentVersion = __APP_VERSION__,
  releases = BUNDLED_RELEASES,
}: WhatsNewProviderProps) {
  const hints = useHints();
  const paletteOpen = usePaletteOpen();
  // The launch-time decision to show, and whether the launch-time layers have
  // cleared for it. Once cleared it stays cleared: a palette opened over the
  // window later must not hide it.
  const [pending, setPending] = React.useState<Showing | null>(null);
  const [released, setReleased] = React.useState(false);
  // A reopen from Settings or the palette, which has nothing to wait for.
  const [manual, setManual] = React.useState<Showing | null>(null);

  const storeCurrent = React.useCallback(() => {
    api.prefs
      .set(LAST_SEEN_KEY, currentVersion)
      .catch((err) => logFailure('saving the last seen version', err));
  }, [currentVersion]);

  React.useEffect(() => {
    let cancelled = false;
    api.prefs
      .get<unknown>(LAST_SEEN_KEY)
      .then((stored) => {
        if (cancelled) return;
        if (typeof stored !== 'string' || !isVersion(stored)) {
          // A fresh install (or a value nothing here wrote): nothing to show.
          storeCurrent();
          return;
        }
        const order = compareVersions(stored, currentVersion);
        if (order > 0) {
          storeCurrent();
        } else if (order < 0) {
          const range = releasesBetween(releases, stored, currentVersion);
          if (range.length === 0) storeCurrent();
          else setPending({ releases: range, from: stored });
        }
      })
      // An unreadable preference opens nothing, and stores nothing, so the next launch decides again.
      .catch((err) => logFailure('reading the last seen version', err));
    return () => {
      cancelled = true;
    };
  }, [currentVersion, releases, storeCurrent]);

  // The restored-tabs hint registers only after the tab list is read, which can
  // outlast any timer, so wait for its explicit all-clear (shown and closed, or
  // never going to show) rather than for the hints' settle period.
  const restoreHintSettled = useRestoreHintSettled();
  React.useEffect(() => {
    // Starts the launch tab read even off the workspace, so a launch that
    // restored nothing clears the way without the Workspace mounting.
    if (pending) void readLaunchTabCount();
  }, [pending]);
  const launchLayersClear =
    hints.loaded && restoreHintSettled && hints.visibleId !== 'startup.restore' && !paletteOpen;

  if (pending && !released && launchLayersClear) setReleased(true);
  const showing = manual ?? (pending && released ? pending : null);

  const autoOpened = pending !== null && released;
  React.useEffect(() => {
    // Stored as it opens, so a version's notes open at most once.
    if (autoOpened) storeCurrent();
  }, [autoOpened, storeCurrent]);

  const controls = React.useMemo<WhatsNewControls>(
    () => ({
      open: () =>
        setManual({
          releases: releases.filter((r) => r.version === currentVersion),
          from: null,
        }),
    }),
    [releases, currentVersion],
  );

  return (
    <WhatsNewContext.Provider value={controls}>
      {children}
      {showing && (
        <WhatsNewWindow
          releases={showing.releases}
          currentVersion={currentVersion}
          from={showing.from}
          onClose={() => {
            setManual(null);
            setPending(null);
          }}
        />
      )}
    </WhatsNewContext.Provider>
  );
}
