import { describe, it, expect } from 'vitest';
import { act, renderHook, emptyWorkspaceActions } from '../helpers/render';
import { useAddToFilter } from '../../src/pages/Workspace/views/useAddToFilter';
import type { CollectionTabState } from '@shared/types';

// The Run gate accepts a filter padded with Unicode spaces (NBSP, BOM) that
// `JSON.parse` refuses. Add to filter reads the same `queryRaw`, so it must
// extend that filter rather than refuse it as "not valid JSON".
describe('useAddToFilter — a filter padded with Unicode spaces', () => {
  it('adds the field to the padded filter instead of refusing it', async () => {
    const state: CollectionTabState = {
      view: 'Table',
      builder: { projection: [], sort: '', limit: '' },
      queryRaw: '﻿{"status":"active"} ',
      page: 0,
      pageSize: 50,
      activeBuilderTab: 'Saved',
    };
    const actions = emptyWorkspaceActions();
    const { result } = renderHook(() => useAddToFilter({ state, actions }));

    await act(async () => {
      await result.current('name', 'ada');
    });

    expect(actions.patch).toHaveBeenCalledTimes(1);
    const patch = (actions.patch as unknown as { mock: { calls: [Partial<CollectionTabState>][] } }).mock.calls[0]![0];
    expect(JSON.parse(patch.queryRaw!)).toEqual({
      $and: [{ status: { $eq: 'active' } }, { name: { $eq: 'ada' } }],
    });
  });
});

describe('useAddToFilter — $exists', () => {
  const baseState = (queryRaw: string): CollectionTabState => ({
    view: 'Table',
    builder: { projection: [], sort: '', limit: '' },
    queryRaw,
    page: 0,
    pageSize: 50,
    activeBuilderTab: 'Saved',
  });
  const run = async (queryRaw: string, path: string) => {
    const actions = emptyWorkspaceActions();
    const { result } = renderHook(() => useAddToFilter({ state: baseState(queryRaw), actions }));
    await act(async () => {
      await result.current(path, true, '$exists');
    });
    expect(actions.patch).toHaveBeenCalledTimes(1);
    return (actions.patch as unknown as { mock: { calls: [Partial<CollectionTabState>][] } }).mock.calls[0]![0]
      .queryRaw!;
  };

  it('adds { field: { $exists: true } } to an empty filter, with no null placeholder', async () => {
    const raw = await run('{}', 'tags');
    expect(JSON.parse(raw)).toEqual({ tags: { $exists: true } });
    expect(raw).not.toMatch(/null/);
  });

  it('keeps a nested path as the field key', async () => {
    const raw = await run('{}', 'items.qty');
    expect(JSON.parse(raw)).toEqual({ 'items.qty': { $exists: true } });
  });

  it('ANDs onto an existing filter', async () => {
    const raw = await run('{"status":"active"}', 'tags');
    expect(JSON.parse(raw)).toEqual({ $and: [{ status: { $eq: 'active' } }, { tags: { $exists: true } }] });
  });
});
