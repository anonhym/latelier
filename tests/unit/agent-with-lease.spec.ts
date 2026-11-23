import { describe, it, expect } from 'vitest';
import { withLease } from '../../electron/agent/readOps';
import { AgentToolError } from '../../electron/agent/errorMap';
import type { ToolContext } from '../../electron/agent/tools';
import type { AgentGate, AgentSessionIdentity } from '../../electron/agent/AgentGate';

const session: AgentSessionIdentity = { sessionId: 's', tokenId: 't', tokenHash: 'h', tokenName: 'n', clientName: null, clientVersion: null };

function context(state: { revoked: boolean; released: number }): ToolContext {
  const controller = new AbortController();
  const gate = {
    acquire: async () => ({
      client: {},
      signal: controller.signal,
      assertStill: () => {
        if (state.revoked) throw new AgentToolError('CANCELLED');
      },
      release: () => {
        state.released += 1;
      },
    }),
  };
  return { gate: gate as unknown as AgentGate, session, signal: new AbortController().signal, log: { warn: () => undefined } };
}

describe('withLease', () => {
  it('returns the result while the lease still holds, and frees the slot', async () => {
    const state = { revoked: false, released: 0 };
    await expect(withLease({ connectionId: 'a' }, context(state), async () => 'ok')).resolves.toBe('ok');
    expect(state.released).toBe(1);
  });

  it('discards a result when the lease was revoked while fn was still awaiting cleanup', async () => {
    const state = { revoked: false, released: 0 };
    const run = withLease({ connectionId: 'a' }, context(state), async () => {
      await Promise.resolve();
      state.revoked = true;
      return 'LEAK';
    });
    await expect(run).rejects.toMatchObject({ code: 'CANCELLED' });
    expect(state.released).toBe(1);
  });
});
