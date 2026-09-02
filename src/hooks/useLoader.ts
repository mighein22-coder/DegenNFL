import { useCallback, useEffect, useState } from 'react';

/**
 * The load-once-then-render shape every data screen in this app has.
 *
 * `PicksPage` grew this by hand — a `data` state, an `error` state, a cancelled
 * flag so a resolved promise cannot write to an unmounted component, and a
 * reload path. Six more screens wanting the same four things is the point at
 * which it stops being worth retyping.
 *
 * `load` MUST be wrapped in `useCallback` by the caller. It is the effect's
 * dependency, so a fresh function identity on every render is an infinite
 * refetch loop — which is exactly the bug this hook exists to stop each screen
 * writing for itself.
 */
export interface LoaderState<T> {
  data: T | null;
  /** The message from a failed load, already unwrapped. */
  error: string | null;
  /** True during the first load AND during any reload. */
  loading: boolean;
  /** Re-runs `load`. Keeps the previous data on screen until it resolves. */
  reload: () => void;
}

export function useLoader<T>(load: () => Promise<T>): LoaderState<T> {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [reloadCount, setReloadCount] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);

    load()
      .then(result => {
        if (cancelled) return;
        setData(result);
        setError(null);
      })
      .catch((err: any) => {
        if (cancelled) return;
        setError(err?.message ?? String(err));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [load, reloadCount]);

  const reload = useCallback(() => setReloadCount(count => count + 1), []);

  return { data, error, loading, reload };
}
