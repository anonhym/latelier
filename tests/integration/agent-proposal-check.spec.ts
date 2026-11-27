import { describe, it, expect, afterEach, vi } from 'vitest';
import { createReadFixture, type ReadFixture } from '../helpers/agentFixture';
import { textOf } from '../helpers/agentSocket';

/** X28 §5: the user's check of a Proposal, on a real pool over the memory server. */
describe('the Proposal check', () => {
  let f: ReadFixture;

  afterEach(async () => {
    vi.restoreAllMocks();
    await f?.cleanup();
  });

  async function proposal(sourceCollection: string, sourceField: string, targetCollection = 'customers'): Promise<string> {
    const r = await f.call('propose_reference_rule', {
      connectionId: f.connectionId,
      sourceDb: f.dbName,
      sourceCollection,
      sourceField,
      targetDb: f.dbName,
      targetCollection,
      reason: 'the values look like customer ids',
    });
    return (JSON.parse(textOf(r).split('\n')[1]!) as { proposalId: string }).proposalId;
  }

  async function seed() {
    f = await createReadFixture();
    await f.db.collection('customers').insertMany([{ _id: 1 }, { _id: 2 }, { _id: 3 }] as never);
    await f.db.collection('orders').insertMany([
      { _id: 'o1', customerId: 1 },
      { _id: 'o2', customerId: 2 },
      { _id: 'o3', customerId: 3 },
      { _id: 'o4', customerId: 1 },
    ] as never);
    await f.db.collection('mixed').insertMany([
      { _id: 'm1', customerId: 2 },
      { _id: 'm2', customerId: 98 },
      { _id: 'm3', customerId: 99 },
    ] as never);
    await f.db.collection('arrays').insertMany([
      { _id: 'a1', customerIds: [42, 3] },
      { _id: 'a2', customerIds: [] },
      { _id: 'a3', customerIds: null },
    ] as never);
  }

  it('reports 3 of 3 when every sampled value finds a target, and leaves the Proposal as it was', async () => {
    await seed();
    const id = await proposal('orders', 'customerId');
    const find = vi.spyOn(f.m.pool, 'readClient');
    const result = await f.h.proposals.check(id);
    expect(result).toEqual({
      kind: 'sampled',
      sampled: 3,
      resolved: 3,
      sourceCollection: 'orders',
      sourceField: 'customerId',
      targetCollection: 'customers',
      targetField: '_id',
    });
    expect(find).toHaveBeenCalledTimes(1);
    expect(f.h.proposalRepo.findById(id)!.status).toBe('pending');
  });

  it('reports 1 of 3 when only one sampled value finds a target', async () => {
    await seed();
    const id = await proposal('mixed', 'customerId');
    expect(await f.h.proposals.check(id)).toMatchObject({ kind: 'sampled', sampled: 3, resolved: 1 });
  });

  it('reports no sampled document when none has the field', async () => {
    await seed();
    const id = await proposal('orders', 'clientId');
    expect(await f.h.proposals.check(id)).toMatchObject({ kind: 'sampled', sampled: 0, resolved: 0, sourceField: 'clientId' });
  });

  it('counts an array value as resolving when any element does, and an empty array or null as not', async () => {
    await seed();
    const id = await proposal('arrays', 'customerIds');
    expect(await f.h.proposals.check(id)).toMatchObject({ kind: 'sampled', sampled: 3, resolved: 1 });
  });

  it('never counts a null value as resolving, even against a target that lacks the field', async () => {
    await seed();
    await f.db.collection('nulls').insertOne({ _id: 'n1', label: null } as never);
    await f.db.collection('tags').insertOne({ _id: 't1' } as never);
    const r = await f.call('propose_reference_rule', {
      connectionId: f.connectionId,
      sourceDb: f.dbName,
      sourceCollection: 'nulls',
      sourceField: 'label',
      targetDb: f.dbName,
      targetCollection: 'tags',
      targetField: 'label',
      reason: 'labels match',
    });
    const id = (JSON.parse(textOf(r).split('\n')[1]!) as { proposalId: string }).proposalId;
    expect(await f.h.proposals.check(id)).toMatchObject({ kind: 'sampled', sampled: 1, resolved: 0 });
  });

  it('on a Connection that is not open reads nothing and never connects it', async () => {
    await seed();
    const id = await proposal('orders', 'customerId');
    await f.m.pool.disconnect(f.connectionId);
    const connect = vi.spyOn(f.m.pool, 'connect');
    const readClient = vi.spyOn(f.m.pool, 'readClient');
    const readDb = vi.spyOn(f.m.pool, 'readDb');
    expect(await f.h.proposals.check(id)).toEqual({ kind: 'not-open', connectionName: 'prod' });
    expect(connect).not.toHaveBeenCalled();
    expect(readClient).not.toHaveBeenCalled();
    expect(readDb).not.toHaveBeenCalled();
    expect(f.m.pool.status(f.connectionId).status).toBe('disconnected');
  });

  it('stops without reconnecting when the Connection closes while the check is reading', async () => {
    await seed();
    const id = await proposal('orders', 'customerId');
    const real = f.m.pool.readClient.bind(f.m.pool);
    // Closes the Connection the moment its client has been handed over, before the first read.
    vi.spyOn(f.m.pool, 'readClient').mockImplementation(async (connId: string) => {
      const client = await real(connId);
      await f.m.pool.disconnect(connId);
      return client;
    });
    const connect = vi.spyOn(f.m.pool, 'connect');
    expect(await f.h.proposals.check(id)).toEqual({ kind: 'not-open', connectionName: 'prod' });
    expect(connect).not.toHaveBeenCalled();
    expect(f.m.pool.status(f.connectionId).status).toBe('disconnected');
  });

  it('asks for no target lookup once the Connection closed after the source read, and never reconnects', async () => {
    await seed();
    const id = await proposal('orders', 'customerId');
    const real = await f.m.pool.readClient(f.connectionId);
    const lookups = vi.fn();
    // The source read hands its documents back, then the Connection closes before the first target lookup.
    const client = {
      db: (dbName: string) => ({
        collection: (name: string) => {
          const col = real.db(dbName).collection(name);
          if (name === 'orders') {
            return {
              find: (query: object, options: object) => ({
                toArray: async () => {
                  const docs = await col.find(query, options).toArray();
                  await f.m.pool.disconnect(f.connectionId);
                  return docs;
                },
              }),
            };
          }
          return {
            findOne: (...args: Parameters<typeof col.findOne>) => {
              lookups();
              return col.findOne(...args);
            },
          };
        },
      }),
    };
    vi.spyOn(f.m.pool, 'readClient').mockResolvedValue(client as never);
    const connect = vi.spyOn(f.m.pool, 'connect');
    expect(await f.h.proposals.check(id)).toEqual({ kind: 'not-open', connectionName: 'prod' });
    expect(lookups).not.toHaveBeenCalled();
    expect(connect).not.toHaveBeenCalled();
    expect(f.m.pool.status(f.connectionId).status).toBe('disconnected');
  });

  it('refuses an unknown Proposal', async () => {
    await seed();
    await expect(f.h.proposals.check('0f0e0d0c-0b0a-4908-8706-050403020100')).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });
});
