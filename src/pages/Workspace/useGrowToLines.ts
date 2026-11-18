import * as React from 'react';

/**
 * Sizes a textarea to its text, up to `maxLines`, then lets it scroll. Done by
 * hand (Mantine's autosize needs `document.fonts`, which jsdom lacks). With
 * `minLines` the box never shrinks below that many lines. `mounted` says
 * whether the textarea is in the tree: a box that appears without its text
 * changing (a list switching from chips to its JSON text) must be sized and
 * observed when it appears.
 */
export function useGrowToLines(
  ref: React.RefObject<HTMLTextAreaElement | null>,
  text: string,
  maxLines: number,
  minLines = 0,
  mounted = true,
): void {
  // One sizing pass; the layout effect and the width observer share it.
  const size = React.useCallback(() => {
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
  }, [ref, maxLines, minLines]);

  React.useLayoutEffect(size, [size, text, mounted]);

  // Narrowing the box re-wraps the text without changing it, so the text
  // dependency above never fires. The box's own width is what moves; the
  // height this pass sets does not change the width, so it cannot loop.
  React.useEffect(() => {
    const el = ref.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    let width = el.getBoundingClientRect().width;
    const observer = new ResizeObserver(() => {
      const next = el.getBoundingClientRect().width;
      if (next === width) return;
      width = next;
      size();
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, [ref, size, mounted]);
}
