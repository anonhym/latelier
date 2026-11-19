import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, waitFor } from '../helpers/render';
import { ReferenceDrawer } from '../../src/features/references/ReferenceDrawer';
import type { IpcApi } from '@shared/ipc';
import type { ReferenceRule } from '@shared/types';
import { installAtelierMock, uninstallAtelierMock } from '../helpers/atelierMock';

afterEach(() => uninstallAtelierMock());

const BASE: ReferenceRule = {
  id: 'r1',
  owner: { familyId: 'fam-1' },
  sourceDb: 'app',
  sourceCollection: 'orders',
  sourceField: 'userId',
  targetDb: 'app',
  targetCollection: 'users',
  targetField: '_id',
  projection: [],
  enabled: true,
  createdAt: '2026-04-01T00:00:00Z',
  updatedAt: '2026-04-01T00:00:00Z',
};

function mount(rule: ReferenceRule, resolve: IpcApi['refs']['resolve']) {
  installAtelierMock({ refs: { resolve } });
  render(
    <ReferenceDrawer
      stack={[{ id: 'f1', rule, value: 'u1', label: 'userId' }]}
      connectionId="tab-conn"
      pinned={false}
      onPush={vi.fn()}
      onPop={vi.fn()}
      onClose={vi.fn()}
      onTogglePin={vi.fn()}
      width={320}
    />,
  );
}

describe('ReferenceDrawer — resolving a frame', () => {
  it('reads a shared rule through the tab\'s Connection', async () => {
    const resolve = vi.fn<IpcApi['refs']['resolve']>(async () => ({ ruleId: 'r1', found: false, documents: [], durationMs: 0 }));
    mount(BASE, resolve);
    await waitFor(() => expect(resolve).toHaveBeenCalledOnce());
    expect(resolve.mock.calls[0]![0].connectionId).toBe('tab-conn');
  });

  it('reads a Connection-owned rule through its owner', async () => {
    const resolve = vi.fn<IpcApi['refs']['resolve']>(async () => ({ ruleId: 'r1', found: false, documents: [], durationMs: 0 }));
    mount({ ...BASE, owner: { connectionId: 'owner-conn' } }, resolve);
    await waitFor(() => expect(resolve).toHaveBeenCalledOnce());
    expect(resolve.mock.calls[0]![0].connectionId).toBe('owner-conn');
  });
});
