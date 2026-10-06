import React, { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { RefreshCw } from 'lucide-react';
import { PULL_THRESHOLD, pullDistance, pullIntent, pullTriggers } from '../../lib/pullToRefresh';
import type { PullIntent } from '../../lib/pullToRefresh';
import { refreshStore } from '../../lib/refreshStore';

/**
 * Pull down from the top of a data screen to reload it. Phones only: it listens
 * for touches, and a mouse never produces any.
 *
 * Rendered once, in the shell. The screen on show registers its reload
 * (`useRegisterRefresh`); this only draws the indicator and decides when a drag
 * counts. Nothing is torn down by it, so a refresh is safe on the pick sheet:
 * `useLoader` keeps the old data on screen and `PicksView` keeps its draft.
 *
 * It replaces the browser's own pull-to-refresh (`overscroll-behavior-y` in
 * index.css switches that off), which reloads the whole page and would throw an
 * unsaved sheet away.
 */
export const PullToRefresh: React.FC = () => {
  // The registered screen's `loading`: true on its first load too, so it only
  // draws a spinner for a refresh the member asked for (`refreshing`).
  const loading = useSyncExternalStore(refreshStore.subscribe, refreshStore.isBusy);
  const [refreshing, setRefreshing] = useState(false);
  const [pull, setPull] = useState(0);
  const sawLoading = useRef(false);
  const gesture = useRef<{ x: number; y: number; intent: PullIntent } | null>(null);

  // The spinner stops when the load it started has finished. The timeout is a
  // backstop for a reload that never reports loading, so it cannot stick.
  useEffect(() => {
    if (!refreshing) {
      sawLoading.current = false;
      return;
    }
    if (loading) sawLoading.current = true;
    else if (sawLoading.current) setRefreshing(false);
  }, [loading, refreshing]);
  useEffect(() => {
    if (!refreshing) return;
    const timer = setTimeout(() => setRefreshing(false), 4000);
    return () => clearTimeout(timer);
  }, [refreshing]);

  useEffect(() => {
    const atTop = () => (document.scrollingElement?.scrollTop ?? 0) <= 0;
    // Under the More sheet's scrim a pull would refresh a page the member
    // cannot see.
    const sheetOpen = () => document.getElementById('more-menu') != null;

    const onStart = (e: TouchEvent) => {
      if (e.touches.length !== 1 || !atTop() || sheetOpen() || !refreshStore.canRefresh()) {
        gesture.current = null;
        return;
      }
      gesture.current = { x: e.touches[0].clientX, y: e.touches[0].clientY, intent: 'pending' };
    };

    const onMove = (e: TouchEvent) => {
      const g = gesture.current;
      if (!g || g.intent === 'ignore') return;
      const dx = e.touches[0].clientX - g.x;
      const dy = e.touches[0].clientY - g.y;
      if (g.intent === 'pending') g.intent = pullIntent(dx, dy);
      if (g.intent === 'pull') setPull(pullDistance(dy));
    };

    const onEnd = (e: TouchEvent) => {
      const g = gesture.current;
      gesture.current = null;
      setPull(0);
      if (!g || g.intent !== 'pull') return;
      const dy = (e.changedTouches[0]?.clientY ?? g.y) - g.y;
      if (pullTriggers(dy) && refreshStore.trigger()) setRefreshing(true);
    };

    const onCancel = () => {
      gesture.current = null;
      setPull(0);
    };

    document.addEventListener('touchstart', onStart, { passive: true });
    document.addEventListener('touchmove', onMove, { passive: true });
    document.addEventListener('touchend', onEnd, { passive: true });
    document.addEventListener('touchcancel', onCancel, { passive: true });
    return () => {
      document.removeEventListener('touchstart', onStart);
      document.removeEventListener('touchmove', onMove);
      document.removeEventListener('touchend', onEnd);
      document.removeEventListener('touchcancel', onCancel);
    };
  }, []);

  const shown = refreshing ? PULL_THRESHOLD : pull;
  if (shown <= 0) return null;

  return (
    <div
      role="status"
      aria-label={refreshing ? 'Refreshing' : 'Pull to refresh'}
      className="pointer-events-none fixed inset-x-0 top-0 z-40 flex justify-center md:hidden print:hidden"
      style={{ transform: `translateY(${shown - 40}px)` }}
    >
      <span className="flex h-10 w-10 items-center justify-center rounded-full border border-line bg-surface-raised shadow-card">
        <RefreshCw
          size={18}
          aria-hidden
          className={refreshing ? 'animate-spin text-brand-400' : 'text-muted'}
          style={refreshing ? undefined : { transform: `rotate(${(shown / PULL_THRESHOLD) * 270}deg)` }}
        />
      </span>
    </div>
  );
};
