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

const FULL_FORM: ConnectionFormState = {
  name: 'Prod', color: '#112233', type: 'srv',
  host: 'c0.example.net', port: '27018', defaultDb: 'shop',
  authMech: 'scram256', authUsername: 'ana', authDatabase: 'users',
  password: 'pw', hasPasswordStored: false, clearPassword: false,
  tlsEnabled: true, tlsVerify: false, tlsCaPath: '/ca.pem', tlsClientCertPath: '/client.pem',
  sshEnabled: true, sshHost: 'bastion', sshPort: '2222', sshUsername: 'root',
  sshAuthMethod: 'password', sshPrivateKeyPath: '/id_rsa',
  connectTimeoutMs: '1', socketTimeoutMs: '2', serverSelectionTimeoutMs: '3',
  readPreference: 'nearest', maxPoolSize: '4', directConnection: true, appName: 'atelier',
  readOnly: true,
};

describe('connection form state, in full', () => {
  it('the empty form holds exactly these values', () => {
    expect(CONNECTION_FORM_DEFAULTS).toEqual({
      name: '', color: '#7c6af7', type: 'standard',
      host: 'localhost', port: '27017', defaultDb: '',
      authMech: 'default', authUsername: '', authDatabase: 'admin',
      password: '', hasPasswordStored: false, clearPassword: false,
      tlsEnabled: false, tlsVerify: true, tlsCaPath: '', tlsClientCertPath: '',
      sshEnabled: false, sshHost: '', sshPort: '22', sshUsername: '',
      sshAuthMethod: 'key', sshPrivateKeyPath: '',
      connectTimeoutMs: '10000', socketTimeoutMs: '30000', serverSelectionTimeoutMs: '30000',
      readPreference: 'primary', maxPoolSize: '100', directConnection: false, appName: '',
      readOnly: false,
    });
  });

  it('the tabs are these four, holding these fields', () => {
    expect(CONNECTION_FORM_TABS).toEqual(['General', 'Authentication', 'TLS / SSH', 'Advanced']);
    expect(CONNECTION_FORM_TAB_FIELDS).toEqual({
      General: ['name', 'color', 'type', 'host', 'port', 'defaultDb', 'readOnly'],
      Authentication: ['authMech', 'authUsername', 'authDatabase', 'password', 'hasPasswordStored', 'clearPassword'],
      'TLS / SSH': [
        'tlsEnabled', 'tlsVerify', 'tlsCaPath', 'tlsClientCertPath',
        'sshEnabled', 'sshHost', 'sshPort', 'sshUsername', 'sshAuthMethod', 'sshPrivateKeyPath',
      ],
      Advanced: [
        'connectTimeoutMs', 'socketTimeoutMs', 'serverSelectionTimeoutMs',
        'readPreference', 'maxPoolSize', 'directConnection', 'appName',
      ],
    });
  });

  it('a form full of values saves every one of them', () => {
    expect(formToConnectionInput(FULL_FORM)).toEqual({
      name: 'Prod', color: '#112233', connectionType: 'srv',
      host: 'c0.example.net', port: 27018, defaultDb: 'shop',
      authMech: 'scram256', authUsername: 'ana', authDatabase: 'users', password: 'pw',
      tls: { enabled: true, verify: false, caPath: '/ca.pem', clientCertPath: '/client.pem' },
      ssh: {
        enabled: true, host: 'bastion', port: 2222, username: 'root',
        authMethod: 'password', privateKeyPath: '/id_rsa',
      },
      advanced: {
        connectTimeoutMs: 1, socketTimeoutMs: 2, serverSelectionTimeoutMs: 3,
        readPreference: 'nearest', maxPoolSize: 4, directConnection: true, appName: 'atelier',
      },
      readOnly: true,
    });
  });

  it('empty or zero fields fall back to the defaults, and empty strings are left out', () => {
    expect(
      formToConnectionInput({
        ...FULL_FORM,
        port: '', defaultDb: '', authUsername: '', authDatabase: '', password: '',
        tlsCaPath: '', tlsClientCertPath: '',
        sshHost: '', sshPort: '', sshUsername: '', sshPrivateKeyPath: '',
        connectTimeoutMs: '', socketTimeoutMs: '0', serverSelectionTimeoutMs: 'x', maxPoolSize: '', appName: '',
      }),
    ).toMatchObject({
      port: 27017, defaultDb: undefined,
      authUsername: undefined, authDatabase: undefined, password: undefined,
      tls: { caPath: undefined, clientCertPath: undefined },
      ssh: { host: undefined, port: 22, username: undefined, privateKeyPath: undefined },
      advanced: {
        connectTimeoutMs: 10_000, socketTimeoutMs: 30_000, serverSelectionTimeoutMs: 30_000,
        maxPoolSize: 100, appName: undefined,
      },
    });
  });

  it('SSH off saves no tunnel details', () => {
    expect(formToConnectionInput({ ...FULL_FORM, sshEnabled: false }).ssh).toEqual({ enabled: false });
  });

  it('a parsed URI that says everything replaces every field it names', () => {
    const base = withValues({ type: 'standard', host: 'old', port: '1' });
    const form = applyParsedUri(base, {
      connectionType: 'srv', host: 'c0.example.net', port: 27018, defaultDb: 'shop',
      authMech: 'scram256', authUsername: 'ana', authDatabase: 'users', password: 'pw',
      tls: { enabled: true, verify: false },
      advanced: {
        connectTimeoutMs: 1, socketTimeoutMs: 2, serverSelectionTimeoutMs: 3,
        readPreference: 'nearest', maxPoolSize: 4, directConnection: true, appName: 'atelier',
      },
    });
    expect(form).toEqual({
      ...base,
      type: 'srv', host: 'c0.example.net', port: '27018', defaultDb: 'shop',
      authMech: 'scram256', authUsername: 'ana', authDatabase: 'users', password: 'pw',
      tlsEnabled: true, tlsVerify: false,
      connectTimeoutMs: '1', socketTimeoutMs: '2', serverSelectionTimeoutMs: '3',
      readPreference: 'nearest', maxPoolSize: '4', directConnection: true, appName: 'atelier',
    });
  });

  it("a URI that names no advanced option keeps each of the form's own", () => {
    const base = withValues({
      connectTimeoutMs: '7', socketTimeoutMs: '8', serverSelectionTimeoutMs: '9',
      readPreference: 'secondary', maxPoolSize: '10', directConnection: true, appName: 'mine',
      tlsEnabled: true, tlsVerify: false,
    });
    expect(applyParsedUri(base, { advanced: {} as never, tls: {} as never })).toEqual(base);
  });
});
