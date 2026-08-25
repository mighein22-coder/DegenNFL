/**
 * Eastern-time helpers for the Netlify functions.
 *
 * Re-exported from the app's `src/lib/timezone.ts` so the browser and the
 * functions cannot disagree about when a game locks or a week closes. The NHL
 * app hand-rolled a second copy of this in `sync-week`, and the duplicate had a
 * real bug — it built a date by string concatenation, so a month-end date
 * produced an invalid one and the week could never close. Sharing the module
 * rather than the idea is the fix.
 *
 * These are safe in the UTC Lambda runtime: `fromZonedTime` reinterprets the
 * supplied date components as Eastern regardless of the host timezone, so the
 * result does not depend on the process's local zone.
 *
 * A directory under `netlify/functions/` is only treated as a function when it
 * contains a file matching its own name, so `_shared/` ships as a plain module.
 */
export {
  getWeekSunday,
  getFinalLockAt,
  getWeekRolloverAt,
  isWeekLocked,
  isGameLocked,
  isPickLocked,
  getCurrentWeekNumber,
  buildWeekId,
  parseWeekId,
  formatETTime,
  getTimeUntil
} from '../../../src/lib/timezone';

/**
 * Scoring, shared for the same reason: `sync-week` grades picks against the
 * spread, and it must use the same `hookSpread` / `gradePick` the UI explains
 * to members. A second implementation here would eventually disagree with the
 * one the tests cover.
 */
export { hookSpread, gradePick, pointsFor, formatSpread } from '../../../src/lib/scoring';
