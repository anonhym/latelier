import { describe, it, expect } from 'vitest';
import { AgentToolRunner, requestJsonOf } from '../../electron/agent/AgentToolRunner';
import type { AgentGate, AgentSessionIdentity } from '../../electron/agent/AgentGate';
import type { AgentReadLogEntry } from '../../electron/db/repositories/AgentReadLogRepo';
import { AGENT_TOOLS } from '../../electron/agent/tools';
import { AgentToolError } from '../../electron/agent/errorMap';

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
    const reply = await runner(rows).call(session, 'find', args, new AbortController().signal);
    if (reply.kind !== 'result') throw new Error('expected a result, got an asking round');
    const { result } = reply;
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ tool: 'find', requestJson: '{"unserializable":true}', database: 'admin', outcome: 'INVALID_INPUT' });
    expect(result.isError).toBe(true);
    expect(result.content[0]!.text).toMatch(/^INVALID_INPUT: /);
  });
});

describe('AgentToolRunner pausing for a closed Connection', () => {
  const CONNECTION = '2b1f6a3e-6f0e-4c1e-9b7a-0d6f7b5e9a11';
  const findArgs = { connectionId: CONNECTION, database: 'd', collection: 'c' };
  const signal = new AbortController().signal;

  function pausing(opts: { token?: () => 'ok' | 'ACCESS_OFF'; name?: string | null; insert?: (row: AgentReadLogEntry) => void } = {}) {
    const rows: AgentReadLogEntry[] = [];
    const written: string[] = [];
    let acquired = 0;
    const gate = {
      checkToken: opts.token ?? (() => 'ok'),
      listShared: () => [],
      acquire: async () => {
        acquired += 1;
        throw new AgentToolError('NOT_OPEN');
      },
    } as unknown as AgentGate;
    const r = new AgentToolRunner({
      gate,
      tools: AGENT_TOOLS,
      readLog: {
        insert: (row) => {
          opts.insert?.(row);
          rows.push(row);
          return 'id';
        },
      },
      tokens: { touchLastUsed: () => undefined },
      connections: { findById: () => (opts.name === null ? null : { id: CONNECTION, name: opts.name ?? 'prod' }) },
      log: { warn: () => undefined, error: () => undefined },
      onRowWritten: (outcome) => written.push(outcome),
    });
    return { r, rows, written, acquired: () => acquired };
  }

  it('asks when it may, writing an INPUT_REQUIRED row with no data first', async () => {
    const { r, rows, written } = pausing();
    const reply = await r.call(session, 'find', findArgs, signal, { canAsk: true, answer: 'none' });
    expect(reply).toEqual({ kind: 'ask', message: `The Connection "prod" is closed. Open it in L'Atelier, then accept to continue.` });
    expect(rows).toEqual([expect.objectContaining({ outcome: 'INPUT_REQUIRED', docCount: 0, bytes: 0, truncated: false, connectionName: 'prod' })]);
    expect(written).toEqual(['INPUT_REQUIRED']);
  });

  it('fails NOT_OPEN when it may not ask, or was already answered', async () => {
    for (const ask of [undefined, { canAsk: false, answer: 'none' as const }, { canAsk: true, answer: 'accept' as const }]) {
      const { r, rows, written, acquired } = pausing();
      const reply = await r.call(session, 'find', findArgs, signal, ask);
      expect(reply.kind).toBe('result');
      if (reply.kind === 'result') expect(reply.result.content[0]!.text).toMatch(/^NOT_OPEN: /);
      expect(rows.map((row) => row.outcome)).toEqual(['NOT_OPEN']);
      expect(rows[0]!.bytes).toBeGreaterThan(0);
      expect(written).toEqual(['NOT_OPEN']);
      expect(acquired()).toBe(1);
    }
  });

  it('fails NOT_OPEN on a refused answer without running the gate again', async () => {
    const { r, rows, acquired } = pausing();
    const reply = await r.call(session, 'find', findArgs, signal, { canAsk: true, answer: 'refused' });
    expect(reply.kind === 'result' && reply.result.isError).toBe(true);
    expect(rows.map((row) => row.outcome)).toEqual(['NOT_OPEN']);
    expect(acquired()).toBe(0);
  });

  it('ignores a refused answer on a tool that names no Connection', async () => {
    const { r, rows } = pausing();
    const reply = await r.call(session, 'list_connections', {}, signal, { canAsk: true, answer: 'refused' });
    expect(reply.kind === 'result' && reply.result.isError).toBeFalsy();
    expect(rows.map((row) => row.outcome)).toEqual(['ok']);
  });

  it('refuses a revoked token before it reads the answer, and ends the session', async () => {
    for (const answer of ['accept', 'refused'] as const) {
      const { r, rows, acquired } = pausing({ token: () => 'ACCESS_OFF' });
      const reply = await r.call(session, 'find', findArgs, signal, { canAsk: true, answer });
      expect(reply).toMatchObject({ kind: 'result', closeSession: true });
      expect(rows.map((row) => row.outcome)).toEqual(['ACCESS_OFF']);
      expect(acquired()).toBe(0);
    }
  });

  it('does not ask about a Connection whose row is gone', async () => {
    const { r, rows } = pausing({ name: null });
    const reply = await r.call(session, 'find', findArgs, signal, { canAsk: true, answer: 'none' });
    expect(reply.kind).toBe('result');
    expect(rows.map((row) => row.outcome)).toEqual(['NOT_OPEN']);
  });

  it('fails closed with DB_ERROR, and asks nothing, when the asking row cannot be written', async () => {
    const { r, written } = pausing({
      insert: () => {
        throw new Error('disk full');
      },
    });
    const reply = await r.call(session, 'find', findArgs, signal, { canAsk: true, answer: 'none' });
    expect(reply.kind).toBe('result');
    if (reply.kind === 'result') expect(reply.result.content[0]!.text).toMatch(/^DB_ERROR: /);
    expect(written).toEqual([]);
  });

  it('never asks for a refusal other than NOT_OPEN', async () => {
    const rows: AgentReadLogEntry[] = [];
    const r = new AgentToolRunner({
      gate: { checkToken: () => 'ok', acquire: async () => Promise.reject(new AgentToolError('NOT_SHARED')) } as unknown as AgentGate,
      tools: AGENT_TOOLS,
      readLog: { insert: (row) => (rows.push(row), 'id') },
      tokens: { touchLastUsed: () => undefined },
      connections: { findById: () => ({ id: CONNECTION, name: 'prod' }) },
      log: { warn: () => undefined, error: () => undefined },
    });
    const reply = await r.call(session, 'find', findArgs, signal, { canAsk: true, answer: 'none' });
    expect(reply.kind).toBe('result');
    expect(rows.map((row) => row.outcome)).toEqual(['NOT_SHARED']);
  });
});
