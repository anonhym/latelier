import type { ConnectionRuntime } from '@shared/types';

export type GateVerdict = 'ok' | 'ACCESS_OFF' | 'NOT_SHARED' | 'NOT_OPEN';

export interface GateInput {
  /** Agent Access is on. */
  accessOn: boolean;
  /** The Connection's Shared with Agents flag. */
  shared: boolean;
  /** The pool's status for the Connection. */
  status: ConnectionRuntime['status'];
}

/**
 * The three gates an Agent must pass (X27 §2), in the order a refusal is
 * reported: Agent Access first, then the share flag, then whether the
 * Connection is an Open Connection. Pure so every combination is testable;
 * `AgentGate` supplies the live inputs on every acquisition.
 */
export function evaluateGates(input: GateInput): GateVerdict {
  if (!input.accessOn) return 'ACCESS_OFF';
  if (!input.shared) return 'NOT_SHARED';
  if (input.status !== 'connected') return 'NOT_OPEN';
  return 'ok';
}
