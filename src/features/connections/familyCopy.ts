/** The picker value that stands for "make a new family" in the Add to family dialog. */
export const NEW_FAMILY = '__new_family__';

export function plural(n: number, noun: string): string {
  return `${n} ${noun}${n === 1 ? '' : 's'}`;
}

/** The picker value that stands for "New family from this file" in the Apply dialog. */
export const NEW_FROM_FILE = '__new_from_file__';

/**
 * `name` if no family has it (compared without case, as family names are
 * unique that way), otherwise `name (2)`, `name (3)`, and so on.
 */
export function uniqueFamilyName(name: string, existing: readonly string[]): string {
  const taken = new Set(existing.map((n) => n.toLowerCase()));
  if (!taken.has(name.toLowerCase())) return name;
  let n = 2;
  while (taken.has(`${name} (${n})`.toLowerCase())) n += 1;
  return `${name} (${n})`;
}
