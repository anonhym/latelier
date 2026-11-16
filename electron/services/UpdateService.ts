import { ValidationError } from '../errors.ts';
import type { Logger } from '../log.ts';
import type { QuitGate } from '../quitGuard.ts';
import { extractHighlights } from '../updater/releaseNotes.ts';
import type { UpdateState } from '@shared/types';

/** The slice of electron-updater's `UpdateInfo` this service reads. */
export interface UpdateInfoLike {
  version: string;
  releaseNotes?: string | Array<{ version: string; note: string | null }> | null;
}

/** The subset of electron-updater's `autoUpdater` this service touches. */
export interface UpdaterLike {
  autoDownload: boolean;
  autoInstallOnAppQuit: boolean;
  on(event: 'checking-for-update', listener: () => void): unknown;
  on(event: 'update-available', listener: (info: UpdateInfoLike) => void): unknown;
  on(event: 'update-not-available', listener: (info: UpdateInfoLike) => void): unknown;
  on(event: 'download-progress', listener: (progress: { percent: number }) => void): unknown;
  on(event: 'update-downloaded', listener: (info: UpdateInfoLike) => void): unknown;
  on(event: 'error', listener: (err: Error) => void): unknown;
  checkForUpdates(): Promise<unknown>;
  quitAndInstall(isSilent?: boolean, isForceRunAfter?: boolean): void;
}

export const RECHECK_INTERVAL_MS = 4 * 60 * 60 * 1000;
/** Progress pushes are at least this far apart, so a fast download does not flood IPC. */
export const PROGRESS_PUSH_MIN_GAP_MS = 500;
const RELEASE_URL_BASE = 'https://github.com/anonhym/latelier/releases/tag/v';

export interface UpdateServiceOptions {
  /** Decides the `off` reason: Linux has its own copy, everything else is development. */
  platform?: NodeJS.Platform;
  /** ISO-8601 clock for `lastCheckedAt`; also the throttle clock. */
  now?: () => string;
  setInterval?: (fn: () => void, ms: number) => unknown;
  clearInterval?: (handle: unknown) => void;
}

/**
 * Updates run only in a packaged macOS or Windows build that is not pointed at
 * a throwaway data folder: never under `electron:dev`, never under the e2e
 * harness, and never on Linux (no feed is published for it).
 */
export function shouldCheckForUpdates(env: {
  isPackaged: boolean;
  userDataOverride: string | undefined;
  platform: NodeJS.Platform;
}): boolean {
  const supported = env.platform === 'darwin' || env.platform === 'win32';
  return supported && env.isPackaged && !env.userDataOverride;
}

/**
 * Owns the one piece of update state the renderer sees. A background failure is
 * a log line and no UI; only a check the user started can end in `failed`.
 * `ready` is sticky: nothing after a finished download moves the state off it.
 */
export class UpdateService {
  private state: UpdateState;
  private updater: UpdaterLike | null = null;
  // Set while an approved restart is installing; the updater's error event
  // clears it when the install fails and the app does not quit.
  private restartPending = false;
  // What the state was before the running check began; a background failure
  // and a failed download both go back to it.
  private prior: UpdateState;
  private lastCheckedAt: string | null = null;
  // The updater's error event during a check; the check settles on it, so a
  // rejected promise that follows the same failure is not handled twice.
  private checkError: unknown = undefined;
  private lastProgressPushMs = 0;
  private timer: unknown = null;

  private readonly loadUpdater: () => Promise<UpdaterLike>;
  private readonly log: Logger;
  private readonly emit: (state: UpdateState) => void;
  private readonly enabled: boolean;
  private readonly quitGate: Pick<QuitGate, 'check' | 'ask' | 'reset'>;
  private readonly now: () => string;
  private readonly setTimer: (fn: () => void, ms: number) => unknown;
  private readonly clearTimer: (handle: unknown) => void;

  constructor(
    loadUpdater: () => Promise<UpdaterLike>,
    log: Logger,
    emit: (state: UpdateState) => void,
    enabled: boolean,
    quitGate: Pick<QuitGate, 'check' | 'ask' | 'reset'>,
    options: UpdateServiceOptions = {},
  ) {
    this.loadUpdater = loadUpdater;
    this.log = log;
    this.emit = emit;
    this.enabled = enabled;
    this.quitGate = quitGate;
    this.now = options.now ?? (() => new Date().toISOString());
    this.setTimer = options.setInterval ?? ((fn, ms) => setInterval(fn, ms));
    this.clearTimer = options.clearInterval ?? ((h) => clearInterval(h as NodeJS.Timeout));
    const platform = options.platform ?? process.platform;
    this.state = enabled
      ? { status: 'idle' }
      : { status: 'off', reason: platform === 'linux' ? 'linux' : 'development' };
    this.prior = this.state;
  }

  /** The launch check. Resolves once it has settled; never rejects. */
  async start(): Promise<void> {
    await this.check({ manual: false });
  }

  /**
   * Starts the re-check timer. A tick while a check, download or finished
   * update is in the way does nothing, because `check` answers those itself.
   */
  startPeriodic(intervalMs: number = RECHECK_INTERVAL_MS): void {
    if (!this.enabled || this.timer !== null) return;
    this.timer = this.setTimer(() => {
      void this.check({ manual: false });
    }, intervalMs);
  }

