import { describe, it, expect } from 'vitest';
import { saveResultMessage } from '../../src/pages/Workspace/Aggregation/saveResultMessage';

const base = { dbName: 'shop', collection: 'target' } as const;

describe('saveResultMessage', () => {
  it('reports the documents written by $out, which replaces the target', () => {
    expect(saveResultMessage({ ...base, mode: '$out', writtenCount: 3 })).toBe(
      'Wrote 3 documents to shop.target',
    );
  });

  it('shows a placeholder when the $out count could not be read', () => {
    expect(saveResultMessage({ ...base, mode: '$out' })).toBe('Wrote ? documents to shop.target');
  });

  it('reports a $merge as the target size and its growth, not as documents written', () => {
    expect(saveResultMessage({ ...base, mode: '$merge', mergeCounts: { before: 1000, after: 1003 } })).toBe(
      'Merged into shop.target — now 1003 documents (+3 new)',
    );
  });

  it('says nothing was added when a $merge only updated existing documents', () => {
    expect(saveResultMessage({ ...base, mode: '$merge', mergeCounts: { before: 5, after: 5 } })).toBe(
      'Merged into shop.target — now 5 documents (+0 new)',
    );
  });

  it('leaves the growth out when the target shrank during the merge', () => {
    expect(saveResultMessage({ ...base, mode: '$merge', mergeCounts: { before: 5, after: 3 } })).toBe(
      'Merged into shop.target — now 3 documents',
    );
  });

  it('states only that the merge happened when its counts could not be read', () => {
    expect(saveResultMessage({ ...base, mode: '$merge' })).toBe('Merged into shop.target');
  });
});
