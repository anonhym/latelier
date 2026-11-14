import React from 'react';
import { api } from '../../../api/atelier';
import { COPY_FORMATS, DEFAULT_COPY_FORMAT, type CopyFormat } from '../../../utils/copyFormat';
import { logFailure } from '../../../utils/rendererLog';

const PREF_KEY = 'ui.workspace.copyFormat';

// One store for the whole renderer: the selection bar's "Copy as" choice must
// be what ⌘⇧C in a view copies next, and each view mounts its own hook.
let current: CopyFormat = DEFAULT_COPY_FORMAT;
// Set once the user picks a format: a stored value read after that is older
// than the pick and must not replace it.
let chosen = false;
// Bumped by a reset so a read still in flight cannot land on the new state.
let epoch = 0;
const listeners = new Set<() => void>();

/** Back to the first-launch state. Specs call it so one test's choice never reaches the next. */
export function resetCopyFormatStore(): void {
  current = DEFAULT_COPY_FORMAT;
  chosen = false;
  epoch += 1;
  listeners.clear();
}

function publish(next: CopyFormat): void {
  if (next === current) return;
  current = next;
  listeners.forEach((fn) => fn());
}

function subscribe(fn: () => void): () => void {
  // The first subscriber reads the stored choice; a later one finds it loaded.
  if (listeners.size === 0) {
    const startedIn = epoch;
    api.prefs
      .get<string>(PREF_KEY)
      .then((stored) => {
        if (startedIn === epoch && !chosen && COPY_FORMATS.includes(stored as CopyFormat)) publish(stored as CopyFormat);
      })
      .catch((err) => logFailure('loading the copy format', err));
  }
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

const getSnapshot = () => current;

/** The last "Copy as" choice (a stored preference) and a setter that persists it. */
export function useCopyFormat(): [CopyFormat, (format: CopyFormat) => void] {
  const format = React.useSyncExternalStore(subscribe, getSnapshot);
  const setFormat = React.useCallback((next: CopyFormat) => {
    chosen = true;
    publish(next);
    void api.prefs.set(PREF_KEY, next).catch((err) => logFailure('saving the copy format', err));
  }, []);
  return [format, setFormat];
}
