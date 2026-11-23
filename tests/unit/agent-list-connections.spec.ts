import { describe, it, expect } from 'vitest';
import { AGENT_TOOLS, type ToolContext } from '../../electron/agent/tools';
import type { AgentGate, AgentSessionIdentity } from '../../electron/agent/AgentGate';
import { LISTING_LIMIT } from '../../electron/agent/readOps';
import { MAX_RESPONSE_BYTES } from '../../electron/agent/resultBudget';
import { envelopeBody } from '../helpers/agentFixture';

const tool = AGENT_TOOLS.find((t) => t.name === 'list_connections')!;
const session: AgentSessionIdentity = { sessionId: 's', tokenId: 't', tokenHash: 'h', tokenName: 'n', clientName: null, clientVersion: null };

interface FakeOptions {
  shared: Array<{ id: string; name: string }>;
  databases: (id: string) => string[];
  /** Runs after the databases of every Connection were read, before the call serialises. */
  afterReads?: () => void;
  tokenOk?: () => boolean;
  /** Ids that are no longer open by the time the call serialises. */
  closedAfterReads?: string[];
}

/** A gate whose `listShared` is read once at the start and once at the end, as the tool does. */
function context(options: FakeOptions): ToolContext {
  let listed = 0;
  const gate = {
    listShared: () => {
      listed += 1;
      if (listed === 2) options.afterReads?.();
      return options.shared.map((c) => ({ ...c, state: listed >= 2 && options.closedAfterReads?.includes(c.id) ? ('unavailable' as const) : ('available' as const) }));
    },
    checkToken: () => (options.tokenOk?.() === false ? 'ACCESS_OFF' : 'ok'),
    acquire: async (id: string) => ({
      client: { db: () => ({ command: async () => ({ databases: options.databases(id).map((name) => ({ name })) }) }) },
      signal: new AbortController().signal,
      assertStill: () => undefined,
      release: () => undefined,
    }),
  };
  return { gate: gate as unknown as AgentGate, session, signal: new AbortController().signal, log: { warn: () => undefined } };
}

const names = (count: number, prefix = 'db'): string[] => Array.from({ length: count }, (_, i) => `${prefix}${String(i).padStart(6, '0')}`);
const parse = (text: string) => JSON.parse(envelopeBody(text)) as { connections: Array<{ id: string; name: string; databases?: string[] | null; databasesTruncated?: true }> };

describe('list_connections bounds', () => {
  it('cuts a Connection with more databases than the listing limit, and says so', async () => {
    const out = await tool.run({}, context({ shared: [{ id: 'a', name: 'big' }], databases: () => names(LISTING_LIMIT + 1_000) }));
    const [row] = parse(out.text).connections;
    expect(row!.databases).toHaveLength(LISTING_LIMIT);
    expect(row!.databasesTruncated).toBe(true);
    expect(out).toMatchObject({ truncated: true, appliedLimits: ['limit'], count: 1 });
    expect(out.text).toContain('databasesTruncated');
  });

  it('leaves a Connection at exactly the limit whole', async () => {
    const out = await tool.run({}, context({ shared: [{ id: 'a', name: 'edge' }], databases: () => names(LISTING_LIMIT) }));
    const [row] = parse(out.text).connections;
    expect(row!.databases).toHaveLength(LISTING_LIMIT);
    expect(row!.databasesTruncated).toBeUndefined();
    expect(out).toMatchObject({ truncated: false, appliedLimits: [] });
  });

  it('stops at the size budget, keeps whole Connections only, and names the cut', async () => {
    const shared = Array.from({ length: 40 }, (_, i) => ({ id: `c${i}`, name: `conn-${i}` }));
    const long = (id: string) => names(LISTING_LIMIT, `${id}-${'x'.repeat(40)}-`);
    const out = await tool.run({}, context({ shared, databases: long }));
    expect(Buffer.byteLength(envelopeBody(out.text))).toBeLessThanOrEqual(MAX_RESPONSE_BYTES);
    const shown = parse(out.text).connections;
    expect(shown.length).toBeLessThan(40);
    expect(shown.length).toBe(out.count);
    expect(shown.map((c) => c.id)).toEqual(shared.slice(0, shown.length).map((c) => c.id));
    expect(out.appliedLimits).toEqual(['bytes']);
    expect(out.text).toContain('MiB size limit');
  });

  it('is not pretty-printed', async () => {
    const out = await tool.run({}, context({ shared: [{ id: 'a', name: 'one' }, { id: 'b', name: 'two' }], databases: () => ['x', 'y'] }));
    expect(envelopeBody(out.text)).toBe('{"connections":[{"id":"a","name":"one","state":"available","databases":["x","y"]},{"id":"b","name":"two","state":"available","databases":["x","y"]}]}');
    expect(out).toMatchObject({ truncated: false, appliedLimits: [], count: 2 });
    expect(out.text).not.toContain('Incomplete');
  });
});

describe('list_connections when the world changes during the call', () => {
  it('does not name a Connection that was unshared while the databases were being read', async () => {
    const shared = [{ id: 'a', name: 'kept' }, { id: 'b', name: 'LEAK-NAME' }];
    const out = await tool.run(
      {},
      context({ shared, databases: () => ['LEAK-DB'], afterReads: () => void shared.pop() }),
    );
    expect(parse(out.text).connections.map((c) => c.id)).toEqual(['a']);
    expect(out.text).not.toContain('LEAK-NAME');
    expect(out.count).toBe(1);
  });

  it('shows a Connection that closed after its lookup as unavailable, without its database names', async () => {
    const out = await tool.run(
      {},
      context({ shared: [{ id: 'a', name: 'open' }, { id: 'b', name: 'closing' }], databases: (id) => [`LEAK-${id}`], closedAfterReads: ['b'] }),
    );
    expect(parse(out.text).connections).toEqual([
      { id: 'a', name: 'open', state: 'available', databases: ['LEAK-a'] },
      { id: 'b', name: 'closing', state: 'unavailable' },
    ]);
    expect(out.text).not.toContain('LEAK-b');
  });

  it('says nothing at all when the token went away meanwhile', async () => {
    let revoked = false;
    await expect(
      tool.run({}, context({ shared: [{ id: 'a', name: 'n' }], databases: () => ['d'], tokenOk: () => !revoked, afterReads: () => undefined })),
    ).resolves.toBeDefined();
    revoked = true;
    await expect(tool.run({}, context({ shared: [{ id: 'a', name: 'n' }], databases: () => ['d'], tokenOk: () => !revoked }))).rejects.toMatchObject({ code: 'CANCELLED' });
  });
});
