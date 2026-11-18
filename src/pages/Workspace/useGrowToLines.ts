import * as React from 'react';

/**
 * Sizes a textarea to its text, up to `maxLines`, then lets it scroll. Done by
 * hand (Mantine's autosize needs `document.fonts`, which jsdom lacks). With
 * `minLines` the box never shrinks below that many lines.
 */
export function useGrowToLines(
  ref: React.RefObject<HTMLTextAreaElement | null>,
  text: string,
  maxLines: number,
  minLines = 0,
): void {
  React.useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const style = window.getComputedStyle(el);
    const lineHeight = Number.parseFloat(style.lineHeight);
    const padding = Number.parseFloat(style.paddingTop) + Number.parseFloat(style.paddingBottom);
    el.style.height = 'auto';
    if (Number.isNaN(lineHeight)) return;
    const pad = Number.isNaN(padding) ? 0 : padding;
    const cap = lineHeight * maxLines + pad;
    const floor = minLines > 0 ? lineHeight * minLines + pad : 0;
    el.style.height = `${Math.min(Math.max(el.scrollHeight, floor), cap)}px`;
    el.style.overflowY = el.scrollHeight > cap ? 'auto' : 'hidden';
  }, [ref, text, maxLines, minLines]);
}
