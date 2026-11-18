/** Text between these ends one list chip: a comma, a line break or a tab. */
const LIST_SEPARATOR = /[,\r\n\t]/;

/**
 * Pasted text as list chips. Splits on comma, newline and tab, trims each
 * piece and drops the empty ones, so a trailing newline or a spreadsheet
 * column pastes as clean chips. Quoting is not read here: a chip's own text is
 * interpreted later by `parseChipText`, as it is for a typed chip.
 */
export function splitPastedList(text: string): string[] {
  return text
    .split(LIST_SEPARATOR)
    .map((piece) => piece.trim())
    .filter((piece) => piece !== '');
}
