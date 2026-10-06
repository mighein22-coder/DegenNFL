/**
 * The one thing pull-to-refresh refreshes: whichever data screen is mounted.
 *
 * A screen registers its `useLoader.reload` while it is on show, and the single
 * gesture listener in the shell calls it. A module-level store rather than a
 * context because there is exactly one screen on show at a time, and it keeps
 * registering to one line per screen with no provider to thread.
 *
 * `busy` mirrors the registered screen's `loading`, so the indicator can spin until
 * the data is actually back rather than for a guessed number of milliseconds.
 */
type Listener = () => void;

let handler: (() => void) | null = null;
let busy = false;
const listeners = new Set<Listener>();

const emit = () => listeners.forEach(listener => listener());

export const refreshStore = {
  /** Registers the screen's reload; pass null on unmount. */
  setHandler(next: (() => void) | null) {
    handler = next;
    // A screen that goes away mid-load takes its spinner with it.
    if (next == null) busy = false;
    emit();
  },

  setBusy(next: boolean) {
    if (busy === next) return;
    busy = next;
    emit();
  },

  /** Runs the registered reload. False if there is none, or one is already running. */
  trigger(): boolean {
    if (!handler || busy) return false;
    handler();
    return true;
  },

  canRefresh: () => handler != null,
  isBusy: () => busy,

  subscribe(listener: Listener) {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  }
};
