/**
 * Compute the viewport-coordinate rect of the caret inside a textarea.
 *
 * Uses the mirror-div technique: clone the textarea's text-layout styles
 * onto a hidden `<div>`, drop the text up to the caret into it, insert a
 * zero-width marker `<span>`, and read its rect. Works in every browser
 * that can render a textarea.
 */
export function getCaretRect(
  textarea: HTMLTextAreaElement,
  caretOffset: number,
): { top: number; left: number; height: number } {
  const doc = textarea.ownerDocument;
  const cs = window.getComputedStyle(textarea);

  const mirror = doc.createElement('div');
  const style = mirror.style;
  const copyProps: Array<keyof CSSStyleDeclaration> = [
    'boxSizing', 'width', 'height',
    'paddingTop', 'paddingRight', 'paddingBottom', 'paddingLeft',
    'borderTopWidth', 'borderRightWidth', 'borderBottomWidth', 'borderLeftWidth',
    'fontFamily', 'fontSize', 'fontWeight', 'fontStyle', 'fontVariant',
    'letterSpacing', 'lineHeight', 'textTransform', 'textIndent', 'textAlign',
    'wordSpacing', 'tabSize', 'whiteSpace', 'wordWrap', 'overflowWrap',
  ];
  for (const prop of copyProps) {
    (style as unknown as Record<string, string>)[prop as string] = cs[prop] as string;
  }
  style.position = 'absolute';
  style.visibility = 'hidden';
  style.top = '0';
  style.left = '-9999px';
  style.overflow = 'hidden';
  style.whiteSpace = 'pre-wrap';
  style.wordWrap = 'break-word';

  const value = textarea.value;
  const before = value.substring(0, caretOffset);
  mirror.textContent = before;

  const marker = doc.createElement('span');
  marker.textContent = value.substring(caretOffset) || '.';
  mirror.appendChild(marker);

  doc.body.appendChild(mirror);
  const markerRect = marker.getBoundingClientRect();
  const mirrorRect = mirror.getBoundingClientRect();
  doc.body.removeChild(mirror);

  const taRect = textarea.getBoundingClientRect();
  const top = taRect.top + (markerRect.top - mirrorRect.top) - textarea.scrollTop;
  const left = taRect.left + (markerRect.left - mirrorRect.left) - textarea.scrollLeft;
  const height = parseFloat(cs.lineHeight) || parseFloat(cs.fontSize) * 1.2 || 16;

  return { top, left, height };
}
