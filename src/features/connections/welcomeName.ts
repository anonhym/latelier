/** The longest name `conn:create` accepts. */
const MAX_NAME_LENGTH = 64;

/**
 * The name a Connection saved straight from a URI gets: its first host, with
 * ` 2`, ` 3`… appended while that name is taken. Names are unique by exact
 * match, so the comparison is too.
 */
export function connectionNameFromUri(host: string, existingNames: readonly string[]): string {
  const taken = new Set(existingNames);
  const base = host.slice(0, MAX_NAME_LENGTH);
  if (!taken.has(base)) return base;
  for (let n = 2; ; n += 1) {
    const suffix = ` ${n}`;
    const name = host.slice(0, MAX_NAME_LENGTH - suffix.length) + suffix;
    if (!taken.has(name)) return name;
  }
}

const REDACTED = '•••';

/**
 * `message` with everything secret in `uri` taken out: the URI itself, its
 * userinfo, and the password both as typed and as `password` (the decoded
 * form the parser returns). Main already keeps credentials out of its parse
 * and probe reasons; this is the renderer's own guarantee that nothing drawn
 * under a URI field echoes one. Longest first: each later secret sits inside
 * an earlier one, so the reverse order would leave the rest of it behind.
 */
export function redactUriSecrets(message: string, uri: string, password?: string): string {
  const trimmed = uri.trim();
  // Up to the last `@` before the path: a password may itself hold an `@`.
  const userinfo = /^[a-z+]+:\/\/([^/?#]*)@/i.exec(trimmed)?.[1];
  // Everything after the first colon: a password may itself hold one.
  const typedPassword = userinfo?.split(':').slice(1).join(':');
  return [trimmed, userinfo, typedPassword, password]
    .filter((secret): secret is string => !!secret)
    .reduce((text, secret) => text.split(secret).join(REDACTED), message);
}
