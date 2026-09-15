/**
 * "Is this URL the app's own document?" — the one question behind both the
 * navigation guard and IPC sender validation.
 *
 * A prefix test cannot answer it. `'http://localhost:5173@evil.example/'`
 * starts with the dev server URL and its real origin is `http://evil.example`,
 * because everything before the `@` is userinfo. Only a parser sees that.
 *
 * Everything below compares **parsed components**, never strings. `pathname`
 * and `origin` exclude the fragment and the query by definition, so there is no
 * stripping step to get wrong — and a HashRouter route, which lives entirely in
 * the fragment, is ignored for free.
 */
export function makeAppLocationCheck(appUrl: string): (url: string) => boolean {
  const app = new URL(appUrl);

  if (app.protocol === 'file:') {
    // Every file URL reports its origin as the string "null", so an origin
    // comparison would accept `file:///tmp/anything.html` as readily as the
    // real document. The path is all there is to compare — plus the host,
    // because `file://evil.example/same/path.html` shares a pathname with
    // `file:///same/path.html` and is not the same document.
    const expectedPath = app.pathname;
    const expectedHost = app.host;
    return (url) => {
      const parsed = parse(url);
      return (
        parsed !== null &&
        parsed.protocol === 'file:' &&
        parsed.host === expectedHost &&
        parsed.pathname === expectedPath
      );
    };
  }

  // The dev server is trusted, and Vite moves between `/`, `/index.html` and
  // its own client routes as it pleases. Pinning dev to an exact path would
  // break Fast Refresh without making anything safer: the threat here is a
  // *different origin*, which is exactly what this compares.
  //
  // The asymmetry with the `file:` branch is the point, not an oversight —
  // `file:` has no origin to lean on, `http` does.
  const expectedOrigin = app.origin;
  return (url) => {
    const parsed = parse(url);
    // `origin` is the string "null" for an opaque origin — `about:blank`,
    // `data:`, `file:` — so those are rejected without a special case, as long
    // as the app itself is not on one, which this branch guarantees.
    return parsed !== null && parsed.origin === expectedOrigin;
  };
}

function parse(url: string): URL | null {
  try {
    return new URL(url);
  } catch {
    return null;
  }
}
