import { afterEach, describe, expect, it, vi } from 'vitest';
import { commandRegistry } from '../../src/commands/registry';
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
