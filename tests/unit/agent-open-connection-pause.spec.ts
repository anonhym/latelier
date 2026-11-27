import { describe, it, expect } from 'vitest';
import {
  MAX_CLIENT_INFO_CHARS,
  MAX_PROMPT_NAME,
  OPEN_CONNECTION_KEY,
  acceptsFormElicitation,
  clientInfoOf,
  cutClientInfo,
  envelopeClientInfo,
  openConnectionAnswer,
  openConnectionMessage,
} from '../../electron/agent/openConnectionPause';

const caps = (elicitation: unknown) => ({ 'io.modelcontextprotocol/clientCapabilities': { elicitation } });

describe('acceptsFormElicitation', () => {
  it('accepts an explicit form mode, alone or with url', () => {
    expect(acceptsFormElicitation(caps({ form: {} }))).toBe(true);
    expect(acceptsFormElicitation(caps({ form: {}, url: {} }))).toBe(true);
  });

  it('accepts a bare declaration, which predates modes and meant form', () => {
    expect(acceptsFormElicitation(caps({}))).toBe(true);
  });

  it('refuses url mode alone', () => {
    expect(acceptsFormElicitation(caps({ url: {} }))).toBe(false);
  });

  it('refuses an absent or malformed declaration', () => {
    expect(acceptsFormElicitation(undefined)).toBe(false);
    expect(acceptsFormElicitation(null)).toBe(false);
    expect(acceptsFormElicitation({})).toBe(false);
    expect(acceptsFormElicitation({ 'io.modelcontextprotocol/clientCapabilities': 'x' })).toBe(false);
    expect(acceptsFormElicitation({ 'io.modelcontextprotocol/clientCapabilities': {} })).toBe(false);
    expect(acceptsFormElicitation(caps(true))).toBe(false);
    expect(acceptsFormElicitation(caps(null))).toBe(false);
    expect(acceptsFormElicitation(caps([]))).toBe(false);
  });

  it('reads the capabilities key only, not a look-alike', () => {
    expect(acceptsFormElicitation({ clientCapabilities: { elicitation: { form: {} } } })).toBe(false);
  });
});

describe('openConnectionAnswer', () => {
  it('reads the key X29 §4.2 puts on the wire', () => {
    expect(OPEN_CONNECTION_KEY).toBe('openConnection');
    expect(openConnectionAnswer({ openConnection: { action: 'accept' } }, undefined)).toBe('accept');
  });

  it('is none when nothing was answered under its key', () => {
    expect(openConnectionAnswer(undefined, undefined)).toBe('none');
    expect(openConnectionAnswer({}, [])).toBe('none');
    expect(openConnectionAnswer({ other: { action: 'accept' } }, ['other'])).toBe('none');
  });

  it('is accept only for an accept action', () => {
    expect(openConnectionAnswer({ [OPEN_CONNECTION_KEY]: { action: 'accept' } }, undefined)).toBe('accept');
    expect(openConnectionAnswer({ [OPEN_CONNECTION_KEY]: { action: 'accept', content: {} } }, [])).toBe('accept');
  });

  it('counts decline, cancel and anything malformed as refused, so one call never asks twice', () => {
    for (const answer of [{ action: 'decline' }, { action: 'cancel' }, { action: 'ACCEPT' }, {}, null, 'accept', ['accept'], undefined]) {
      expect(openConnectionAnswer({ [OPEN_CONNECTION_KEY]: answer }, undefined)).toBe('refused');
    }
  });

  it('counts an answer the SDK dropped as malformed as refused', () => {
    expect(openConnectionAnswer(undefined, [OPEN_CONNECTION_KEY])).toBe('refused');
    expect(openConnectionAnswer({ [OPEN_CONNECTION_KEY]: { action: 'accept' } }, [OPEN_CONNECTION_KEY])).toBe('refused');
  });

  it('ignores an inherited key', () => {
    const inherited = Object.create({ [OPEN_CONNECTION_KEY]: { action: 'accept' } }) as Record<string, unknown>;
    expect(openConnectionAnswer(inherited, undefined)).toBe('none');
  });
});

describe('openConnectionMessage', () => {
  it('names the Connection in the app’s own words', () => {
    expect(openConnectionMessage('prod')).toBe(`The Connection "prod" is closed. Open it in L'Atelier, then accept to continue.`);
  });

  it('cuts the name at 256 characters', () => {
    expect(MAX_PROMPT_NAME).toBe(256);
    expect(openConnectionMessage('a'.repeat(300))).toBe(`The Connection "${'a'.repeat(256)}" is closed. Open it in L'Atelier, then accept to continue.`);
    expect(openConnectionMessage('a'.repeat(256))).toContain(`"${'a'.repeat(256)}"`);
  });
});

describe('client info', () => {
  it('cuts strings to 128 characters and records anything else as null', () => {
    expect(MAX_CLIENT_INFO_CHARS).toBe(128);
    expect(cutClientInfo('x'.repeat(200))).toBe('x'.repeat(128));
    expect(cutClientInfo('short')).toBe('short');
    expect(cutClientInfo('')).toBe('');
    for (const value of [undefined, null, 7, {}, ['a']]) expect(cutClientInfo(value)).toBeNull();
  });

  it('reads name and version from an implementation object', () => {
    expect(clientInfoOf({ name: 'claude-code', version: '2.1' })).toEqual({ clientName: 'claude-code', clientVersion: '2.1' });
    expect(clientInfoOf({ name: 'only-name' })).toEqual({ clientName: 'only-name', clientVersion: null });
    for (const value of [undefined, null, 'claude', [], 3]) expect(clientInfoOf(value)).toEqual({ clientName: null, clientVersion: null });
  });

  it('reads the envelope’s clientInfo key', () => {
    expect(envelopeClientInfo({ 'io.modelcontextprotocol/clientInfo': { name: 'n', version: 'v' } })).toEqual({ clientName: 'n', clientVersion: 'v' });
    expect(envelopeClientInfo({ clientInfo: { name: 'n', version: 'v' } })).toEqual({ clientName: null, clientVersion: null });
    expect(envelopeClientInfo(undefined)).toEqual({ clientName: null, clientVersion: null });
    expect(envelopeClientInfo('x')).toEqual({ clientName: null, clientVersion: null });
  });
});
