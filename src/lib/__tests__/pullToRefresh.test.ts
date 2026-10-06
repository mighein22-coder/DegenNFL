import { describe, expect, it, vi } from 'vitest';
import {
  PULL_MAX,
  PULL_RESISTANCE,
  PULL_THRESHOLD,
  pullDistance,
  pullIntent,
  pullTriggers
} from '../pullToRefresh';
import { refreshStore } from '../refreshStore';

describe('pullIntent', () => {
  it('decides nothing for a tap or a wobble', () => {
    expect(pullIntent(3, 4)).toBe('pending');
    expect(pullIntent(0, 0)).toBe('pending');
  });

  it('calls a clear downward drag a pull', () => {
    expect(pullIntent(2, 30)).toBe('pull');
  });

  it('ignores a sideways drag (a table being scrolled) and an upward one', () => {
    expect(pullIntent(40, 12)).toBe('ignore');
    expect(pullIntent(0, -30)).toBe('ignore');
  });
});

describe('pullDistance and pullTriggers', () => {
  it('shows less than the finger moved, and never goes negative or past the cap', () => {
    expect(pullDistance(-50)).toBe(0);
    expect(pullDistance(100)).toBeLessThan(100);
    expect(pullDistance(10_000)).toBe(PULL_MAX);
  });

  it('refreshes only once the indicator has reached the threshold', () => {
    // The raw drag that lands exactly on the threshold, a px short and a px over.
    const raw = PULL_THRESHOLD / PULL_RESISTANCE;
    expect(pullTriggers(raw - 1)).toBe(false);
    expect(pullTriggers(raw + 1)).toBe(true);
  });
});

describe('refreshStore', () => {
  it('does nothing when no screen has registered', () => {
    refreshStore.setHandler(null);
    expect(refreshStore.trigger()).toBe(false);
  });

  it('runs the registered reload, and not again while it is busy', () => {
    const reload = vi.fn();
    refreshStore.setHandler(reload);
    expect(refreshStore.trigger()).toBe(true);
    expect(reload).toHaveBeenCalledTimes(1);

    refreshStore.setBusy(true);
    expect(refreshStore.trigger()).toBe(false);
    expect(reload).toHaveBeenCalledTimes(1);

    refreshStore.setBusy(false);
    expect(refreshStore.trigger()).toBe(true);
    refreshStore.setHandler(null);
  });

  it('clears busy when the screen goes away, so the spinner cannot stick', () => {
    refreshStore.setHandler(() => {});
    refreshStore.setBusy(true);
    refreshStore.setHandler(null);
    expect(refreshStore.isBusy()).toBe(false);
  });

  it('tells subscribers when the state moves, and stops after unsubscribe', () => {
    const listener = vi.fn();
    const off = refreshStore.subscribe(listener);
    refreshStore.setBusy(true);
    expect(listener).toHaveBeenCalledTimes(1);
    off();
    refreshStore.setBusy(false);
    expect(listener).toHaveBeenCalledTimes(1);
  });
});