  stop(): void {
    if (this.timer === null) return;
    this.clearTimer(this.timer);
    this.timer = null;
  }

  /**
   * Looks for an update and returns the state once the check settles; never
   * rejects. While a check or download runs, or while `ready` or `off`, it
   * returns the current state and does not call `checkForUpdates` again.
   */
  async check({ manual }: { manual: boolean }): Promise<UpdateState> {
    const s = this.state.status;
    if (s === 'off' || s === 'checking' || s === 'downloading' || s === 'ready') return this.state;

    this.checkError = undefined;
    this.beginChecking();
    let failure: unknown;
    try {
      const updater = this.updater ?? (await this.attach());
      await updater.checkForUpdates();
    } catch (err) {
      // With an error event already recorded, that event is the one log line.
      if (this.checkError === undefined) {
        this.log.warn('updater', 'update check failed', { err: String(err) });
      }
      failure = err;
    }
    failure ??= this.checkError;
    this.checkError = undefined;
    if (this.getState().status === 'checking') {
      if (failure !== undefined) this.failCheck(failure, manual);
      // No event arrived, so no update was announced: the check found nothing.
      else this.setUpToDate();
    }
    return this.state;
  }

  getState(): UpdateState {
    return this.state;
  }

  private async attach(): Promise<UpdaterLike> {
    const updater = await this.loadUpdater();
    updater.autoDownload = true;
    updater.autoInstallOnAppQuit = true;
    updater.on('checking-for-update', () => {
      const s = this.state.status;
      if (s === 'idle' || s === 'up-to-date' || s === 'failed') this.beginChecking();
    });
    updater.on('update-available', (info) => {
      if (this.state.status === 'ready') return;
      this.lastCheckedAt = this.now();
      this.lastProgressPushMs = Date.parse(this.lastCheckedAt);
      this.setState({ status: 'downloading', version: info.version, percent: 0, lastCheckedAt: this.lastCheckedAt });
    });
    updater.on('update-not-available', () => {
      if (this.state.status === 'checking') this.setUpToDate();
    });
    updater.on('download-progress', (progress) => {
      if (this.state.status !== 'downloading') return;
      const percent = Math.floor(progress.percent);
      const at = Date.parse(this.now());
      if (percent === this.state.percent || at - this.lastProgressPushMs < PROGRESS_PUSH_MIN_GAP_MS) return;
      this.lastProgressPushMs = at;
      this.setState({ ...this.state, percent });
    });
    updater.on('update-downloaded', (info) => {
      if (this.state.status === 'ready') return;
      const { highlights, changeCount } = extractHighlights(info.releaseNotes, info.version);
      this.lastCheckedAt ??= this.now();
      this.setState({
        status: 'ready',
        version: info.version,
        highlights,
        changeCount,
        releaseUrl: `${RELEASE_URL_BASE}${info.version}`,
        lastCheckedAt: this.lastCheckedAt,
        downloadedAt: this.now(),
      });
    });
    updater.on('error', (err) => {
      this.log.warn('updater', 'updater error', { err: String(err) });
      // electron-updater reports every failed install here and then does not
      // quit: take back the quit approval and offer Restart again.
      if (this.restartPending) {
        this.restartPending = false;
        this.quitGate.reset();
        this.emit(this.state);
      } else if (this.state.status === 'checking') {
        this.checkError = err;
      } else if (this.state.status === 'downloading') {
        // A failed download is a background failure: back to before the check.
        this.setState(this.prior);
      }
    });
    this.updater = updater;
    return updater;
  }

  private beginChecking(): void {
    this.prior = this.state;
    this.setState({ status: 'checking', lastCheckedAt: this.lastCheckedAt });
  }

  private setUpToDate(): void {
    this.lastCheckedAt = this.now();
    this.setState({ status: 'up-to-date', lastCheckedAt: this.lastCheckedAt });
  }

  private failCheck(err: unknown, manual: boolean): void {
    if (!manual) {
      this.setState(this.prior);
      return;
    }
    this.setState({
      status: 'failed',
      message: err instanceof Error ? err.message : String(err),
      lastCheckedAt: this.lastCheckedAt,
    });
  }

  private setState(next: UpdateState): void {
    this.state = next;
    this.emit(next);
  }

  /**
   * Asks about running work first: electron-updater starts the installer inside
   * `quitAndInstall`, before the app's quit event, so asking at `before-quit`
   * would be too late to cancel. A yes lets the quit that follows through
   * without a second dialog. A no installs nothing and re-sends `ready`, so the
   * renderer offers Restart again, as does an install that fails without
   * quitting. Resolves whether the restart went ahead.
   */
  async restart(): Promise<boolean> {
    if (this.state.status !== 'ready') {
      throw new ValidationError(`No update is ready to install (state: ${this.state.status})`);
    }
    if (this.quitGate.check() === 'hold' && !(await this.quitGate.ask())) {
      this.emit(this.state);
      return false;
    }
    this.restartPending = true;
    // A failed install emits `error` synchronously from inside this call.
    this.updater?.quitAndInstall(true, true);
    return this.restartPending;
  }
}
