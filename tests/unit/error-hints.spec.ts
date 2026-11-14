import { describe, it, expect } from 'vitest';
import { editDistance, errorHint, nearestOperator } from '../../src/pages/Workspace/errorHints';

describe('editDistance', () => {
  it.each([
    ['', '', 0],
    ['abc', 'abc', 0],
    ['', 'abc', 3],
    ['abc', '', 3],
    ['kitten', 'sitting', 3],
    ['$gtt', '$gt', 1],
    ['$gt', '$gtt', 1],
    ['$regx', '$regex', 1],
    ['$exsits', '$exists', 2],
    ['ab', 'ba', 2],
    ['abc', 'axc', 1],
  ])('%s to %s is %d', (a, b, distance) => {
    expect(editDistance(a, b)).toBe(distance);
  });
});

describe('nearestOperator', () => {
  it.each([
    ['$regx', '$regex'],
    ['$exsits', '$exists'],
    ['$siz', '$size'],
    ['$elemMatc', '$elemMatch'],
    ['$geoWithi', '$geoWithin'],
  ])('answers %s with %s', (typed, nearest) => {
    expect(nearestOperator(typed)).toBe(nearest);
  });

  it('takes the closest one, and the first in catalog order on a tie', () => {
    // `$gt` and `$gte` are both one edit from `$gtt`; `$gt` comes first.
    expect(nearestOperator('$gtt')).toBe('$gt');
    // `$in` is one edit away, `$nin` two.
    expect(nearestOperator('$inn')).toBe('$in');
  });

  it('is null past two edits', () => {
    expect(nearestOperator('$zzzzzzzz')).toBeNull();
    expect(nearestOperator('$regularexp')).toBeNull();
    // Three edits from `$exists`, the nearest.
    expect(nearestOperator('$exsitss')).toBeNull();
  });

  it('reads only a single edit as a typo in a short name', () => {
    // Two edits from `$or`: a guess, not a typo.
    expect(nearestOperator('$foo')).toBeNull();
    expect(nearestOperator('$adn')).toBeNull();
    // Five characters is still short; six is not.
    expect(nearestOperator('$sizz')).toBe('$size');
    expect(nearestOperator('$szie')).toBeNull();
    expect(nearestOperator('$regxe')).toBe('$regex');
  });

  it('never answers an operator that exists, in a filter or elsewhere', () => {
    expect(nearestOperator('$gt')).toBeNull();
    // A stage is not what a find meant, but it is not a typo either.
    expect(nearestOperator('$match')).toBeNull();
    expect(nearestOperator('$sum')).toBeNull();
  });

  it('never suggests a stage or an accumulator', () => {
    // One edit from `$match`, which a filter cannot hold.
    expect(nearestOperator('$matc')).not.toBe('$match');
  });
});

describe('errorHint', () => {
  it('suggests the nearest operator for an unknown one', () => {
    expect(errorHint({ code: 'MONGO_ERROR', message: 'unknown operator: $regx' })).toBe('Did you mean $regex?');
    expect(errorHint({ code: 'MONGO_ERROR', message: 'unknown top level operator: $andd.' })).toBe(
      'Did you mean $and?',
    );
    expect(errorHint({ code: 'MONGO_ERROR', message: 'Unknown Operator: $exsits' })).toBe('Did you mean $exists?');
  });

  it('has no hint for an unknown operator with nothing near it, or none named', () => {
    expect(errorHint({ code: 'MONGO_ERROR', message: 'unknown operator: $zzzzzzzz' })).toBeNull();
    expect(errorHint({ code: 'MONGO_ERROR', message: 'unknown operator' })).toBeNull();
  });

  it('does not read an unknown-operator message as a connection problem', () => {
    expect(errorHint({ code: 'NETWORK', message: 'unknown operator: $zzzzzzzz, connection refused' })).toBeNull();
  });

  it('only looks for a typo in an unknown-operator message', () => {
    expect(errorHint({ code: 'MONGO_ERROR', message: 'bad value for $regx' })).toBeNull();
  });

  it('says the server is not reachable on a refused connection', () => {
    expect(errorHint({ code: 'NETWORK', message: 'connect ECONNREFUSED 127.0.0.1:27017' })).toBe(
      'The server is not reachable.',
    );
    expect(errorHint({ code: 'NETWORK', message: 'Connection refused by host' })).toBe(
      'The server is not reachable.',
    );
  });

  it('points at Socket timeout for a socket or connection that timed out', () => {
    const hint = "Raise Socket timeout in the connection's Advanced tab.";
    expect(errorHint({ code: 'NETWORK', message: 'connection 3 to db:27017 timed out' })).toBe(hint);
    expect(errorHint({ code: 'NETWORK', message: 'Socket Timed Out' })).toBe(hint);
  });

  it('has no hint for a timeout that setting does not move', () => {
    expect(errorHint({ code: 'TIMEOUT', message: 'connection 3 to db:27017 timed out' })).toBeNull();
    expect(errorHint({ code: 'NETWORK', message: 'operation timed out' })).toBeNull();
    expect(errorHint({ code: 'NETWORK', message: 'connection closed' })).toBeNull();
    expect(errorHint({ code: 'NETWORK', message: 'socket closed' })).toBeNull();
  });

  it('has no hint when the message is all there is to say', () => {
    expect(errorHint({ code: 'MONGO_ERROR', message: 'E11000 duplicate key' })).toBeNull();
  });
});
