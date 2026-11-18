// A raw clause editor grows with its text up to six lines at rest, then scrolls inside its box.
import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, screen } from '../helpers/render';
import { MemoryRouter } from 'react-router-dom';
import Workspace from '../../src/pages/Workspace';
import { installAtelierMock, uninstallAtelierMock } from '../helpers/atelierMock';
import type { CollectionTabState, WorkspaceTab } from '@shared/types';
import type { IpcApi } from '@shared/ipc';

const now = '2026-08-04T12:00:00.000Z';

function makeState(overrides: Partial<CollectionTabState> = {}): CollectionTabState {
  return {
    view: 'Tree',
    builder: { projection: [], sort: '', limit: '' },
    queryRaw: '{}',
    page: 0,
    pageSize: 50,
    activeBuilderTab: 'Builder',
    lastRun: { documents: [], durationMs: 0, ranAt: now },
    ...overrides,
  };
}

function makeCollectionTab(state: CollectionTabState): WorkspaceTab {
  return {
    id: 't1',
    kind: 'collection',
    connectionId: 'c1',
    dbName: 'mydb',
    collection: 'users',
    position: 0,
    isActive: true,
    openedAt: now,
    pinned: false,
    state,
  };
}

const CONNECTION = {
  id: 'c1',
  name: 'Local',
  color: '#1A6835',
  host: 'localhost',
  port: 27017,
  connectionType: 'standard' as const,
  readOnly: false,
  status: 'connected' as const,
};

function mountWith(state: CollectionTabState) {
  const updateSpy = vi.fn(async () => makeCollectionTab(state));
  installAtelierMock({
    tabs: {
      list: async () => [makeCollectionTab(state)],
      setActive: async (id) => ({ id }),
      update: updateSpy as unknown as IpcApi['tabs']['update'],
    },
    conn: { list: async () => [CONNECTION] },
    query: {
      find: vi.fn(async () => ({ documents: [], durationMs: 1, hasMore: false })),
      count: async () => ({ count: 0 }),
    },
  });
  const utils = render(
    <MemoryRouter initialEntries={['/workspace']}>
      <Workspace />
    </MemoryRouter>,
  );
  return { ...utils, updateSpy };
}

const RAW_CLAUSE = '{"items":{"$elemMatch":{"sku":1}}}';
const LINE_PX = 18;
const PAD_PX = 4;

function stubScrollHeight(px: number) {
  vi.spyOn(HTMLTextAreaElement.prototype, 'scrollHeight', 'get').mockReturnValue(px);
}

afterEach(() => {
  uninstallAtelierMock();
  vi.restoreAllMocks();
});

describe('Raw clause editor cap', () => {
  it('a short clause keeps the two-line floor and does not scroll', async () => {
    stubScrollHeight(LINE_PX + PAD_PX * 2);
    mountWith(makeState({ queryRaw: RAW_CLAUSE }));
    const box = (await screen.findByLabelText('Raw clause 1')) as HTMLTextAreaElement;
    expect(box.style.height).toBe(`${LINE_PX * 2 + PAD_PX * 2}px`);
    expect(box.style.overflowY).toBe('hidden');
  });

  it('a clause under six lines grows to fit without scrolling', async () => {
    stubScrollHeight(LINE_PX * 5 + PAD_PX * 2);
    mountWith(makeState({ queryRaw: RAW_CLAUSE }));
    const box = (await screen.findByLabelText('Raw clause 1')) as HTMLTextAreaElement;
    expect(box.style.height).toBe(`${LINE_PX * 5 + PAD_PX * 2}px`);
    expect(box.style.overflowY).toBe('hidden');
  });

  it('a clause past six lines stops at six and scrolls inside the box', async () => {
    stubScrollHeight(LINE_PX * 20 + PAD_PX * 2);
    mountWith(makeState({ queryRaw: RAW_CLAUSE }));
    const box = (await screen.findByLabelText('Raw clause 1')) as HTMLTextAreaElement;
    expect(box.style.height).toBe(`${LINE_PX * 6 + PAD_PX * 2}px`);
    expect(box.style.overflowY).toBe('auto');
  });
});
