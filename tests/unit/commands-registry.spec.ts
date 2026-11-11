import { afterEach, describe, expect, it, vi } from 'vitest';
import { commandRegistry } from '../../src/commands/registry';
import { preparedCount, rankCommands } from '../../src/commands/rank';
import type { Command } from '../../src/commands/types';

function makeCmd(id: string, perform: () => void = () => {}): Command {
  return { id, title: id, group: 'general', perform };
}

afterEach(() => {
  commandRegistry._resetForTests();
});

describe('commandRegistry', () => {
  it('add() returns an unregister fn that removes only what it added', () => {
    const a = makeCmd('a');
    const b = makeCmd('b');
    const offA = commandRegistry.add([a]);
    commandRegistry.add([b]);
    expect(commandRegistry.list().map((c) => c.id).sort()).toEqual(['a', 'b']);
    offA();
    expect(commandRegistry.list().map((c) => c.id)).toEqual(['b']);
  });

  it('subscribe() fires on add and on remove', () => {
    const cb = vi.fn();
    const off = commandRegistry.subscribe(cb);
    const a = commandRegistry.add([makeCmd('a')]);
    expect(cb).toHaveBeenCalledTimes(1);
    a();
    expect(cb).toHaveBeenCalledTimes(2);
    off();
    commandRegistry.add([makeCmd('b')])();
    expect(cb).toHaveBeenCalledTimes(2);
  });

  it('replaces by id and warns once per duplicate id (dev only)', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const first = vi.fn();
    const second = vi.fn();
    commandRegistry.add([makeCmd('dup', first)]);
    commandRegistry.add([makeCmd('dup', second)]);
    commandRegistry.add([makeCmd('dup', second)]);
    const live = commandRegistry.list().find((c) => c.id === 'dup');
    expect(live?.perform).toBe(second);
    // Only one warn for the same id even on repeated re-adds.
    expect(warn).toHaveBeenCalledTimes(1);
    warn.mockRestore();
  });
});

describe('commandRegistry — prepared match text', () => {
  const ctx = { pathname: '/', connectionId: null };
  const find = (q: string) => rankCommands(commandRegistry.list(), q, ctx, []).map((r) => r.cmd.title);

  it('re-prepares a command whose title changed, instead of serving the old one', () => {
    commandRegistry.add([{ ...makeCmd('x'), title: 'Alpha' }])();
    commandRegistry.add([{ ...makeCmd('x'), title: 'Beta' }]);
    expect(find('alpha')).toEqual([]);
    expect(find('beta')).toEqual(['Beta']);
  });

  it('re-prepares a command whose matchText changed', () => {
    commandRegistry.add([{ ...makeCmd('x'), title: 'Open: a.b', matchText: 'a.b' }])();
    commandRegistry.add([{ ...makeCmd('x'), title: 'Open: a.b', matchText: 'c.d' }]);
    expect(find('a.b')).toEqual([]);
    expect(find('c.d')).toEqual(['Open: a.b']);
  });

  it('re-prepares a command whose subtitle or keywords changed', () => {
    commandRegistry.add([{ ...makeCmd('x'), subtitle: 'one', keywords: ['k1'] }])();
    commandRegistry.add([{ ...makeCmd('x'), subtitle: 'two', keywords: ['k2'] }]);
    expect(find('one')).toEqual([]);
    expect(find('k1')).toEqual([]);
    expect(find('two')).toEqual(['x']);
    expect(find('k2')).toEqual(['x']);
  });

  it('keeps the preparation across a re-registration in the same tick', async () => {
    const off = commandRegistry.add([makeCmd('keep-1'), makeCmd('keep-2')]);
    off();
    commandRegistry.add([makeCmd('keep-1'), makeCmd('keep-2')]);
    await Promise.resolve();
    expect(preparedCount()).toBeGreaterThanOrEqual(2);
    expect(find('keep')).toEqual(['keep-1', 'keep-2']);
  });

  it('drops the preparations of ids that are no longer registered', async () => {
    const off = commandRegistry.add([makeCmd('gone-1'), makeCmd('gone-2')]);
    await Promise.resolve();
    const before = preparedCount();
    off();
    await Promise.resolve();
    expect(preparedCount()).toBe(before - 2);
  });
});
