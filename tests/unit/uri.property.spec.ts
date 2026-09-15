import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import type { Connection, AuthMech, ReadPref } from '@shared/types';
import { buildUri } from '../../electron/mongo/uri';
import { parseConnectionUri } from '../../electron/mongo/uri-parse';

function mkConn(overrides: Partial<Connection> = {}): Connection {
  const base: Connection = {
    id: 'id',
    name: 'Test',
    color: '#1A6835',
    connectionType: 'standard',
    readOnly: false,
    host: 'localhost',
    port: 27017,
    defaultDb: undefined,
    authMech: 'none',
    authUsername: undefined,
    authDatabase: undefined,
    tls: { enabled: false, verify: true },
    advanced: {
      connectTimeoutMs: 10_000,
      socketTimeoutMs: 30_000,
      serverSelectionTimeoutMs: 30_000,
      readPreference: 'primary',
      maxPoolSize: 100,
      directConnection: false,
    },
    hasPasswordStored: false,
    hasSshPasswordStored: false,
    hasSshPassphraseStored: false,
    createdAt: '',
    updatedAt: '',
  };
  return {
    ...base,
    ...overrides,
    tls: { ...base.tls, ...(overrides.tls ?? {}) },
    advanced: { ...base.advanced, ...(overrides.advanced ?? {}) },
  };
}

// Lowercase alnum labels only — sidesteps buildUri's WHATWG URL hostname
// normalization (ASCII-lowercasing, punycode for non-ASCII), which is a
// separate, already-covered concern (uri-builder.spec.ts's sanitizeHost
// tests). This property is about the userinfo/db/query round trip.
const labelArb = fc
  .array(fc.constantFrom(...'abcdefghijklmnopqrstuvwxyz0123456789'.split('')), {
    minLength: 1,
    maxLength: 8,
  })
  .map((chars) => chars.join(''));
const hostArb = fc.array(labelArb, { minLength: 1, maxLength: 3 }).map((labels) => labels.join('.'));

// Free-form text, including characters that need percent-encoding on the
// way into the URI (@ : / ? # % space) and unicode — the exact input shape
// mutation testing (which only strengthens assertions on inputs someone
// already wrote by hand) can't discover on its own.
const freeTextArb = fc.string({ minLength: 1, maxLength: 24 });

const undefinedOr = <T>(arb: fc.Arbitrary<T>) => fc.option(arb, { nil: undefined });

const READ_PREFS: ReadPref[] = ['primary', 'primaryPreferred', 'secondary', 'secondaryPreferred', 'nearest'];
const AUTH_MECHS: AuthMech[] = ['default', 'scram256', 'scram1', 'x509', 'awsiam', 'none'];

describe('uri round-trip property: parseConnectionUri(buildUri(connection))', () => {
  it('recovers every field buildUri actually encodes into the URI', () => {
    fc.assert(
      fc.property(
        fc.record({
          connectionType: fc.constantFrom<'srv' | 'standard'>('srv', 'standard'),
          host: hostArb,
          port: fc.integer({ min: 1, max: 65535 }),
          // MongoDB database names can't contain / \ . " $ * < > : | ? — so a
          // legal defaultDb can never trigger URL dot-segment normalization
          // (e.g. a lone "." path segment collapsing to "/" before parsing).
          // Also exclude leading/trailing whitespace: buildUri's own .trim()
          // would otherwise collapse an all-whitespace value to "" first.
          defaultDb: undefinedOr(
            freeTextArb.filter((s) => s === s.trim() && s.length > 0 && !/[/\\."$*<>:|?]/.test(s)),
          ),
          authMech: fc.constantFrom(...AUTH_MECHS),
          authUsername: freeTextArb,
          password: undefinedOr(freeTextArb),
          authDatabase: undefinedOr(freeTextArb),
          appName: undefinedOr(freeTextArb),
          directConnection: fc.boolean(),
          tlsEnabled: fc.boolean(),
          tlsVerify: fc.boolean(),
          readPreference: fc.constantFrom(...READ_PREFS),
        }),
        (f) => {
          const c = mkConn({
            connectionType: f.connectionType,
            host: f.host,
            port: f.port,
            defaultDb: f.defaultDb,
            authMech: f.authMech,
            authUsername: f.authUsername,
            authDatabase: f.authDatabase,
            tls: { enabled: f.tlsEnabled, verify: f.tlsVerify },
            advanced: {
              connectTimeoutMs: 10_000,
              socketTimeoutMs: 30_000,
              serverSelectionTimeoutMs: 30_000,
              readPreference: f.readPreference,
              maxPoolSize: 100,
              directConnection: f.directConnection,
              appName: f.appName,
            },
          });

          const uri = buildUri(c, f.password);
          const { input } = parseConnectionUri(uri);

          expect(input.connectionType).toBe(f.connectionType);
          expect(input.host).toBe(f.host);
          if (f.connectionType === 'standard') {
            expect(input.port).toBe(f.port);
          }
          expect(input.defaultDb).toBe(f.defaultDb);

          const noAuth = f.authMech === 'none';
          expect(input.authMech).toBe(noAuth ? 'none' : f.authMech);
          expect(input.authUsername).toBe(noAuth ? undefined : f.authUsername);
          expect(input.password).toBe(noAuth ? undefined : f.password);

          expect(input.authDatabase).toBe(f.authDatabase);
          expect(input.tls?.enabled).toBe(f.tlsEnabled);
          // verify is meaningless once tls is disabled — buildUri never emits
          // tlsAllowInvalidCertificates in that case, so parse always infers
          // true regardless of what was asked for. Pin the normalization,
          // don't dodge it.
          expect(input.tls?.verify).toBe(f.tlsEnabled ? f.tlsVerify : true);
          expect(input.advanced?.appName).toBe(f.appName);
          expect(input.advanced?.directConnection).toBe(f.directConnection);
          expect(input.advanced?.readPreference).toBe(f.readPreference);
        },
      ),
    );
  });

  it('never carries connect/socket/serverSelection timeout or pool size through the URI', () => {
    // buildOptions() owns these — buildUri() has no query param for them —
    // so parseConnectionUri always returns its own defaults, regardless of
    // what the original connection specified.
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 999_999 }),
        fc.integer({ min: 1, max: 999_999 }),
        fc.integer({ min: 1, max: 999_999 }),
        fc.integer({ min: 1, max: 999_999 }),
        (connectTimeoutMs, socketTimeoutMs, serverSelectionTimeoutMs, maxPoolSize) => {
          const c = mkConn({
            advanced: {
              connectTimeoutMs,
              socketTimeoutMs,
              serverSelectionTimeoutMs,
              readPreference: 'primary',
              maxPoolSize,
              directConnection: false,
            },
          });
          const { input } = parseConnectionUri(buildUri(c));
          expect(input.advanced?.connectTimeoutMs).toBe(10_000);
          expect(input.advanced?.socketTimeoutMs).toBe(30_000);
          expect(input.advanced?.serverSelectionTimeoutMs).toBe(30_000);
          expect(input.advanced?.maxPoolSize).toBe(100);
        },
      ),
    );
  });
});
