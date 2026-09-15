import { describe, it, expect } from 'vitest';

/**
 * The app:openExternal guard is simple enough to test in isolation without
 * spinning up Electron. Mirror the logic from electron/ipc/handlers/app.ts.
 */
function guardUrl(url: string): { ok: true } | { ok: false; reason: string } {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return { ok: false, reason: 'invalid URL' };
  }
  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
    return { ok: false, reason: `unsupported protocol: ${parsed.protocol}` };
  }
  return { ok: true };
}

describe('app:openExternal guard', () => {
  it('accepts https URLs', () => {
    expect(guardUrl('https://anthropic.com/')).toEqual({ ok: true });
  });

  it('accepts http URLs', () => {
    expect(guardUrl('http://localhost:3000/')).toEqual({ ok: true });
  });

  it('rejects file://', () => {
    const r = guardUrl('file:///etc/passwd');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toMatch(/file:/);
  });

  it('rejects javascript:', () => {
    const r = guardUrl('javascript:alert(1)');
    expect(r.ok).toBe(false);
  });

  it('rejects garbage strings', () => {
    const r = guardUrl('not a url');
    expect(r.ok).toBe(false);
  });
});
