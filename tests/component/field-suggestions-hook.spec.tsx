import { describe, it, expect, vi } from 'vitest';
import { renderHook, waitFor } from '../helpers/render';
import { useSuggestions } from '../../src/features/fieldSuggestions/useSuggestions';
import type {
  FieldSource,
  FieldSuggestion,
  OperatorSuggestion,
  SuggestionContext,
  ValueSource,
  ValueSuggestion,
} from '../../src/features/fieldSuggestions/types';
import { operatorSource } from '../../src/features/fieldSuggestions/sources/operatorSource';

function ctx(overrides: Partial<SuggestionContext> = {}): SuggestionContext {
  return {
    connectionId: 'c1',
    dbName: 'db',
    collection: 'coll',
    ...overrides,
  };
}

const syncFieldSource = (items: FieldSuggestion[]): FieldSource => () => items;
const asyncFieldSource = (items: FieldSuggestion[], delay = 10): FieldSource =>
  async () => {
    await new Promise((r) => setTimeout(r, delay));
    return items;
  };

describe('useSuggestions — field mode', () => {
  it('returns sync-source items immediately on first render', () => {
    const src = syncFieldSource([
      { kind: 'field', path: 'name', source: 's', frequency: 5 },
      { kind: 'field', path: 'age', source: 's', frequency: 3 },
    ]);
    const { result } = renderHook(() =>
      useSuggestions(ctx(), '', { fieldSources: [src], valueSources: [] }),
    );
    expect(result.current.items.map((i) => (i as FieldSuggestion).path).sort()).toEqual(
      ['age', 'name'],
    );
  });

  it('merges async-source items after they resolve', async () => {
    const sync = syncFieldSource([{ kind: 'field', path: 'name', source: 'a' }]);
    const async_ = asyncFieldSource([{ kind: 'field', path: 'age', source: 'b' }]);
    const { result } = renderHook(() =>
      useSuggestions(ctx(), '', { fieldSources: [sync, async_], valueSources: [] }),
    );
    // sync-only on the first tick
    expect(result.current.items.map((i) => (i as FieldSuggestion).path)).toEqual(['name']);
    await waitFor(() =>
      expect(result.current.items.map((i) => (i as FieldSuggestion).path).sort()).toEqual([
        'age',
        'name',
      ]),
    );
  });

  it('filters by token using case-insensitive substring match and ranks prefix hits higher', () => {
    const src = syncFieldSource([
      { kind: 'field', path: 'address.city', source: 's' },
      { kind: 'field', path: 'city', source: 's' },
      { kind: 'field', path: 'created_at', source: 's' },
    ]);
    const { result } = renderHook(() =>
      useSuggestions(ctx(), 'cit', { fieldSources: [src], valueSources: [] }),
    );
    const paths = result.current.items.map((i) => (i as FieldSuggestion).path);
    // Prefix match ranks first; substring match still included.
    expect(paths[0]).toBe('city');
    expect(paths).toContain('address.city');
    expect(paths).not.toContain('created_at');
  });

  it('dedupes by path across multiple sources and sums frequencies', async () => {
    const a = syncFieldSource([{ kind: 'field', path: 'x', source: 'a', frequency: 2 }]);
    const b = asyncFieldSource([{ kind: 'field', path: 'x', source: 'b', frequency: 3 }]);
    const { result } = renderHook(() =>
      useSuggestions(ctx(), '', { fieldSources: [a, b], valueSources: [] }),
    );
    // Wait until async source merges (frequency reaches the summed value).
    await waitFor(() => {
      expect(result.current.items).toHaveLength(1);
      const merged = result.current.items[0] as FieldSuggestion;
      expect(merged.frequency).toBe(5);
    });
    const merged = result.current.items[0] as FieldSuggestion;
    expect(merged.path).toBe('x');
  });

  it('ignores value sources when target is absent', () => {
    const fieldSrc = syncFieldSource([{ kind: 'field', path: 'x', source: 's' }]);
    const valueSrc = vi.fn(
      (): ValueSuggestion[] => [{ kind: 'value', value: 'v', display: 'v', source: 'vs' }],
    );
    const { result } = renderHook(() =>
      useSuggestions(ctx(), '', { fieldSources: [fieldSrc], valueSources: [valueSrc as unknown as ValueSource] }),
    );
    expect(result.current.items.every((i) => i.kind === 'field')).toBe(true);
    expect(valueSrc).not.toHaveBeenCalled();
  });

  it('returns [] for a null context', () => {
    const { result } = renderHook(() =>
      useSuggestions(null, '', { fieldSources: [], valueSources: [] }),
    );
    expect(result.current.items).toEqual([]);
  });
});

describe('useSuggestions — operator ranking', () => {
  it('ranks $eq #1 for token "eq" (no $ required)', () => {
    const { result } = renderHook(() =>
      useSuggestions(ctx(), 'eq', { fieldSources: [operatorSource], valueSources: [] }),
    );
    const first = result.current.items[0] as OperatorSuggestion;
    expect(first?.kind).toBe('operator');
    expect(first?.name).toBe('$eq');
  });

  it('ranks $eq #1 for token "$e" as well', () => {
    const { result } = renderHook(() =>
      useSuggestions(ctx(), '$e', { fieldSources: [operatorSource], valueSources: [] }),
    );
    const first = result.current.items[0] as OperatorSuggestion;
    expect(first?.name).toBe('$eq');
  });

  it('merges fields and operators in a single ranked list', () => {
    const fields = syncFieldSource([
      { kind: 'field', path: 'equivalent', source: 's' },
    ]);
    const { result } = renderHook(() =>
      useSuggestions(ctx(), 'eq', { fieldSources: [fields, operatorSource], valueSources: [] }),
    );
    const items = result.current.items;
    // $eq (operator, prefix after strip) beats "equivalent" (field, prefix)
    expect(items[0]?.kind).toBe('operator');
    expect((items[0] as OperatorSuggestion).name).toBe('$eq');
    expect(items.some((i) => i.kind === 'field' && i.path === 'equivalent')).toBe(true);
  });

  it('off-context operators sink below in-context matches', () => {
    const { result } = renderHook(() =>
      useSuggestions(
        ctx({ operatorContext: 'matchKey' }),
        'sum',
        { fieldSources: [operatorSource], valueSources: [] },
      ),
    );
    // $sum is an accumulator — off-context inside matchKey. It should still
    // appear (don't hide), just not at the top.
    const names = result.current.items.map((i) => (i as OperatorSuggestion).name);
    expect(names).toContain('$sum');
  });
});

describe('useSuggestions — value mode', () => {
  it('runs value sources when target is set and ignores field sources', () => {
    const valueSrc: ValueSource = () => [
      { kind: 'value', value: 'active', display: 'active', source: 'vs' },
      { kind: 'value', value: 'pending', display: 'pending', source: 'vs' },
    ];
    const fieldSrc = vi.fn(() => [] as FieldSuggestion[]);
    const { result } = renderHook(() =>
      useSuggestions(
        ctx({ target: { field: 'status' } }),
        '',
        { fieldSources: [fieldSrc], valueSources: [valueSrc] },
      ),
    );
    expect(result.current.items.map((i) => (i as ValueSuggestion).display).sort()).toEqual([
      'active',
      'pending',
    ]);
    expect(fieldSrc).not.toHaveBeenCalled();
  });
});
