/**
 * The arithmetic of a pull-to-refresh gesture, kept apart from the touch
 * listeners so it can be tested without a browser.
 */

/** How far (px, after resistance) the page has to be pulled to count as a refresh. */
export const PULL_THRESHOLD = 64;
/** The indicator stops following the finger here. */
export const PULL_MAX = 96;
/** A finger travels further than the page: 0.6 of it is shown. */
export const PULL_RESISTANCE = 0.6;
/** Movement under this, either way, is a tap or a wobble and decides nothing. */
const SLOP = 8;

export type PullIntent = 'pending' | 'pull' | 'ignore';

/**
 * What a touch that began at the top of the page is doing, from how far it has
 * moved. Anything that is not a clear downward drag is ignored for the rest of
 * the touch: a sideways drag is a table being scrolled, an upward one is the
 * page scrolling, and neither may turn into a refresh half-way through.
 */
export function pullIntent(dx: number, dy: number): PullIntent {
  if (Math.abs(dx) < SLOP && Math.abs(dy) < SLOP) return 'pending';
  if (Math.abs(dx) > Math.abs(dy)) return 'ignore';
  return dy > 0 ? 'pull' : 'ignore';
}

/** The distance the indicator is drawn at for a finger that has moved `dy` px. */
export function pullDistance(dy: number): number {
  if (dy <= 0) return 0;
  return Math.min(PULL_MAX, dy * PULL_RESISTANCE);
}

/** Whether releasing at this drag distance refreshes. */
export function pullTriggers(dy: number): boolean {
  return pullDistance(dy) >= PULL_THRESHOLD;
}
