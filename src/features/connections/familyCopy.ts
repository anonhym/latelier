/** The picker value that stands for "make a new family" in the Add to family dialog. */
export const NEW_FAMILY = '__new_family__';

export function plural(n: number, noun: string): string {
  return `${n} ${noun}${n === 1 ? '' : 's'}`;
}
