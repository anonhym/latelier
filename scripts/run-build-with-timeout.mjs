// `npm run build` under a watchdog: a wedged build (Rolldown's thread pool can
// stall under load) would otherwise hang the e2e run forever. macOS has no
// timeout(1), so this is a Node spawn with a kill timer, as in run-tests.mjs.
import { spawnSync } from 'node:child_process';

const DEFAULT_MS = 5 * 60 * 1000;
const raw = process.env.ATELIER_BUILD_TIMEOUT_MS;
const timeoutMs = raw === undefined ? DEFAULT_MS : Number.parseInt(raw, 10);
if (!Number.isInteger(timeoutMs) || timeoutMs <= 0) {
  console.error(`[run-e2e] ATELIER_BUILD_TIMEOUT_MS must be a positive integer, got "${raw}"`);
  process.exit(1);
}

const result = spawnSync('npm', ['run', 'build'], {
  stdio: 'inherit',
  timeout: timeoutMs,
  killSignal: 'SIGKILL',
});

if (result.error || result.signal) {
  console.error(
    `\n[run-e2e] build timed out after ${timeoutMs}ms (signal: ${result.signal ?? 'n/a'}) - treating as failure.`,
  );
  process.exit(1);
}
process.exit(result.status ?? 1);
