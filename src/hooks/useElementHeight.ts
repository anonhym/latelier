import React from 'react';

/**
 * The element's own laid-out height, or null until it has one. jsdom lays
 * nothing out, so component tests read null and callers fall back to a fixed
 * size. Same shape as `useElementWidth`.
 */
export function useElementHeight<T extends HTMLElement>(): [React.RefObject<T | null>, number | null] {
  const ref = React.useRef<T>(null);
  const [height, setHeight] = React.useState<number | null>(null);
  React.useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return undefined;
    const read = () => setHeight(el.getBoundingClientRect().height || null);
    read();
    const observer = new ResizeObserver(read);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);
  return [ref, height];
}
