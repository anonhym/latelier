import { describe, it, expect } from 'vitest';
import type { ConnectionInput } from '@shared/types';
import {
  ConnectionInputSchema,
  ConnectionTestInputSchema,
  ConnectionUpdateSchema,
} from '../../electron/ipc/schemas/connection';

function mk(overrides: Partial<ConnectionInput> = {}): ConnectionInput {
  const base: ConnectionInput = {
    name: 'Test',
    color: '#1A6835',
    connectionType: 'standard',
    readOnly: false,
    host: 'localhost',
    port: 27017,
    authMech: 'none',
    tls: { enabled: false, verify: true },
    advanced: {
      connectTimeoutMs: 10_000,
      socketTimeoutMs: 30_000,
      serverSelectionTimeoutMs: 30_000,
      readPreference: 'primary',
      maxPoolSize: 100,
      directConnection: false,
    },
  };
  return { ...base, ...overrides, tls: { ...base.tls, ...(overrides.tls ?? {}) } };
}

function issueAt(err: unknown, segment: string): boolean {
  if (!(err instanceof Error)) return false;
  // ZodError carries `.issues` on Zod v4.
  const issues = (err as unknown as { issues?: Array<{ path: (string | number)[] }> }).issues;
  if (!issues) return false;
  return issues.some((i) => i.path.includes(segment));
}

describe('ConnectionInputSchema', () => {
  it('accepts a minimal valid none-auth input', () => {
    expect(() => ConnectionInputSchema.parse(mk())).not.toThrow();
  });

  it('rejects missing password on SCRAM', () => {
    const input = mk({ authMech: 'scram256', authUsername: 'alice' });
    try {
      ConnectionInputSchema.parse(input);
      throw new Error('expected throw');
    } catch (err) {
      expect(issueAt(err, 'password')).toBe(true);
    }
  });

  it('rejects missing username on SCRAM', () => {
    const input = mk({ authMech: 'scram256', password: 'pw' });
    try {
      ConnectionInputSchema.parse(input);
      throw new Error('expected throw');
    } catch (err) {
      expect(issueAt(err, 'authUsername')).toBe(true);
    }
  });

  it('rejects X.509 without TLS enabled', () => {
    const input = mk({
      authMech: 'x509',
      tls: { enabled: false, verify: true, clientCertPath: '/abs/client.pem' },
    });
    try {
      ConnectionInputSchema.parse(input);
      throw new Error('expected throw');
    } catch (err) {
      expect(issueAt(err, 'enabled')).toBe(true);
    }
  });

  it('rejects X.509 without client cert path', () => {
    const input = mk({
      authMech: 'x509',
      tls: { enabled: true, verify: true },
    });
    try {
      ConnectionInputSchema.parse(input);
      throw new Error('expected throw');
    } catch (err) {
      expect(issueAt(err, 'clientCertPath')).toBe(true);
    }
  });

  it('rejects AWS IAM without access key id', () => {
    const input = mk({ authMech: 'awsiam', password: 'secret' });
    try {
      ConnectionInputSchema.parse(input);
      throw new Error('expected throw');
    } catch (err) {
      expect(issueAt(err, 'authUsername')).toBe(true);
    }
  });

  it('rejects auth-mech=none with non-empty credentials', () => {
    const input = mk({ authMech: 'none', authUsername: 'alice' });
    try {
      ConnectionInputSchema.parse(input);
      throw new Error('expected throw');
    } catch (err) {
      expect(issueAt(err, 'authUsername')).toBe(true);
    }
  });

  it('rejects malformed color', () => {
    const input = mk({ color: 'red' });
    expect(() => ConnectionInputSchema.parse(input)).toThrow();
  });

  it('rejects out-of-range port', () => {
    const input = mk({ port: 0 });
    expect(() => ConnectionInputSchema.parse(input)).toThrow();
    const input2 = mk({ port: 70_000 });
    expect(() => ConnectionInputSchema.parse(input2)).toThrow();
  });

  it('rejects empty name', () => {
    const input = mk({ name: '' });
    expect(() => ConnectionInputSchema.parse(input)).toThrow();
  });

  it('rejects too-small timeout', () => {
    const input = mk({
      advanced: {
        ...mk().advanced,
        connectTimeoutMs: 10, // below 1000 minimum
      },
    });
    expect(() => ConnectionInputSchema.parse(input)).toThrow();
  });

  it('rejects relative TLS paths', () => {
    const input = mk({
      tls: { enabled: true, verify: true, caPath: 'relative/ca.pem' },
    });
    try {
      ConnectionInputSchema.parse(input);
      throw new Error('expected throw');
    } catch (err) {
      expect(issueAt(err, 'caPath')).toBe(true);
    }
  });

  it('accepts absolute TLS paths', () => {
    const input = mk({
      tls: { enabled: true, verify: true, caPath: '/etc/ssl/ca.pem' },
    });
    expect(() => ConnectionInputSchema.parse(input)).not.toThrow();
  });

  it('requires SSH host and username when ssh.enabled', () => {
    const input = mk({ ssh: { enabled: true } });
    try {
      ConnectionInputSchema.parse(input);
      throw new Error('expected throw');
    } catch (err) {
      expect(issueAt(err, 'host') || issueAt(err, 'username')).toBe(true);
    }
  });
});

describe('ConnectionTestInputSchema', () => {
  it('accepts SCRAM without password (probe may test wrong creds)', () => {
    const input = mk({ authMech: 'scram256', authUsername: 'alice' });
    expect(() => ConnectionTestInputSchema.parse(input)).not.toThrow();
  });

  it('still requires TLS for X.509', () => {
    const input = mk({ authMech: 'x509', tls: { enabled: false, verify: true } });
    expect(() => ConnectionTestInputSchema.parse(input)).toThrow();
  });
});

describe('ConnectionUpdateSchema', () => {
  it('accepts empty patch', () => {
    expect(() => ConnectionUpdateSchema.parse({})).not.toThrow();
  });

  it('accepts partial patch with only color', () => {
    expect(() => ConnectionUpdateSchema.parse({ color: '#1A5068' })).not.toThrow();
  });

  it('allows clearPassword without requiring password', () => {
    expect(() =>
      ConnectionUpdateSchema.parse({ clearPassword: true }),
    ).not.toThrow();
  });

  it('still enforces X.509 TLS rule when authMech is set in patch', () => {
    expect(() =>
      ConnectionUpdateSchema.parse({
        authMech: 'x509',
        tls: { enabled: false, verify: true },
      }),
    ).toThrow();
  });
});
