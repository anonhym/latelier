import { describe, it, expect } from 'vitest';
import { pickRecipe, RECIPES } from '../../src/troubleshooting/recipes';

describe('pickRecipe', () => {
  it('matches AUTH to auth-default', () => {
    expect(pickRecipe({ errorCode: 'AUTH' }).id).toBe('auth-default');
  });

  it('matches TIMEOUT + ECONNRESET to docker-tls (legacy backstop)', () => {
    expect(
      pickRecipe({
        errorCode: 'TIMEOUT',
        message: 'connect ECONNRESET 127.0.0.1:27017',
      }).id,
    ).toBe('docker-tls');
  });

  it('matches TLS_HANDSHAKE directly to docker-tls (no message needed)', () => {
    expect(pickRecipe({ errorCode: 'TLS_HANDSHAKE' }).id).toBe('docker-tls');
  });

  it('matches NETWORK + ECONNRESET to docker-tls (legacy backstop)', () => {
    expect(
      pickRecipe({
        errorCode: 'NETWORK',
        message: 'connect ECONNRESET 127.0.0.1:27017',
      }).id,
    ).toBe('docker-tls');
  });

  it('matches TIMEOUT + getaddrinfo ENOTFOUND to replica-host', () => {
    expect(
      pickRecipe({
        errorCode: 'TIMEOUT',
        message: 'getaddrinfo ENOTFOUND mongo-primary-7f3a9c1d',
      }).id,
    ).toBe('replica-host');
  });

  it('matches TIMEOUT + EAI_AGAIN to replica-host', () => {
    expect(
      pickRecipe({
        errorCode: 'TIMEOUT',
        message: 'getaddrinfo EAI_AGAIN abc.local',
      }).id,
    ).toBe('replica-host');
  });

  it('matches NETWORK to network-default', () => {
    expect(pickRecipe({ errorCode: 'NETWORK' }).id).toBe('network-default');
  });

  it('matches TLS to tls-default', () => {
    expect(pickRecipe({ errorCode: 'TLS' }).id).toBe('tls-default');
  });

  it('matches UNAUTHORIZED to unauthorized', () => {
    expect(pickRecipe({ errorCode: 'UNAUTHORIZED' }).id).toBe('unauthorized');
  });

  it('falls back to unknown when nothing matches', () => {
    expect(pickRecipe({}).id).toBe('unknown');
    expect(pickRecipe({ errorCode: 'UNKNOWN' }).id).toBe('unknown');
  });

  it('TIMEOUT without a recognised message also falls through to unknown', () => {
    // Neither docker-tls nor replica-host match; no other recipe takes plain TIMEOUT.
    expect(
      pickRecipe({
        errorCode: 'TIMEOUT',
        message: 'something completely different',
      }).id,
    ).toBe('unknown');
  });

  it('every recipe has a stable id, title, diagnosis, and at least one step', () => {
    for (const r of RECIPES) {
      expect(r.id.length).toBeGreaterThan(0);
      expect(r.title.length).toBeGreaterThan(0);
      expect(r.diagnosis.length).toBeGreaterThan(0);
      expect(r.steps.length).toBeGreaterThanOrEqual(1);
      expect(r.docAnchor).toBe(r.id);
    }
  });
});
