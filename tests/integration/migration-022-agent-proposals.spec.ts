import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createTempDb, type TempDb } from '../helpers/db';

describe('migration 022: Agent Proposals', () => {
  let tmp: TempDb;

  beforeEach(() => {
    tmp = createTempDb();
  });
  afterEach(() => tmp.cleanup());

  const names = () =>
    (tmp.db.prepare("SELECT name FROM sqlite_master WHERE type IN ('table','index')").all() as { name: string }[]).map((r) => r.name);

  const now = '2026-11-27T00:00:00.000Z';
  const insertProposal = (id: string, status: string | null, pairKey = 'k', extra: { kind?: string; savedFor?: string | null } = {}) =>
    tmp.db
      .prepare(
        `INSERT INTO agent_proposals (id, kind, status, connection_id, connection_name, source_db, source_collection, source_field,
          target_db, target_collection, target_field, pair_key, created_at, expires_at, saved_for)
         VALUES (?, ?, ?, 'c', 'prod', 'shop', 'orders', 'customerId', 'shop', 'customers', '_id', ?, ?, ?, ?)`,
      )
      .run(id, extra.kind ?? 'reference_rule', status, pairKey, now, now, extra.savedFor ?? null);

  it('creates both tables and their indexes, and records version 22', () => {
    expect(names()).toEqual(
      expect.arrayContaining([
        'agent_proposals',
        'agent_proposal_backers',
        'idx_agent_proposals_open_pair',
        'idx_agent_proposals_status',
        'idx_agent_proposals_created',
        'idx_agent_proposals_conn',
        'idx_agent_proposal_backers_token',
        'idx_agent_proposal_backers_session',
      ]),
    );
    expect((tmp.db.prepare('SELECT version FROM schema_version').get() as { version: number }).version).toBe(22);
  });

  it('accepts each status and refuses any other, or none', () => {
    for (const status of ['pending', 'later', 'accepted', 'declined', 'expired', 'obsolete']) insertProposal(`p-${status}`, status, status);
    expect(() => insertProposal('bad', 'approved', 'x')).toThrow(/CHECK/);
    expect(() => insertProposal('none', null, 'y')).toThrow(/NOT NULL/);
  });

  it('accepts only the reference_rule kind and the two save targets', () => {
    expect(() => insertProposal('k1', 'pending', 'a', { kind: 'saved_query' })).toThrow(/CHECK/);
    insertProposal('s1', 'accepted', 'b', { savedFor: 'connection' });
    insertProposal('s2', 'accepted', 'c', { savedFor: 'family' });
    expect(() => insertProposal('s3', 'accepted', 'd', { savedFor: 'everywhere' })).toThrow(/CHECK/);
  });

  it('allows one open Proposal per pair, and any number of decided ones', () => {
    insertProposal('open', 'pending', 'pair');
    expect(() => insertProposal('also-open', 'later', 'pair')).toThrow(/UNIQUE/);
    insertProposal('d1', 'declined', 'pair');
    insertProposal('d2', 'expired', 'pair');
    tmp.db.prepare("UPDATE agent_proposals SET status = 'accepted' WHERE id = 'open'").run();
    insertProposal('open-again', 'later', 'pair');
  });

  it('keys a backer on its Proposal and token, with a unique row id', () => {
    const insert = tmp.db.prepare(
      "INSERT INTO agent_proposal_backers (id, proposal_id, token_id, reason, created_at) VALUES (?, ?, ?, x'01', ?)",
    );
    insert.run('b1', 'p', 't1', now);
    insert.run('b2', 'p', 't2', now);
    expect(() => insert.run('b3', 'p', 't1', now)).toThrow(/UNIQUE|PRIMARY/);
    expect(() => insert.run('b1', 'q', 't1', now)).toThrow(/UNIQUE/);
    expect(() => tmp.db.prepare("INSERT INTO agent_proposal_backers (id, proposal_id, token_id, created_at) VALUES ('b4', 'p', 't4', ?)").run(now)).toThrow(/NOT NULL/);
  });

  it('has no foreign keys, so a Proposal outlives its tokens, sessions and Connection', () => {
    expect(tmp.db.prepare("PRAGMA foreign_key_list('agent_proposals')").all()).toEqual([]);
    expect(tmp.db.prepare("PRAGMA foreign_key_list('agent_proposal_backers')").all()).toEqual([]);
  });
});
