/**
 * Race a promise against a timeout. If the promise hasn't settled by the
 * deadline, resolve with `fallback`. The original promise keeps running but
 * its settlement is ignored.
 *
 * If the promise is already rejected before the deadline, its rejection
 * propagates as usual.
 */
export async function withTimeout<T>(
  p: Promise<T>,
  ms: number,
  fallback: T,
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | null = null;
  try {
    return await Promise.race<T>([
      p,
      new Promise<T>((resolve) => {
        timer = setTimeout(() => resolve(fallback), ms);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}
