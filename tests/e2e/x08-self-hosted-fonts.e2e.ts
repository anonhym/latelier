import { test, expect } from '@playwright/test';
import { stopAllMemoryServers, withApp } from '../helpers/e2eApp';

test.afterAll(stopAllMemoryServers);

/**
 * The fonts are self-hosted, and both halves of that fail silently.
 *
 * If a `.woff2` never made it into the build, CSS falls back to the system
 * stack and every other test still passes — the app just quietly stops looking
 * like itself. And if a `fonts.googleapis.com` link comes back, nothing breaks
 * either; the app simply phones a third party on every launch and stops working
 * offline. Neither shows up in a screenshot diff or a console error, so they
 * get their own assertions here.
 *
 * This runs against the built bundle over `file://` (`run-e2e.sh` launches
 * without `VITE_DEV_SERVER_URL`, so `main.ts` takes the `loadFile` branch),
 * which is the same path a packaged app takes.
 */
test('fonts are served from the bundle, and nothing is fetched from a third party', async () => {
  await withApp(async (app) => {
    const win = await app.firstWindow();

    // Record every request the renderer makes before waiting on fonts, so a
    // late external fetch is still caught.
    const externalRequests: string[] = [];
    win.on('request', (req) => {
      const url = req.url();
      if (!/^(file|data|devtools):/.test(url)) externalRequests.push(url);
    });

    await win.waitForLoadState('domcontentloaded');
    await win.evaluate(() => document.fonts.ready);

    // Two separate questions, and they need two different checks.
    //
    // 1. Can the browser actually get the file? `document.fonts.load()` forces
    //    the fetch and resolves with the faces that matched; an empty array
    //    means the woff2 is missing from the bundle. Iterating `document.fonts`
    //    would not answer this — the set holds only faces already used for
    //    painted glyphs, and the boot screen renders no monospace text.
    //
    // 2. Does the declared range cover the weights the UI asks for? `load()`
    //    cannot answer that: a face registered only to 500 still *matches* a
    //    700 request, because the browser synthesises a fake bold and reports
    //    success. Verified by mutation — narrowing the range to `400 500` left
    //    a `load('700 …')` probe passing. So read the `font-weight` descriptor
    //    off the FontFace instead, which is the thing that actually changed.
    const fonts = await win.evaluate(async () => {
      const fetched = async (spec: string) => (await document.fonts.load(spec)).length > 0;
      const declared = (family: string) =>
        [...document.fonts].find((f) => f.family === family)?.weight ?? null;
      return {
        interFetched: await fetched('400 14px "Inter"'),
        monoFetched: await fetched('400 12px "JetBrains Mono"'),
        interWeight: declared('Inter'),
        monoWeight: declared('JetBrains Mono'),
      };
    });

    // Asserted first, and deliberately: reintroducing a `fonts.googleapis.com`
    // link also registers competing faces, which surfaces downstream as a
    // confusing weight mismatch. Failing here names the actual cause.
    expect(externalRequests).toEqual([]);

    expect(fonts.interFetched).toBe(true);
    expect(fonts.monoFetched).toBe(true);

    // Inter spans 300-900 (the UI uses 300 through 900); mono spans 400-700
    // because the aggregation panes ask for 600 and 700.
    expect(fonts.interWeight).toBe('300 900');
    expect(fonts.monoWeight).toBe('400 700');
  });
});
