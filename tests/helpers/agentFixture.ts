import { randomUUID } from 'node:crypto';
import { MongoClient, type Db } from 'mongodb';
import { createAgentHarness, type AgentHarness } from './agentHarness';
import { createAgentMongo, type AgentMongo } from './agentMongo';
import { connectAgent, envelopeBody, textOf, type AgentConnection } from './agentSocket';
import { getSharedMongoUri, uriToHostPort } from './mongo';

export interface ReadFixture {
  m: AgentMongo;
  h: AgentHarness;
  connectionId: string;
  /** A database no other test file uses. */
  dbName: string;
  /** A plain driver handle on that database, for seeding and inspecting. */
  db: Db;
  token: string;
  tokenId: string;
  socketPath: string;
  agent: AgentConnection;
  /** Agent Read Log rows, oldest first. */
  rows: () => LogRow[];
  /** Rows in the user's recent-queries history. */
  recentQueries: () => number;
  call: (name: string, args?: Record<string, unknown>) => Promise<ToolResult>;
  /** `find`/`count`/`aggregate` against this Connection and database. */
  on: (collection: string) => { connectionId: string; database: string; collection: string };
  cleanup: () => Promise<void>;
}

export interface LogRow {
  tool: string;
  outcome: string;
  doc_count: number;
  bytes: number;
  truncated: number;
  token_name: string;
  connection_id: string | null;
  database: string | null;
  collection: string | null;
}

export interface ToolResult {
  content?: unknown;
  structuredContent?: unknown;
  isError?: boolean;
}

export interface FixtureOptions {
  /** Open the Connection in the pool. Default true. */
  connect?: boolean;
  /** Share it with Agents. Default true. */
  shared?: boolean;
}

/** Real SQLite, a real socket, a real `MongoPool` over the shared memory server, and one MCP client. */
export async function createReadFixture(options: FixtureOptions = {}): Promise<ReadFixture> {
  const m = createAgentMongo();
  const h = createAgentHarness({ makePool: m.makePool });
  const connectionId = randomUUID();
  h.addConnection(connectionId, 'prod', { shared: options.shared ?? true, hostPort: uriToHostPort(getSharedMongoUri()) });
  if (options.connect ?? true) await m.pool.connect(connectionId);
  const dbName = `agent_s2_${randomUUID().replaceAll('-', '').slice(0, 12)}`;
  const seed = new MongoClient(getSharedMongoUri());
  await seed.connect();
  const added = h.svc.addToken('Claude Code');
  const socketPath = await h.enable();
  const agent = await connectAgent(socketPath, added.token);
  return {
    m,
    h,
    connectionId,
    dbName,
    db: seed.db(dbName),
    token: added.token,
    tokenId: added.info.id,
    socketPath,
    agent,
    rows: () =>
      h.tmp.db
        .prepare(
          'SELECT tool, outcome, doc_count, bytes, truncated, token_name, connection_id, database AS database, collection FROM agent_read_log ORDER BY ts, rowid',
        )
        .all() as LogRow[],
    recentQueries: () => (h.tmp.db.prepare('SELECT COUNT(*) AS n FROM recent_queries').get() as { n: number }).n,
    call: (name, args = {}) => agent.client.callTool({ name, arguments: args }) as Promise<ToolResult>,
    on: (collection) => ({ connectionId, database: dbName, collection }),
    async cleanup() {
      await agent.close().catch(() => undefined);
      await seed.db(dbName).dropDatabase();
      await seed.close();
      await h.cleanup();
      await m.close();
    },
  };
}

/** The documents a `find` or `aggregate` returned, parsed out of the envelope in the text content. */
export function docsIn(result: ToolResult): Array<Record<string, unknown>> {
  const body = envelopeBody(textOf(result));
  return JSON.parse(body) as Array<Record<string, unknown>>;
}

export { envelopeBody };
