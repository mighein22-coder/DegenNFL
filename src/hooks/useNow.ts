import { useEffect, useState } from 'react';

/**
 * A clock that ticks, so a countdown on screen goes down on its own.
 *
 * The rest of the app reads `new Date()` at render time, which is correct but
 * only updates when something else causes a render. The Dashboard is the one
 * screen a member leaves open — a deadline that still says "4h 12m" an hour
 * later is worse than no deadline at all.
 *
 * The default interval is deliberately not one second. `getTimeUntil` reports
 * whole minutes, so a faster tick would re-render the tree for no visible
 * change; 20s is well inside a minute and costs nothing.
 */
export function useNow(intervalMs: number = 20_000): Date {
  const [now, setNow] = useState(() => new Date());

  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), intervalMs);
    return () => clearInterval(id);
  }, [intervalMs]);

  return now;
}
