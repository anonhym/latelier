import { describe, it, expect } from 'vitest';
import { AgentToolRunner, requestJsonOf } from '../../electron/agent/AgentToolRunner';
import type { AgentGate, AgentSessionIdentity } from '../../electron/agent/AgentGate';
import type { AgentReadLogEntry } from '../../electron/db/repositories/AgentReadLogRepo';
import { AGENT_TOOLS } from '../../electron/agent/tools';

const session: AgentSessionIdentity = {
  sessionId: 's',
  tokenId: 't',
  tokenHash: 'h',
  tokenName: 'Claude Code',
  clientName: null,
  clientVersion: null,
};

/** The nesting `JSON.parse` accepts but `JSON.stringify` refuses, as a hostile client can send. */
// Deep enough to overflow JSON.stringify under any stack size, including Stryker's larger one.
const DEEP = 1_000_000;

function deepArray(depth: number): unknown {
  return JSON.parse('['.repeat(depth) + ']'.repeat(depth));
}

function runner(rows: AgentReadLogEntry[]) {
  return new AgentToolRunner({
    gate: { checkToken: () => 'ok' } as unknown as AgentGate,
    tools: AGENT_TOOLS,
    readLog: { insert: (row) => (rows.push(row), 'id') },
    tokens: { touchLastUsed: () => undefined },
    connections: { findById: () => null },
    log: { warn: () => undefined, error: () => undefined },
  });
}

describe('requestJsonOf', () => {
  it('stores ordinary arguments as JSON, and nothing as an empty object', () => {
    expect(requestJsonOf({ a: [1, 'x'] })).toBe('{"a":[1,"x"]}');
    expect(requestJsonOf(undefined)).toBe('{}');
    expect(requestJsonOf(null)).toBe('{}');
  });

  it('replaces arguments too deep to serialise with a marker', () => {
    expect(() => JSON.stringify(deepArray(DEEP))).toThrow(RangeError);
    expect(requestJsonOf({ filter: deepArray(DEEP) })).toBe('{"unserializable":true}');
  });

  it('does not hide any other failure', () => {
    const circular: Record<string, unknown> = {};
    circular.self = circular;
    expect(() => requestJsonOf(circular)).toThrow(TypeError);
  });
});

describe('AgentToolRunner with arguments too deep to serialise', () => {
  it('still writes the row and keeps the refusal code instead of answering DB_ERROR', async () => {
    const rows: AgentReadLogEntry[] = [];
    const args = { connectionId: '2b1f6a3e-6f0e-4c1e-9b7a-0d6f7b5e9a11', database: 'admin', collection: 'c', filter: { a: deepArray(DEEP) } };
    const { result } = await runner(rows).call(session, 'find', args, new AbortController().signal);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ tool: 'find', requestJson: '{"unserializable":true}', database: 'admin', outcome: 'INVALID_INPUT' });
    expect(result.isError).toBe(true);
    expect(result.content[0]!.text).toMatch(/^INVALID_INPUT: /);
  });
});
