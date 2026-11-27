import { describe, it, expect } from 'vitest';
import { AgentToolError } from '../../electron/agent/errorMap';
import {
  assertProposalFields,
  fieldPathProblem,
  getProposalInputSchema,
  MAX_FIELD_PATH,
  MAX_REASON,
  proposeInputSchema,
} from '../../electron/agent/proposalInput';

const CONN = '0f0e0d0c-0b0a-4908-8706-050403020100';
const valid = {
  connectionId: CONN,
  sourceDb: 'shop',
  sourceCollection: 'orders',
  sourceField: 'customerId',
  targetDb: 'shop',
  targetCollection: 'customers',
  reason: 'orders.customerId holds customer ids',
};

function refusal(fn: () => void): AgentToolError {
  try {
    fn();
  } catch (err) {
    if (err instanceof AgentToolError) return err;
    throw err;
  }
  throw new Error('expected a refusal');
}

describe('fieldPathProblem', () => {
  it('accepts a plain and a dotted path', () => {
    expect(fieldPathProblem('customerId')).toBeNull();
    expect(fieldPathProblem('billing.customer_id')).toBeNull();
    expect(fieldPathProblem('a1.b2')).toBeNull();
    expect(fieldPathProblem('x$')).toBeNull();
  });

  it('accepts 256 characters and refuses 257 and none', () => {
    expect(MAX_FIELD_PATH).toBe(256);
    expect(fieldPathProblem('a'.repeat(256))).toBeNull();
    expect(fieldPathProblem('a'.repeat(257))).toBe('must be 1 to 256 characters');
    expect(fieldPathProblem('')).toBe('must be 1 to 256 characters');
  });

  it('refuses an empty segment anywhere', () => {
    expect(fieldPathProblem('.a')).toBe('has an empty segment');
    expect(fieldPathProblem('a.')).toBe('has an empty segment');
    expect(fieldPathProblem('a..b')).toBe('has an empty segment');
  });

  it('refuses a segment that starts with $', () => {
    expect(fieldPathProblem('$where')).toBe('has a segment that starts with $');
    expect(fieldPathProblem('a.$b')).toBe('has a segment that starts with $');
  });

  it('refuses an all-digit segment, an array index', () => {
    expect(fieldPathProblem('items.0')).toBe('has an array index as a segment');
    expect(fieldPathProblem('12')).toBe('has an array index as a segment');
    expect(fieldPathProblem('items.0a')).toBeNull();
    expect(fieldPathProblem('a0')).toBeNull();
  });
});

describe('assertProposalFields', () => {
  const fields = { ...valid, targetField: '_id' };

  it('passes a well-formed pair', () => {
    expect(() => assertProposalFields(fields)).not.toThrow();
  });

  it('names the argument at fault, never its value', () => {
    const src = refusal(() => assertProposalFields({ ...fields, sourceField: 'secret..value' }));
    expect(src.code).toBe('INVALID_INPUT');
    expect(src.message).toBe('The input is invalid. sourceField: has an empty segment');
    const tgt = refusal(() => assertProposalFields({ ...fields, targetField: '$secret' }));
    expect(tgt.message).toBe('The input is invalid. targetField: has a segment that starts with $');
  });

  it('refuses a field pointing at itself', () => {
    const same = { ...fields, targetCollection: 'orders', targetField: 'customerId' };
    const err = refusal(() => assertProposalFields(same));
    expect(err.code).toBe('INVALID_INPUT');
    expect(err.message).toBe('The input is invalid. the source and target are the same field');
  });

  it('allows the same field name on another collection or database, and another field on the same collection', () => {
    expect(() => assertProposalFields({ ...fields, targetCollection: 'orders', targetField: '_id' })).not.toThrow();
    expect(() => assertProposalFields({ ...fields, targetDb: 'other', targetCollection: 'orders', targetField: 'customerId' })).not.toThrow();
    expect(() => assertProposalFields({ ...fields, targetField: 'customerId' })).not.toThrow();
  });
});

describe('proposeInputSchema', () => {
  it('defaults the target field to _id', () => {
    expect(proposeInputSchema.parse(valid).targetField).toBe('_id');
  });

  it('takes a reason of 1 to 500 characters', () => {
    expect(MAX_REASON).toBe(500);
    expect(proposeInputSchema.safeParse({ ...valid, reason: 'x' }).success).toBe(true);
    expect(proposeInputSchema.safeParse({ ...valid, reason: 'x'.repeat(500) }).success).toBe(true);
    expect(proposeInputSchema.safeParse({ ...valid, reason: '' }).success).toBe(false);
    expect(proposeInputSchema.safeParse({ ...valid, reason: 'x'.repeat(501) }).success).toBe(false);
  });

  it('leaves the field path rules to check 3, so a malformed path still parses', () => {
    expect(proposeInputSchema.safeParse({ ...valid, sourceField: '' }).success).toBe(true);
    expect(proposeInputSchema.safeParse({ ...valid, sourceField: 'a'.repeat(257) }).success).toBe(true);
    expect(proposeInputSchema.safeParse({ ...valid, sourceField: 'a'.repeat(4097) }).success).toBe(false);
  });

  it('is strict and needs a UUID Connection and named namespaces', () => {
    expect(proposeInputSchema.safeParse({ ...valid, extra: 1 }).success).toBe(false);
    expect(proposeInputSchema.safeParse({ ...valid, connectionId: 'prod' }).success).toBe(false);
    expect(proposeInputSchema.safeParse({ ...valid, sourceDb: '' }).success).toBe(false);
    expect(proposeInputSchema.safeParse({ ...valid, targetCollection: 'c'.repeat(257) }).success).toBe(false);
  });
});

describe('getProposalInputSchema', () => {
  it('takes a Proposal id and nothing else', () => {
    expect(getProposalInputSchema.safeParse({ proposalId: CONN }).success).toBe(true);
    expect(getProposalInputSchema.safeParse({ proposalId: 'x' }).success).toBe(false);
    expect(getProposalInputSchema.safeParse({ proposalId: CONN, more: true }).success).toBe(false);
  });
});
