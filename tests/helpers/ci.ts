/**
 * Playwright's own reading of `CI`: unset, empty, `0` and `false` all mean
 * "not CI", so a developer exporting `CI=0` is not treated as a runner.
 */
export function isCi(): boolean {
  const ci = process.env.CI?.toLowerCase();
  return ci !== undefined && ci !== '' && ci !== '0' && ci !== 'false';
}
