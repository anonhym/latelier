import { describe, it, expect } from 'vitest';
import { makeAppLocationCheck } from '../../electron/security/appLocation';

describe('makeAppLocationCheck — dev server (http)', () => {
  const isApp = makeAppLocationCheck('http://localhost:5173/');

  it('accepts any path the dev server serves', () => {
    // Deliberately permissive. Vite moves between these as it pleases, and
    // pinning dev to one path breaks Fast Refresh without making anything safer.
    for (const url of [
      'http://localhost:5173/',
      'http://localhost:5173/index.html',
      'http://localhost:5173/src/main.tsx',
      'http://localhost:5173/#/workspace',
      'http://localhost:5173/?x=1',
    ]) {
      expect(isApp(url), url).toBe(true);
    }
  });

  // The finding this whole module exists for. Everything before the `@` is
  // userinfo, so this string starts with the dev server URL and resolves to a
  // completely different host — a prefix test waves it straight through.
  it('rejects a host smuggled behind a userinfo segment', () => {
    expect(isApp('http://localhost:5173@evil.example/')).toBe(false);
    expect(new URL('http://localhost:5173@evil.example/').origin).toBe('http://evil.example');
  });

  it('rejects a different origin, however similar', () => {
    for (const url of [
      'http://localhost:5174/',
      'https://localhost:5173/',
      'http://evil.example/',
      'http://localhost:5173.evil.example/',
    ]) {
      expect(isApp(url), url).toBe(false);
    }
  });

  it('rejects opaque origins and unparseable input', () => {
    for (const url of ['about:blank', 'data:text/html,<h1>x', 'file:///tmp/x.html', 'not a url', '']) {
      expect(isApp(url), url).toBe(false);
    }
  });
});

describe('makeAppLocationCheck — packaged build (file)', () => {
  const APP = 'file:///Applications/App.app/Contents/Resources/app.asar/dist/index.html';
  const isApp = makeAppLocationCheck(APP);

  it('accepts the app document, with or without a fragment', () => {
    // HashRouter puts the whole route in the fragment, so this has to hold or
    // the app cannot navigate itself.
    expect(isApp(APP)).toBe(true);
    expect(isApp(`${APP}#/workspace`)).toBe(true);
    expect(isApp(`${APP}?x=1#/workspace`)).toBe(true);
  });

  it('rejects every other local file', () => {
    // The second finding: `startsWith('file://')` accepts all of these, and a
    // file URL's origin is the string "null" for every one of them, so an
    // origin comparison would too.
    for (const url of [
      'file:///tmp/attacker.html',
      'file:///Applications/App.app/Contents/Resources/app.asar/dist/other.html',
      'file:///etc/passwd',
      'file:///',
    ]) {
      expect(isApp(url), url).toBe(false);
    }
    expect(new URL('file:///tmp/attacker.html').origin).toBe('null');
  });

  it('rejects remote origins', () => {
    for (const url of ['http://evil.example/', 'https://localhost:5173/', 'about:blank']) {
      expect(isApp(url), url).toBe(false);
    }
  });

  it('rejects a host on a file URL that shares the path', () => {
    // `file://evil.example/…` parses with a host and the same pathname. Both
    // report their origin as "null", and comparing the path alone would call
    // them the same document.
    const withHost = APP.replace('file://', 'file://evil.example');
    expect(new URL(withHost).pathname).toBe(new URL(APP).pathname);
    expect(isApp(withHost)).toBe(false);
  });

  it('rejects unparseable input', () => {
    for (const url of ['not a url', '', 'file:', '///']) {
      expect(isApp(url), JSON.stringify(url)).toBe(false);
    }
  });

  it('rejects another scheme with the same empty host and the same path', () => {
    // Protocol is load-bearing, and this is the case that proves it. An
    // `http://` impostor is already refused by the host check, so only a
    // scheme that also parses to an empty host can isolate the protocol
    // comparison — a custom scheme an Electron app registered, say.
    const otherScheme = APP.replace('file://', 'atelier://');
    const parsed = new URL(otherScheme);
    expect(parsed.host).toBe(new URL(APP).host);
    expect(parsed.pathname).toBe(new URL(APP).pathname);
    expect(isApp(otherScheme)).toBe(false);
  });

  it('rejects an http URL whose path matches the app document', () => {
    const asHttp = `http://example.com${new URL(APP).pathname}`;
    expect(new URL(asHttp).pathname).toBe(new URL(APP).pathname);
    expect(isApp(asHttp)).toBe(false);
  });

  it('accepts a percent-encoded path that normalises to the app document', () => {
    const spaced = makeAppLocationCheck('file:///Users/x/My%20App/dist/index.html');
    expect(spaced('file:///Users/x/My%20App/dist/index.html')).toBe(true);
    expect(spaced('file:///Users/x/My%20App/dist/other.html')).toBe(false);
  });
});
