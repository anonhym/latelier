// How a sampled field's values divide between BSON types: the whole split the
// builder needs for a field that holds two kinds (a zip stored as text in some
// documents and as a number in others). `checkFieldType` only answers when one
// type is dominant; this keeps every type and its share. Pure.
import type { SchemaSampleEntry } from '@shared/types';

export interface TypeShare {
  /** The sampled type's name, in `inferType`'s vocabulary (`string`, `number`, `binary`, ...). */
  type: string;
  /** Whole percent of the sampled documents that hold the field as this type. */
  share: number;
}

/**
 * The sampled types of a field, most common first, with whole-number shares
 * that always add up to 100 (largest-remainder rounding, so three equal thirds
 * read 34, 33, 33 and not 33, 33, 33). Equal shares list in `localeCompare`
 * order so the list never reshuffles between renders. A type too rare to earn
 * a whole percent is left out; an entry with nothing counted gives an empty list.
 */
export function fieldTypeSplit(entry: Pick<SchemaSampleEntry, 'types'>): TypeShare[] {
  const counted = Object.entries(entry.types).filter(([, n]) => Number.isFinite(n) && n > 0);
  const total = counted.reduce((sum, [, n]) => sum + n, 0);
  if (total === 0) return [];

  const rows = counted.map(([type, n]) => {
    const exact = (n * 100) / total;
    const share = Math.floor(exact);
    return { type, share, remainder: exact - share };
  });
  // The whole percents lost to flooring go to the largest remainders.
  let left = 100 - rows.reduce((sum, r) => sum + r.share, 0);
  const byRemainder = [...rows].sort((a, b) => b.remainder - a.remainder || a.type.localeCompare(b.type));
  for (const row of byRemainder) {
    if (left <= 0) break;
    row.share += 1;
    left -= 1;
  }

  return rows
    .filter((r) => r.share > 0)
    .sort((a, b) => b.share - a.share || a.type.localeCompare(b.type))
    .map(({ type, share }) => ({ type, share }));
}
