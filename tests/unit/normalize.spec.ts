import { describe, it, expect } from 'vitest';
import { normalizeConnectionInput } from '../../electron/mongo/normalize';

describe('normalizeConnectionInput', () => {
  it('trims and collapses whitespace in name', () => {
    const out = normalizeConnectionInput({ name: '  my   conn  ' });
    expect(out.name).toBe('my conn');
  });

  it('lowercases host', () => {
    const out = normalizeConnectionInput({ host: ' CLUSTER.MongoDB.NET ' });
    expect(out.host).toBe('cluster.mongodb.net');
  });

  it('trims authUsername, authDatabase, defaultDb', () => {
    const out = normalizeConnectionInput({
      authUsername: '  alice  ',
      authDatabase: '  admin  ',
      defaultDb: '  mydb  ',
    });
    expect(out.authUsername).toBe('alice');
    expect(out.authDatabase).toBe('admin');
    expect(out.defaultDb).toBe('mydb');
  });

  it('trims appName within advanced', () => {
    const out = normalizeConnectionInput({
      advanced: {
        connectTimeoutMs: 1000,
        socketTimeoutMs: 1000,
        serverSelectionTimeoutMs: 1000,
        readPreference: 'primary',
        maxPoolSize: 1,
        directConnection: false,
        appName: '  my-app  ',
      },
    });
    expect(out.advanced?.appName).toBe('my-app');
  });

  it('trims TLS paths', () => {
    const out = normalizeConnectionInput({
      tls: { enabled: true, verify: true, caPath: '  /abs/ca.pem  ' },
    });
    expect(out.tls?.caPath).toBe('/abs/ca.pem');
  });

  it('leaves unrelated fields alone', () => {
    const out = normalizeConnectionInput({ color: '#1A6835', port: 27017 });
    expect(out.color).toBe('#1A6835');
    expect(out.port).toBe(27017);
  });

  it('is non-destructive of the input object', () => {
    const original = { name: '  X  ' };
    const out = normalizeConnectionInput(original);
    expect(original.name).toBe('  X  ');
    expect(out.name).toBe('X');
  });
});
