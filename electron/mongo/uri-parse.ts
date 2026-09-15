import ConnectionString from 'mongodb-connection-string-url';
import type {
  AuthMech,
  ConnectionInput,
  ParsedUri,
  ParsedUriWarning,
  ReadPref,
} from '@shared/types';
import { ValidationError } from '../errors.ts';

const AUTH_MECH_MAP: Record<string, AuthMech> = {
  'SCRAM-SHA-256': 'scram256',
  'SCRAM-SHA-1': 'scram1',
  'MONGODB-X509': 'x509',
  'MONGODB-AWS': 'awsiam',
};

const READ_PREFS: ReadPref[] = [
  'primary',
  'primaryPreferred',
  'secondary',
  'secondaryPreferred',
  'nearest',
];

const DROPPED_OPTIONS = new Set([
  'retrywrites',
  'w',
  'wtimeoutms',
  'journal',
  'replicaset',
  'loadbalanced',
  'readconcernlevel',
]);

/**
 * Parse a pasted mongodb:// or mongodb+srv:// URI into a partial
 * ConnectionInput. Does not persist anything. The caller merges the result
 * into the NewConnection form state.
 *
 * Throws ValidationError if the URI cannot be parsed at all.
 */
export function parseConnectionUri(raw: string): ParsedUri {
  const trimmed = raw.trim();
  if (!trimmed) {
    throw new ValidationError('URI is empty');
  }
  if (!/^mongodb(\+srv)?:\/\//.test(trimmed)) {
    throw new ValidationError(
      'URI must start with mongodb:// or mongodb+srv://',
    );
  }

  // Defensive: `mongodb+srv://host:port/…` is malformed per the spec, but
  // pasting such a URI shouldn't hard-fail. Strip the port silently and
  // surface a warning at the end.
  const srvPortStripped: string[] = [];
  let normalized = trimmed;
  if (normalized.startsWith('mongodb+srv://')) {
    normalized = normalized.replace(
      /^(mongodb\+srv:\/\/(?:[^@/]*@)?)([^/?]+)/,
      (_full, prefix: string, hostSegment: string) => {
        const cleaned = hostSegment
          .split(',')
          .map((h) => {
            const m = h.match(/^(.*?):(\d+)$/);
            if (m) {
              srvPortStripped.push(m[0]!);
              return m[1]!;
            }
            return h;
          })
          .join(',');
        return prefix + cleaned;
      },
    );
  }

  let cs: ConnectionString;
  try {
    cs = new ConnectionString(normalized);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new ValidationError(`could not parse URI: ${msg}`);
  }

  const warnings: ParsedUriWarning[] = [];
  const isSrv = cs.isSRV;

  if (srvPortStripped.length > 0) {
    warnings.push({
      code: 'OPTION_DROPPED',
      detail: `SRV URIs cannot include a port; stripped: ${srvPortStripped.join(', ')}`,
    });
  }

  // Hosts ---------------------------------------------------------------
  const hosts = cs.hosts ?? [];
  if (hosts.length === 0) {
    throw new ValidationError('URI has no host');
  }
  if (hosts.length > 1) {
    warnings.push({
      code: 'MULTI_HOST_TRUNCATED',
      detail: `Only the first host was captured (${hosts[0]}). Replica-set host lists aren't modeled in iteration 1.`,
    });
  }
  const firstHost = hosts[0]!;
  // host:port split (SRV always has no port)
  let host = firstHost;
  let port = 27017;
  if (!isSrv) {
    const idx = firstHost.lastIndexOf(':');
    if (idx >= 0) {
      const p = Number(firstHost.slice(idx + 1));
      if (Number.isFinite(p) && p > 0) {
        port = p;
        host = firstHost.slice(0, idx);
      }
    }
  }

  // Path → default_db ---------------------------------------------------
  // decodeURIComponent throws a raw URIError on malformed percent-encoding
  // (e.g. `db%zzname`). Unlike the username/password below — where a bad
  // escape makes `new ConnectionString(...)` itself throw, already caught
  // above — this decode happens after construction succeeds, so it needs
  // its own try/catch to keep the same ValidationError taxonomy.
  let defaultDb: string | undefined;
  const pathname = cs.pathname ?? '';
  if (pathname && pathname !== '/') {
    try {
      defaultDb = decodeURIComponent(pathname.replace(/^\//, ''));
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      throw new ValidationError(`could not parse URI: malformed database path (${msg})`);
    }
    if (!defaultDb) defaultDb = undefined;
  }

  // Userinfo ------------------------------------------------------------
  const authUsername = cs.username ? decodeURIComponent(cs.username) : undefined;
  const password = cs.password ? decodeURIComponent(cs.password) : undefined;

  // Query params (case-insensitive) -------------------------------------
  const params = new Map<string, string>();
  for (const [k, v] of cs.searchParams.entries()) {
    params.set(k.toLowerCase(), v);
  }

  // Auth mechanism ------------------------------------------------------
  const mechParam = params.get('authmechanism');
  let authMech: AuthMech;
  if (mechParam) {
    const mapped = AUTH_MECH_MAP[mechParam.toUpperCase()];
    if (!mapped) {
      throw new ValidationError(
        `unsupported authMechanism: ${mechParam}`,
      );
    }
    authMech = mapped;
  } else {
    // No explicit mechanism — let the driver negotiate when creds are present.
    authMech = authUsername ? 'default' : 'none';
  }

  // TLS -----------------------------------------------------------------
  const tlsParam = params.get('tls') ?? params.get('ssl');
  const tlsAllow = params.get('tlsallowinvalidcertificates');
  // SRV implies TLS on the server unless explicitly disabled.
  let tlsEnabled: boolean;
  if (tlsParam !== undefined) {
    tlsEnabled = tlsParam === 'true';
  } else {
    tlsEnabled = isSrv;
  }
  const tlsVerify = tlsAllow === 'true' ? false : true;

  // Advanced options ----------------------------------------------------
  const connectTimeoutMs = parseIntParam(params.get('connecttimeoutms'), 10_000);
  const socketTimeoutMs = parseIntParam(params.get('sockettimeoutms'), 30_000);
  const serverSelectionTimeoutMs = parseIntParam(
    params.get('serverselectiontimeoutms'),
    30_000,
  );
  const maxPoolSize = parseIntParam(params.get('maxpoolsize'), 100);
  const directConnection = params.get('directconnection') === 'true';
  const appName = params.get('appname') ?? undefined;

  const readPrefParam = params.get('readpreference');
  const readPreference: ReadPref =
    readPrefParam && (READ_PREFS as string[]).includes(readPrefParam)
      ? (readPrefParam as ReadPref)
      : 'primary';

  const authDatabase = params.get('authsource') ?? undefined;

  // Warn on dropped options
  for (const [k] of params.entries()) {
    if (DROPPED_OPTIONS.has(k)) {
      warnings.push({ code: 'OPTION_DROPPED', detail: k });
    }
  }

  const input: Partial<ConnectionInput> = {
    connectionType: isSrv ? 'srv' : 'standard',
    host,
    port,
    defaultDb,
    authMech,
    authUsername,
    authDatabase,
    password,
    tls: {
      enabled: tlsEnabled,
      verify: tlsVerify,
    },
    advanced: {
      connectTimeoutMs,
      socketTimeoutMs,
      serverSelectionTimeoutMs,
      readPreference,
      maxPoolSize,
      directConnection,
      appName,
    },
  };

  return { input, warnings };
}

function parseIntParam(raw: string | undefined, fallback: number): number {
  if (!raw) return fallback;
  const n = Number(raw);
  return Number.isFinite(n) && n >= 0 ? Math.round(n) : fallback;
}
