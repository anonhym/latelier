import type { Recipe, RecipeMatchInput, SuggestedActionId } from './types';

/** Button labels for each one-click action a recipe step can suggest. */
export const ACTION_LABEL: Record<SuggestedActionId, string> = {
  retryWithoutTls: 'Retry without TLS',
  retryDirectConnection: 'Retry with Direct connection',
};

export const TLS_INLINE_EXPLAINER =
  'Atlas and most managed MongoDB clusters require TLS. Self-hosted and dev MongoDB ' +
  'often run without TLS — if you see "Client network socket disconnected before secure ' +
  'TLS connection was established", turn this off.';

export const DIRECT_CONNECTION_INLINE_EXPLAINER =
  "Bypass replica-set discovery. Useful when a replica set's internal hostnames " +
  "(often Docker container hashes) aren't DNS-resolvable from this machine.";

export const RECIPES: Recipe[] = [
  {
    id: 'auth-default',
    match: ({ errorCode }) => errorCode === 'AUTH',
    title: 'Authentication failed',
    diagnosis:
      'The server received your credentials but rejected them. The two most common ' +
      "causes are an auth-database mismatch (MongoDB users live in a specific db, often " +
      "`admin`, not your application db) and a typo from copy-pasting credentials.",
    steps: [
      {
        title: 'Check the auth database',
        body:
          'On the **Auth** tab, the *Auth database* field is where the user record lives, ' +
          "not where you intend to read data. For Atlas and most cloud providers it is `admin`. " +
          "Your application database (e.g., `myapp`) goes in *Default database* on the **General** tab.",
      },
      {
        title: 'Verify the credentials byte-for-byte',
        body:
          "Paste the exact username and password your provider shows you. The form URL-encodes " +
          'special characters (`:`, `@`, `/`, `?`, `#`, `%`) for you — do not pre-encode them.',
      },
      {
        title: 'Confirm the user has at least one role',
        body:
          'A user with no roles authenticates but cannot read or write anything. Open a shell ' +
          'as an admin and run `db.getUser("<name>")` to inspect their roles.',
      },
    ],
    docAnchor: 'auth-default',
  },
  {
    id: 'docker-tls',
    match: ({ errorCode, message }) => {
      if (errorCode === 'TLS_HANDSHAKE') return true;
      // Backstop for older error paths that route to TIMEOUT/NETWORK with
      // a handshake-shaped message.
      return (
        (errorCode === 'TIMEOUT' || errorCode === 'NETWORK') &&
        !!message &&
        /ECONNRESET|TLS handshake|secure TLS connection/i.test(message)
      );
    },
    title: "Server doesn't speak TLS on this port",
    diagnosis:
      'TLS is on in the form, but the server reset the connection before the handshake ' +
      "completed. This almost always means the server isn't listening for TLS — common " +
      'with locally-run dev MongoDB and Docker images that ship without TLS by default.',
    steps: [
      {
        title: 'Toggle TLS off',
        body:
          'Open the **TLS** tab, uncheck *Enable TLS / SSL*, then **Test** again. ' +
          'If you control the server and want TLS, see the next step instead.',
        suggestedAction: 'retryWithoutTls',
      },
      {
        title: 'If you do need TLS',
        body:
          'Start the server with `--tlsMode requireTLS` and provide its CA in *CA Certificate* ' +
          'on the **TLS** tab. For self-signed certs, untick *Verify certificate* — but only ' +
          'as a last resort; prefer importing the CA.',
      },
    ],
    docAnchor: 'docker-tls',
  },
  {
    id: 'replica-host',
    match: ({ errorCode, message }) =>
      errorCode === 'TIMEOUT' &&
      !!message &&
      /getaddrinfo ENOTFOUND|EAI_AGAIN/i.test(message),
    title: "Replica-set host name doesn't resolve",
    diagnosis:
      "The server you reached belongs to a replica set, and the set advertised a hostname " +
      "your machine cannot resolve via DNS. This is the classic Docker symptom: the set's " +
      "internal hostnames are container ids only meaningful inside the Docker network.",
    steps: [
      {
        title: 'Turn on Direct connection',
        body:
          'Open the **Advanced** tab and toggle *Direct connection* on, then **Test** again. ' +
          'This skips replica-set discovery and talks directly to the host you typed.',
        suggestedAction: 'retryDirectConnection',
      },
      {
        title: 'If you genuinely need to reach the replica set',
        body:
          'Add `/etc/hosts` entries that map the advertised names to reachable IPs, or ' +
          'reconfigure the set with `host:port` pairs your machine can resolve. ' +
          '`rs.reconfig` on the primary, with public hostnames in `members[*].host`.',
      },
    ],
    docAnchor: 'replica-host',
  },
  {
    id: 'network-default',
    match: ({ errorCode }) => errorCode === 'NETWORK',
    title: "Can't reach the server",
    diagnosis:
      'The connection never got to the MongoDB protocol layer — TCP itself failed. The ' +
      'server may be down, blocked by a firewall, or unreachable from your network.',
    steps: [
      {
        title: 'Re-check host and port',
        body:
          'Typos here are the most common cause. Atlas connection strings hide the port; the ' +
          'standard one is **27017**. Self-hosted servers often pick something else.',
      },
      {
        title: 'Walk the network path',
        body:
          'From this machine, try `nc -zv <host> <port>` (or `Test-NetConnection` on Windows). ' +
          "If that fails, the issue is below MongoDB — VPN, firewall, or the server is down.",
      },
      {
        title: 'Atlas: check the IP allow-list',
        body:
          "Atlas blocks every connection by default. Add your current public IP under " +
          "**Network Access → IP Access List**. `0.0.0.0/0` works in a pinch but is unsafe " +
          'for anything past development.',
      },
    ],
    docAnchor: 'network-default',
  },
  {
    id: 'tls-default',
    match: ({ errorCode }) => errorCode === 'TLS',
    title: 'TLS handshake failed',
    diagnosis:
      "The server is speaking TLS, but our client and the server couldn't agree on a " +
      'certificate chain. Either the certificate is signed by a CA we don\'t trust, the ' +
      'hostname does not match the certificate, or the cert is expired.',
    steps: [
      {
        title: 'Provide the CA',
        body:
          'On the **TLS** tab, set *CA Certificate* to the issuer of the server cert. For ' +
          "Atlas this is the system trust store and works out of the box; for self-signed " +
          'or private CAs you must point us at the PEM file.',
      },
      {
        title: 'Match hostname',
        body:
          'The host in **General → Host** must match a Subject Alternative Name on the ' +
          'certificate. Connecting by IP when the cert names a hostname will fail here.',
      },
      {
        title: 'Last resort: untick Verify certificate',
        body:
          'On the **TLS** tab. This drops verification entirely, which is why the option ' +
          'is one toggle below the CA path. Use only on networks you trust.',
      },
    ],
    docAnchor: 'tls-default',
  },
  {
    id: 'unauthorized',
    match: ({ errorCode }) => errorCode === 'UNAUTHORIZED',
    title: 'User exists but lacks permission',
    diagnosis:
      'Authentication succeeded but the user is not allowed to perform the operation we ' +
      'tried. Roles in MongoDB are scoped to specific databases, so a user with `read` on ' +
      '`appA` cannot read `appB`.',
    steps: [
      {
        title: 'Identify the missing role',
        body:
          'Common ones: `read` / `readWrite` (per database), `readAnyDatabase` / ' +
          '`readWriteAnyDatabase` (cluster-wide), `userAdminAnyDatabase` (user management). ' +
          'Ask whoever owns the cluster to grant the smallest role that covers your need.',
      },
      {
        title: 'Verify with `db.runCommand({ connectionStatus: 1 })`',
        body:
          "From a shell as the same user, this command returns the user's authenticated " +
          'roles. If the list is empty or surprising, the password may be authenticating you ' +
          'as a *different* user with the same name in a different db.',
      },
    ],
    docAnchor: 'unauthorized',
  },
  {
    id: 'unknown',
    // Fallback — always matches if nothing above did.
    match: () => true,
    title: 'Connection failed',
    diagnosis:
      "We did not recognise this failure shape. The recipes below cover the most common " +
      'classes — open the one closest to your symptoms, or read the full guide.',
    steps: [
      {
        title: 'Authentication failed',
        body: 'Wrong username/password or wrong **Auth database**. See the full guide.',
      },
      {
        title: "Can't reach the server",
        body: 'Network, firewall, IP allow-list, server down. See the full guide.',
      },
      {
        title: 'TLS / certificate issues',
        body: 'CA mismatch, hostname mismatch, expired cert. See the full guide.',
      },
      {
        title: 'Replica-set name resolution',
        body: 'Docker hostnames not resolvable. Try **Direct connection** on Advanced.',
      },
    ],
    docAnchor: 'unknown',
  },
];

/**
 * Pick the first recipe whose `match` returns true. Always returns a recipe
 * because the last entry (`unknown`) matches unconditionally.
 */
export function pickRecipe(input: RecipeMatchInput): Recipe {
  for (const r of RECIPES) {
    let matched: boolean;
    try {
      matched = r.match(input);
    } catch {
      matched = false;
    }
    if (matched) return r;
  }
  // Defensive — RECIPES always ends with the unknown fallback.
  return RECIPES[RECIPES.length - 1]!;
}
