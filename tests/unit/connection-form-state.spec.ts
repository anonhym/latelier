import { describe, expect, it } from 'vitest';
import {
  CONNECTION_FORM_DEFAULTS,
  CONNECTION_FORM_TABS,
  CONNECTION_FORM_TAB_FIELDS,
  applyParsedUri,
  formToConnectionInput,
  tabHasNonDefault,
  type ConnectionFormState,
} from '../../src/features/connections/connectionFormState';

const withValues = (patch: Partial<ConnectionFormState>): ConnectionFormState => ({
  ...CONNECTION_FORM_DEFAULTS,
  ...patch,
});

describe('connection form defaults', () => {
  it('an empty form is a local Standard server', () => {
    expect(CONNECTION_FORM_DEFAULTS).toMatchObject({
      type: 'standard',
      host: 'localhost',
      port: '27017',
      tlsEnabled: false,
    });
  });

  it('every field sits on exactly one tab', () => {
    const placed = CONNECTION_FORM_TABS.flatMap((tab) => CONNECTION_FORM_TAB_FIELDS[tab]);
    expect([...placed].sort((a, b) => a.localeCompare(b))).toEqual(
      Object.keys(CONNECTION_FORM_DEFAULTS).sort((a, b) => a.localeCompare(b)),
    );
  });
});

describe('tabHasNonDefault', () => {
  it('no tab of an empty form holds a non-default value', () => {
    for (const tab of CONNECTION_FORM_TABS) {
      expect(tabHasNonDefault(tab, CONNECTION_FORM_DEFAULTS)).toBe(false);
    }
  });

  it.each([
    ['General', { host: 'db.example.net' }],
    ['General', { type: 'srv' }],
    ['General', { readOnly: true }],
    ['Authentication', { authUsername: 'ana' }],
    ['Authentication', { hasPasswordStored: true }],
    ['Authentication', { authMech: 'none' }],
    ['TLS / SSH', { tlsEnabled: true }],
    ['TLS / SSH', { tlsVerify: false }],
    ['Advanced', { directConnection: true }],
    ['Advanced', { maxPoolSize: '10' }],
  ] as const)('%s carries the dot for %o, and no other tab does', (tab, patch) => {
    const form = withValues(patch);
    expect(CONNECTION_FORM_TABS.filter((t) => tabHasNonDefault(t, form))).toEqual([tab]);
  });

  it('a value typed back to its default clears the dot', () => {
    expect(tabHasNonDefault('Advanced', withValues({ maxPoolSize: '100' }))).toBe(false);
  });
});

describe('applyParsedUri', () => {
  it('lays what the URI says over the fields and keeps the rest', () => {
    const form = applyParsedUri(withValues({ name: 'Mine', appName: 'kept' }), {
      connectionType: 'srv',
      host: 'cluster0.example.net',
      authMech: 'default',
      authUsername: 'ana',
      password: 'pw',
      tls: { enabled: true, verify: false },
      advanced: { ...formToConnectionInput(CONNECTION_FORM_DEFAULTS).advanced, maxPoolSize: 7, directConnection: true },
    });
    expect(form).toMatchObject({
      name: 'Mine',
      type: 'srv',
      host: 'cluster0.example.net',
      port: '27017',
      authUsername: 'ana',
      password: 'pw',
      tlsEnabled: true,
      tlsVerify: false,
      maxPoolSize: '7',
      directConnection: true,
      appName: 'kept',
    });
  });

  it('a URI that says nothing changes nothing', () => {
    expect(applyParsedUri(CONNECTION_FORM_DEFAULTS, {})).toEqual(CONNECTION_FORM_DEFAULTS);
  });
});

describe('formToConnectionInput', () => {
  it('an empty form is a local, unencrypted Standard connection', () => {
    expect(formToConnectionInput(withValues({ name: 'Local' }))).toMatchObject({
      name: 'Local',
      connectionType: 'standard',
      host: 'localhost',
      port: 27017,
      tls: { enabled: false, verify: true },
      ssh: { enabled: false },
      readOnly: false,
    });
  });

  it('sends no credentials when authentication is off, whatever the fields still hold', () => {
    const input = formToConnectionInput(withValues({ authMech: 'none', authUsername: 'ana', password: 'pw' }));
    expect(input.authUsername).toBeUndefined();
    expect(input.authDatabase).toBeUndefined();
    expect(input.password).toBeUndefined();
  });

  it('a parsed URI round-trips through the fields to what main saves', () => {
    const input = formToConnectionInput(
      applyParsedUri(CONNECTION_FORM_DEFAULTS, { host: 'db.example.net', port: 27018, authMech: 'none' }),
    );
    expect(input).toMatchObject({ host: 'db.example.net', port: 27018, authMech: 'none' });
  });
});
