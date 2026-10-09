// Quick Edit (`updateField` in Workspace.tsx) writes straight through
// `api.doc.updateOne` and never reaches `useDocumentDialogs`, so it has to
// drop the field-suggestion sample itself: an inline edit can change a
// field's type, and the sample behind the Update drawer's type warning and
// the builder's suggestions is cached per collection for five minutes.
//
// `table-inline-edit.spec.tsx` mirrors `updateField` rather than running it,
// so this mounts the real page and calls the action it publishes.
import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';
import { createElement } from 'react';
import { notifications } from '@mantine/notifications';
import { act } from '@testing-library/react';
import { render, screen, fireEvent, waitFor } from '../helpers/render';
import { MemoryRouter } from 'react-router-dom';
import Workspace from '../../src/pages/Workspace';
import { installAtelierMock, uninstallAtelierMock, connectionFixture } from '../helpers/atelierMock';
import { invalidateSampleSchemaCache } from '../../src/features/fieldSuggestions/sources/sampleSchemaSource';
import type { CollectionTab } from '@shared/types';
import type { CollectionWorkspaceActions } from '../../src/pages/Workspace/context';

// Mocked at the exact module Workspace.tsx imports; the rest stays real
// because the page reaches the suggestion sources through their barrel.
vi.mock('../../src/features/fieldSuggestions/sources/sampleSchemaSource', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../src/features/fieldSuggestions/sources/sampleSchemaSource')>()),
  invalidateSampleSchemaCache: vi.fn(),
}));

const NOW = '2026-08-01T12:00:00.000Z';
const DOC = { _id: '1', sku: 'widget' };

const capturedActions: CollectionWorkspaceActions[] = [];

// Records the `actions` object the page hands its one provider.
vi.mock('../../src/pages/Workspace/context', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/pages/Workspace/context')>();
  return {
    ...actual,
    CollectionWorkspaceProvider: (props: Parameters<typeof actual.CollectionWorkspaceProvider>[0]) => {
      capturedActions.push(props.actions);
      return createElement(actual.CollectionWorkspaceProvider, props);
    },
  };
});

function tab(): CollectionTab {
  return {
    id: 't1',
    kind: 'collection',
    connectionId: 'c1',
    dbName: 'shop',
    collection: 'orders',
    position: 0,
    isActive: true,
    openedAt: NOW,
    pinned: false,
    state: {
      view: 'Tree',
      builder: { projection: [], sort: '', limit: '' },
      queryRaw: '{}',
      page: 0,
      pageSize: 50,
      activeBuilderTab: 'Builder',
      lastRun: { documents: [DOC], durationMs: 1, ranAt: NOW },
    },
  };
}

async function mount(
  updateOne: ReturnType<typeof vi.fn>,
  undo: ReturnType<typeof vi.fn> = vi.fn(async () => ({ restored: 1, skipped: 0 })),
) {
  installAtelierMock({
    tabs: { list: async () => [tab()] },
    conn: { list: async () => [connectionFixture({ id: 'c1' })] },
    query: { find: async () => ({ documents: [DOC], durationMs: 1, hasMore: false }) },
    doc: { updateOne: updateOne as never },
    audit: { undo: undo as never },
  });
  render(
    <MemoryRouter initialEntries={['/workspace']}>
      <Workspace />
    </MemoryRouter>,
  );
  await screen.findByText(/widget/);
}

const quickEdit = () => capturedActions.at(-1)!.updateField!(DOC, 'sku', 'gadget');

describe('Quick Edit drops the field-suggestion sample', () => {
  const invalidate = vi.mocked(invalidateSampleSchemaCache);

  beforeEach(() => invalidate.mockClear());
  afterEach(() => {
    notifications.clean();
    uninstallAtelierMock();
    capturedActions.length = 0;
  });

  it('for the edited collection once the write landed', async () => {
    const updateOne = vi.fn(async () => ({ matchedCount: 1, modifiedCount: 1 }));
    await mount(updateOne);
    expect(invalidate).not.toHaveBeenCalled();

    await act(quickEdit);

    expect(updateOne).toHaveBeenCalledTimes(1);
    expect(invalidate).toHaveBeenCalledExactlyOnceWith('c1', 'shop', 'orders');
  });

  it('not when nothing matched, so nothing was written', async () => {
    const updateOne = vi.fn(async () => ({ matchedCount: 0, modifiedCount: 0 }));
    await mount(updateOne);

    await act(quickEdit);

    expect(updateOne).toHaveBeenCalledTimes(1);
    expect(invalidate).not.toHaveBeenCalled();
  });

  it('not when the write is refused', async () => {
    const updateOne = vi.fn(async () => {
      throw { code: 'READ_ONLY', message: 'Connection is read-only.' };
    });
    await mount(updateOne);

    await act(quickEdit);

    expect(updateOne).toHaveBeenCalledTimes(1);
    expect(invalidate).not.toHaveBeenCalled();
  });

  it('again after Undo puts the old value back', async () => {
    const updateOne = vi.fn(async () => ({ matchedCount: 1, modifiedCount: 1, auditId: 'a1' }));
    const undo = vi.fn(async () => ({ restored: 1, skipped: 0 }));
    await mount(updateOne, undo);
    await act(quickEdit);
    expect(invalidate).toHaveBeenCalledTimes(1);

    fireEvent.click(await screen.findByRole('button', { name: 'Undo' }));

    await waitFor(() => expect(invalidate).toHaveBeenCalledTimes(2));
    expect(undo).toHaveBeenCalledWith({ entryId: 'a1' });
    expect(invalidate).toHaveBeenLastCalledWith('c1', 'shop', 'orders');
  });
});
