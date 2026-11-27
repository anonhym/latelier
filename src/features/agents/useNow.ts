import React from 'react';

/** The clock, re-read every `everyMs`, so relative times ("34 min", "2m ago") move on their own. */
export function useNow(everyMs = 30_000): number {
  const [now, setNow] = React.useState(() => Date.now());
  React.useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), everyMs);
    return () => window.clearInterval(id);
  }, [everyMs]);
  return now;
}
