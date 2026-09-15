/**
 * Canonical URL of the troubleshooting doc on GitHub. The drawer footer
 * appends `#${recipe.docAnchor}` to deep-link into the matching section.
 */
export const TROUBLESHOOTING_DOC_URL =
  'https://github.com/anonhym/latelier/blob/main/docs/troubleshooting.md';

export function docUrlFor(anchor: string | undefined): string {
  if (!anchor) return TROUBLESHOOTING_DOC_URL;
  return `${TROUBLESHOOTING_DOC_URL}#${anchor}`;
}
