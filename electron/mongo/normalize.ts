import type { ConnectionInput } from '@shared/types';

/**
 * Apply the normalization rules from C01 §4 before validation/persistence.
 *
 * - trim() on identifying strings
 * - collapse internal whitespace in `name` to single spaces
 * - lowercase `host`
 * - preserve explicit port values even when they match scheme defaults
 */
export function normalizeConnectionInput<T extends Partial<ConnectionInput>>(input: T): T {
  const out = { ...input } as T;
  if (typeof out.name === 'string') {
    out.name = out.name.trim().replace(/\s+/g, ' ');
  }
  if (typeof out.host === 'string') {
    out.host = out.host.trim().toLowerCase();
  }
  if (typeof out.authUsername === 'string') {
    out.authUsername = out.authUsername.trim();
  }
  if (typeof out.authDatabase === 'string') {
    out.authDatabase = out.authDatabase.trim();
  }
  if (typeof out.defaultDb === 'string') {
    out.defaultDb = out.defaultDb.trim();
  }
  if (out.advanced && typeof out.advanced.appName === 'string') {
    out.advanced = { ...out.advanced, appName: out.advanced.appName.trim() };
  }
  if (out.tls) {
    const tls = { ...out.tls };
    if (typeof tls.caPath === 'string') tls.caPath = tls.caPath.trim();
    if (typeof tls.clientCertPath === 'string') tls.clientCertPath = tls.clientCertPath.trim();
    out.tls = tls;
  }
  if (out.ssh) {
    const ssh = { ...out.ssh };
    if (typeof ssh.host === 'string') ssh.host = ssh.host.trim();
    if (typeof ssh.username === 'string') ssh.username = ssh.username.trim();
    if (typeof ssh.privateKeyPath === 'string')
      ssh.privateKeyPath = ssh.privateKeyPath.trim();
    out.ssh = ssh;
  }
  return out;
}
