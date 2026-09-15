import { describe, it, expect } from 'vitest';
import { classifyMongoError } from '../../electron/mongo/errors';

describe('classifyMongoError', () => {
  it('AuthenticationFailed → AUTH', () => {
    expect(
      classifyMongoError({ code: 18, codeName: 'AuthenticationFailed', message: 'Authentication failed' }).code,
    ).toBe('AUTH');
  });

  it('Unauthorized → UNAUTHORIZED', () => {
    expect(
      classifyMongoError({ code: 13, codeName: 'Unauthorized', message: 'not authorized on db' }).code,
    ).toBe('UNAUTHORIZED');
  });

  it('MongoServerSelectionError → TIMEOUT', () => {
    expect(classifyMongoError({ name: 'MongoServerSelectionError', message: 'selection' }).code).toBe(
      'TIMEOUT',
    );
  });

  it('ENOTFOUND/ECONNREFUSED → NETWORK', () => {
    expect(classifyMongoError({ message: 'getaddrinfo ENOTFOUND nope' }).code).toBe('NETWORK');
    expect(classifyMongoError({ message: 'connect ECONNREFUSED 127.0.0.1:1' }).code).toBe('NETWORK');
  });

  it('TLS handshake failures → TLS_HANDSHAKE', () => {
    expect(
      classifyMongoError({
        message:
          'Client network socket disconnected before secure TLS connection was established',
      }).code,
    ).toBe('TLS_HANDSHAKE');
    expect(classifyMongoError({ message: 'SSL handshake failed' }).code).toBe('TLS_HANDSHAKE');
    expect(classifyMongoError({ message: 'TLS handshake timed out' }).code).toBe('TLS_HANDSHAKE');
  });

  it('certificate-level failures → TLS', () => {
    expect(classifyMongoError({ message: 'self-signed certificate' }).code).toBe('TLS');
    expect(classifyMongoError({ message: 'unable to verify the first certificate' }).code).toBe(
      'TLS',
    );
  });

  it('random errors → UNKNOWN', () => {
    expect(classifyMongoError({ message: 'something weird' }).code).toBe('UNKNOWN');
  });

  it('null/undefined → UNKNOWN', () => {
    expect(classifyMongoError(null).code).toBe('UNKNOWN');
    expect(classifyMongoError(undefined).code).toBe('UNKNOWN');
  });
});
