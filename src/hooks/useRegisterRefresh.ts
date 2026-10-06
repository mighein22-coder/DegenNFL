import { useEffect } from 'react';
import { refreshStore } from '../lib/refreshStore';

/**
 * Lets pull-to-refresh reload this screen. Call it with the `reload` and
 * `loading` a `useLoader` returned.
 *
 * Unregisters on unmount, so a pull on a screen that has no data to refresh
 * (Settings) does nothing instead of reloading the last screen visited.
 */
export function useRegisterRefresh(reload: () => void, loading: boolean): void {
  useEffect(() => {
    refreshStore.setHandler(reload);
    return () => refreshStore.setHandler(null);
  }, [reload]);

  useEffect(() => {
    refreshStore.setBusy(loading);
    return () => refreshStore.setBusy(false);
  }, [loading]);
}
