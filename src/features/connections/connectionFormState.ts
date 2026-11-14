import type { ConnectionInput } from '@shared/types';

/**
 * The connection form's fields, their defaults, which tab holds each, and the
 * two mappings every way in shares: a parsed URI onto the fields, and the
 * fields onto what main saves. A plain module rather than part of
 * `ConnectionForm.tsx`: a component file may only export components, and the
 * welcome canvas builds its Connection through the same two mappings.
 */
export type ConnectionFormState = {
  name: string;
  color: string;
  type: 'srv' | 'standard';
  host: string;
  port: string;
  defaultDb: string;

  authMech: 'default' | 'scram256' | 'scram1' | 'x509' | 'awsiam' | 'none';
  authUsername: string;
  authDatabase: string;
  password: string;
  hasPasswordStored: boolean;
  clearPassword: boolean;

  tlsEnabled: boolean;
  tlsVerify: boolean;
  tlsCaPath: string;
  tlsClientCertPath: string;

  sshEnabled: boolean;
  sshHost: string;
  sshPort: string;
  sshUsername: string;
  sshAuthMethod: 'key' | 'password';
  sshPrivateKeyPath: string;

  connectTimeoutMs: string;
  socketTimeoutMs: string;
  serverSelectionTimeoutMs: string;
  readPreference: 'primary' | 'primaryPreferred' | 'secondary' | 'secondaryPreferred' | 'nearest';
  maxPoolSize: string;
  directConnection: boolean;
  appName: string;

  readOnly: boolean;
};

/**
 * An empty create form: a local server. TLS is off with it, as choosing
 * Standard by hand turns it off; an SRV URI or the SRV type turns it back on.
 */
export const CONNECTION_FORM_DEFAULTS: ConnectionFormState = {
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
};

export const CONNECTION_FORM_TABS = ['General', 'Authentication', 'TLS / SSH', 'Advanced'] as const;
export type ConnectionFormTab = typeof CONNECTION_FORM_TABS[number];

export const CONNECTION_FORM_TAB_FIELDS: Record<ConnectionFormTab, ReadonlyArray<keyof ConnectionFormState>> = {
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
};

/** Whether `tab` holds a value that is not the empty form's: such a tab carries a dot. */
export function tabHasNonDefault(tab: ConnectionFormTab, form: ConnectionFormState): boolean {
  return CONNECTION_FORM_TAB_FIELDS[tab].some((field) => form[field] !== CONNECTION_FORM_DEFAULTS[field]);
}

/** A parsed URI laid over the fields; whatever the URI does not say keeps its value. */
export function applyParsedUri(f: ConnectionFormState, input: Partial<ConnectionInput>): ConnectionFormState {
  return {
    ...f,
    type: input.connectionType ?? f.type,
    host: input.host ?? f.host,
    port: input.port ? String(input.port) : f.port,
    defaultDb: input.defaultDb ?? f.defaultDb,
    authMech: input.authMech ?? f.authMech,
    authUsername: input.authUsername ?? f.authUsername,
    authDatabase: input.authDatabase ?? f.authDatabase,
    password: input.password ?? f.password,
    tlsEnabled: input.tls?.enabled ?? f.tlsEnabled,
    tlsVerify: input.tls?.verify ?? f.tlsVerify,
    connectTimeoutMs: input.advanced?.connectTimeoutMs
      ? String(input.advanced.connectTimeoutMs) : f.connectTimeoutMs,
    socketTimeoutMs: input.advanced?.socketTimeoutMs
      ? String(input.advanced.socketTimeoutMs) : f.socketTimeoutMs,
    serverSelectionTimeoutMs: input.advanced?.serverSelectionTimeoutMs
      ? String(input.advanced.serverSelectionTimeoutMs) : f.serverSelectionTimeoutMs,
    readPreference: input.advanced?.readPreference ?? f.readPreference,
    maxPoolSize: input.advanced?.maxPoolSize
      ? String(input.advanced.maxPoolSize) : f.maxPoolSize,
    directConnection: input.advanced?.directConnection ?? f.directConnection,
    appName: input.advanced?.appName ?? f.appName,
  };
}

/** What main saves or probes for these fields. */
export function formToConnectionInput(f: ConnectionFormState): ConnectionInput {
  return {
    name: f.name,
    color: f.color,
    connectionType: f.type,
    host: f.host,
    port: Number(f.port) || 27017,
    defaultDb: f.defaultDb || undefined,
    authMech: f.authMech,
    authUsername: f.authMech === 'none' ? undefined : f.authUsername || undefined,
    authDatabase: f.authMech === 'none' ? undefined : f.authDatabase || undefined,
    password: f.authMech === 'none' ? undefined : f.password || undefined,
    tls: {
      enabled: f.tlsEnabled,
      verify: f.tlsVerify,
      caPath: f.tlsCaPath || undefined,
      clientCertPath: f.tlsClientCertPath || undefined,
    },
    ssh: f.sshEnabled
      ? {
          enabled: true,
          host: f.sshHost || undefined,
          port: Number(f.sshPort) || 22,
          username: f.sshUsername || undefined,
          authMethod: f.sshAuthMethod,
          privateKeyPath: f.sshPrivateKeyPath || undefined,
        }
      : { enabled: false },
    advanced: {
      connectTimeoutMs: Number(f.connectTimeoutMs) || 10_000,
      socketTimeoutMs: Number(f.socketTimeoutMs) || 30_000,
      serverSelectionTimeoutMs: Number(f.serverSelectionTimeoutMs) || 30_000,
      readPreference: f.readPreference,
      maxPoolSize: Number(f.maxPoolSize) || 100,
      directConnection: f.directConnection,
      appName: f.appName || undefined,
    },
    readOnly: f.readOnly,
  };
}
