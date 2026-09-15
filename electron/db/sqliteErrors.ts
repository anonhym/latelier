/**
 * True only for unique-/primary-key conflicts. Other constraint failures
 * (NOT NULL, CHECK, FOREIGN KEY) deliberately fall through so callers don't
 * mislabel them as `ConflictError`. better-sqlite3 emits extended result
 * codes by default, so the parent `SQLITE_CONSTRAINT` is intentionally
 * excluded.
 */
export function isUniqueConstraintError(err: unknown): boolean {
  if (typeof err !== 'object' || err === null) return false;
  const code = (err as { code?: string }).code;
  return code === 'SQLITE_CONSTRAINT_UNIQUE' || code === 'SQLITE_CONSTRAINT_PRIMARYKEY';
}
