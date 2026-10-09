import { describe, it, expect } from 'vitest';
import { isForeignKeyConstraintError, isUniqueConstraintError } from '../../electron/db/sqliteErrors';

describe('isUniqueConstraintError', () => {
  it('matches SQLITE_CONSTRAINT_UNIQUE', () => {
    expect(isUniqueConstraintError({ code: 'SQLITE_CONSTRAINT_UNIQUE' })).toBe(true);
  });

  it('matches SQLITE_CONSTRAINT_PRIMARYKEY', () => {
    expect(isUniqueConstraintError({ code: 'SQLITE_CONSTRAINT_PRIMARYKEY' })).toBe(true);
  });

  it('does not match the parent SQLITE_CONSTRAINT code', () => {
    // Extended codes are enabled by default in better-sqlite3, so the parent
    // code should never appear; if it does, refusing to label it as a
    // unique-conflict avoids masking NOT NULL / CHECK / FK errors.
    expect(isUniqueConstraintError({ code: 'SQLITE_CONSTRAINT' })).toBe(false);
  });

  it.each([
    'SQLITE_CONSTRAINT_NOTNULL',
    'SQLITE_CONSTRAINT_CHECK',
    'SQLITE_CONSTRAINT_FOREIGNKEY',
    'SQLITE_CONSTRAINT_TRIGGER',
  ])('does not match %s', (code) => {
    expect(isUniqueConstraintError({ code })).toBe(false);
  });

  it('returns false for non-objects and missing code', () => {
    expect(isUniqueConstraintError(null)).toBe(false);
    expect(isUniqueConstraintError(undefined)).toBe(false);
    expect(isUniqueConstraintError('SQLITE_CONSTRAINT_UNIQUE')).toBe(false);
    expect(isUniqueConstraintError({})).toBe(false);
    expect(isUniqueConstraintError(new Error('boom'))).toBe(false);
  });
});

describe('isForeignKeyConstraintError', () => {
  it('matches SQLITE_CONSTRAINT_FOREIGNKEY', () => {
    expect(isForeignKeyConstraintError({ code: 'SQLITE_CONSTRAINT_FOREIGNKEY' })).toBe(true);
  });

  it.each([
    'SQLITE_CONSTRAINT',
    'SQLITE_CONSTRAINT_UNIQUE',
    'SQLITE_CONSTRAINT_PRIMARYKEY',
    'SQLITE_CONSTRAINT_NOTNULL',
    'SQLITE_CONSTRAINT_CHECK',
    'SQLITE_CONSTRAINT_TRIGGER',
  ])('does not match %s', (code) => {
    expect(isForeignKeyConstraintError({ code })).toBe(false);
  });

  it('returns false for non-objects and missing code', () => {
    expect(isForeignKeyConstraintError(null)).toBe(false);
    expect(isForeignKeyConstraintError(undefined)).toBe(false);
    expect(isForeignKeyConstraintError('SQLITE_CONSTRAINT_FOREIGNKEY')).toBe(false);
    expect(isForeignKeyConstraintError({})).toBe(false);
    expect(isForeignKeyConstraintError(new Error('boom'))).toBe(false);
  });
});
