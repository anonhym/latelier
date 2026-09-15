import React from 'react';

/**
 * Mirror a value into a ref so closures (e.g., palette command `perform`s)
 * can read the latest version without re-registering when the value changes.
 * The underlying ref identity is stable; the `.current` is updated after
 * every render.
 */
export function useLatest<T>(value: T): React.MutableRefObject<T> {
  const ref = React.useRef(value);
  React.useEffect(() => {
    ref.current = value;
  });
  return ref;
}
