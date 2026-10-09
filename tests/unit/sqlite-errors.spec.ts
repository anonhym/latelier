import { describe, it, expect } from 'vitest';
import {
  isForeignKeyConstraintError,
  isUniqueConstraintError,
  rethrowMissingConnection,
} from '../../electron/db/sqliteErrors';
import { NotFoundError } from '../../electron/errors';

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

describe('rethrowMissingConnection', () => {
  it('turns a foreign-key violation into a NotFoundError naming the connection', () => {
    const fk = Object.assign(new Error('FOREIGN KEY constraint failed'), {
      code: 'SQLITE_CONSTRAINT_FOREIGNKEY',
    });
    expect(() => rethrowMissingConnection(fk, 'c-1')).toThrow(NotFoundError);
    expect(() => rethrowMissingConnection(fk, 'c-1')).toThrow('connection c-1 not found');
  });

  it('rethrows any other error as the very same object', () => {
    const notNull = Object.assign(new Error('NOT NULL constraint failed'), {
      code: 'SQLITE_CONSTRAINT_NOTNULL',
    });
    let caught: unknown;
    try {
      rethrowMissingConnection(notNull, 'c-1');
    } catch (err) {
      caught = err;
    }
    expect(caught).toBe(notNull);
  });
});
