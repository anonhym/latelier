import { describe, it, expect } from 'vitest';
import {
  AGENT_NAME_MAX,
  canCopy,
  clipboardClearAt,
  connectPanelReducer as reduce,
  copyRequest,
  copyStepDone,
  firstSessionOf,
  initialConnectPanel,
  nameValid,
} from '../../src/features/agents/connectPanel';
import type { AgentSessionInfo } from '@shared/types';

const COPIED = { tokenId: 'tok-1', copiedAt: '2026-11-27T11:02:00.000Z' };

describe('connectPanelReducer', () => {
  it('starts empty on the given client, optionally on an existing Agent', () => {
    expect(initialConnectPanel('cursor')).toEqual({
      name: '',
      client: 'cursor',
      copying: false,
      tokenId: null,
      copiedAt: null,
      copiedClient: null,
    });
    expect(initialConnectPanel('cursor', 't9').tokenId).toBe('t9');
  });

  it('marks step 1 copied only when main resolves, for the client chosen then', () => {
    let s = reduce(initialConnectPanel('cursor'), { type: 'name', name: 'Work laptop' });
    s = reduce(s, { type: 'copyStart' });
    expect(s.copying).toBe(true);
    expect(copyStepDone(s)).toBe(false);
    s = reduce(s, { type: 'copyDone', result: COPIED, client: 'cursor' });
    expect(s).toMatchObject({ copying: false, tokenId: 'tok-1', copiedAt: COPIED.copiedAt, copiedClient: 'cursor' });
    expect(copyStepDone(s)).toBe(true);
    expect(copyStepDone(reduce(s, { type: 'client', client: 'claude-desktop' }))).toBe(false);
  });

  it('leaves everything as it was on a cancel or a failure', () => {
    const named = reduce(initialConnectPanel('cursor'), { type: 'name', name: 'Work laptop' });
    const cancelled = reduce(reduce(named, { type: 'copyStart' }), { type: 'copyDone', result: { cancelled: true }, client: 'cursor' });
    expect(cancelled).toEqual(named);
    const failed = reduce(reduce(named, { type: 'copyStart' }), { type: 'copyFailed' });
    expect(failed).toEqual(named);
  });

  it('locks the name once the Agent exists', () => {
    const s = reduce(reduce(initialConnectPanel('cursor'), { type: 'name', name: 'A' }), {
      type: 'copyDone',
      result: COPIED,
      client: 'cursor',
    });
    expect(reduce(s, { type: 'name', name: 'B' }).name).toBe('A');
  });
});

describe('copyRequest', () => {
  it('connects a new Agent the first time and regenerates the same one after', () => {
    const named = reduce(initialConnectPanel('cursor'), { type: 'name', name: '  Work laptop ' });
    expect(copyRequest(named)).toEqual({ kind: 'connect', name: 'Work laptop', client: 'cursor' });
    const done = reduce(named, { type: 'copyDone', result: COPIED, client: 'cursor' });
    expect(copyRequest(reduce(done, { type: 'client', client: 'claude-code' }))).toEqual({
      kind: 'copy',
      id: 'tok-1',
      client: 'claude-code',
    });
  });
});

describe('nameValid and canCopy', () => {
  it('wants 1 to 64 characters once trimmed, unless the Agent exists', () => {
    expect(nameValid({ name: '   ', tokenId: null })).toBe(false);
    expect(nameValid({ name: 'a', tokenId: null })).toBe(true);
    expect(nameValid({ name: 'a'.repeat(AGENT_NAME_MAX), tokenId: null })).toBe(true);
    expect(nameValid({ name: 'a'.repeat(AGENT_NAME_MAX + 1), tokenId: null })).toBe(false);
    expect(nameValid({ name: '', tokenId: 't' })).toBe(true);
  });

  it('refuses while a copy is in flight', () => {
    const named = reduce(initialConnectPanel('cursor'), { type: 'name', name: 'x' });
    expect(canCopy(named)).toBe(true);
    expect(canCopy(reduce(named, { type: 'copyStart' }))).toBe(false);
    expect(canCopy(initialConnectPanel('cursor'))).toBe(false);
  });
});

describe('clipboardClearAt', () => {
  it('is five minutes after the copy', () => {
    expect(clipboardClearAt('2026-11-27T11:02:00.000Z')).toBe('2026-11-27T11:07:00.000Z');
  });
});

describe('firstSessionOf', () => {
  const s = (id: string, tokenId: string, startedAt: string): AgentSessionInfo => ({
    id,
    tokenId,
    tokenName: 'n',
    clientName: 'cursor',
    clientVersion: '1.4',
    folder: null,
    startedAt,
    callCount: 0,
    refusedCount: 0,
    lastCallAt: null,
  });

  it("picks the token's earliest live session, and nothing without a token", () => {
    const sessions = [
      s('late', 'tok-1', '2026-11-27T11:10:00.000Z'),
      s('other', 'tok-2', '2026-11-27T11:00:00.000Z'),
      s('early', 'tok-1', '2026-11-27T11:04:00.000Z'),
    ];
    expect(firstSessionOf(sessions, 'tok-1')?.id).toBe('early');
    expect(firstSessionOf(sessions, 'tok-3')).toBeNull();
    expect(firstSessionOf(sessions, null)).toBeNull();
  });
});
