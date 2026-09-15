#!/usr/bin/env node
/**
 * run-tests.mjs
 *
 * Runs the unit / integration / component vitest projects sequentially
 * instead of combined (`vitest run` with vitest.config.ts's `projects`
 * array) — the combined run intermittently hangs at 0% CPU with
 * no worker children, and a killed hang can report exit 0 on an empty log.
 * Run separately, each project always completes quickly.
 *
 * Each project also gets a hard wall-clock timeout so a hang fails loudly
 * (non-zero exit) instead of running forever or being silently killed.
 */
import { spawnSync } from 'node:child_process';

const PROJECTS = ['unit', 'integration', 'component'];

// A hang detector, not a performance budget. The hang sits at 0% CPU
// with no worker children and never finishes, so a generous ceiling catches it
// exactly as well as a tight one — while a tight one fails runs where every
// test passed. That is what happened at 5 minutes: the component project
// legitimately takes ~5 min on CI's 2-core runner and was clearing the kill by
// 8 seconds, less than the observed run-to-run variance.
//
// Size this at several times the slowest project's real wall-clock. If the
// component project ever approaches 15 minutes, the answer is to look at why,
// not to raise this again.
const TIMEOUT_MS = 15 * 60 * 1000;

for (const project of PROJECTS) {
  const result = spawnSync('npx', ['vitest', 'run', '--project', project], {
    stdio: 'inherit',
    timeout: TIMEOUT_MS,
    killSignal: 'SIGKILL',
  });

  if (result.error || result.signal) {
    console.error(
      `\n[run-tests] "${project}" project timed out or was killed (signal: ${result.signal ?? 'n/a'}) after ${TIMEOUT_MS}ms — treating as failure.`,
    );
    process.exit(1);
  }

  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}
