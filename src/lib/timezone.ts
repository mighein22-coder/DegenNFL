import { toZonedTime, fromZonedTime, format } from 'date-fns-tz';
import { SEASON, SEASON_WEEK1_SUNDAY, WEEK_COUNT } from '../constants';

const ET_TIMEZONE = 'America/New_York';

/** Hour (ET) of the Sunday whole-sheet deadline. */
const FINAL_LOCK_HOUR = 13;

/** Hour (ET) on Tuesday at which the pool advances to the next week. */
const ROLLOVER_HOUR = 6;

/**
 * Eastern-time helpers.
 *
 * Carried over from the NHL app, which learned the hard way that this is where
 * the bugs live: every date here is built from explicit Y/M/D components and
 * converted with `fromZonedTime`, never by string concatenation and never by
 * trusting the host's local zone. The Netlify functions run in UTC and import
 * these same functions (see netlify/functions/_shared/etTime.ts), so the
 * browser and the server cannot disagree about when anything locks.
 *
 * WHAT IS DIFFERENT FROM THE NHL APP
 *
 * The NHL pool played one game day, so it had one deadline. This pool spans
 * Thursday to Monday and locks in two ways at once:
 *
 *   1. Per game, at that game's own kickoff (`isGameLocked`).
 *   2. Per week, at Sunday 13:00 ET (`getFinalLockAt`), which closes the sheet
 *      whether or not every game has kicked off.
 *
 * A pick is writable only while BOTH are open. Thursday-night games therefore
 * close days before the rest of the sheet, and the ~09:30 ET international
 * games close before the Sunday lock — both fall out of rule 1 with no special
 * casing, which is the main argument for it.
 */

/** Parses `YYYY-MM-DD` into calendar components, with no zone applied. */
function parseDateParts(dateStr: string): { year: number; month: number; day: number } {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateStr);
  if (!match) {
    throw new Error(`Expected a YYYY-MM-DD date, got "${dateStr}"`);
  }
  return {
    year: Number(match[1]),
    month: Number(match[2]) - 1, // JS months are 0-indexed
    day: Number(match[3])
  };
}

/**
 * The Sunday of a given week number, as a `YYYY-MM-DD` calendar date.
 *
 * NFL weeks are exactly seven days apart, so the whole season calendar follows
 * from one anchor. Computed in UTC at noon, far from any date boundary — this
 * is a calendar date, not an instant.
 */
export function getWeekSunday(weekNumber: number): string {
  assertWeekNumber(weekNumber);
  const { year, month, day } = parseDateParts(SEASON_WEEK1_SUNDAY);
  const sunday = new Date(Date.UTC(year, month, day, 12, 0, 0, 0));
  sunday.setUTCDate(sunday.getUTCDate() + 7 * (weekNumber - 1));
  return sunday.toISOString().slice(0, 10);
}

/**
 * The whole-sheet deadline for a week: Sunday 13:00 ET. DST-aware.
 *
 * The database derives this same value independently, from the week id, rather
 * than accepting it from the client — see `season_week1_sunday()` and the
 * `weeks` trigger in 0001_init.sql. If you change the anchor or the hour here,
 * change it there too.
 */
export function getFinalLockAt(weekNumber: number): Date {
  const { year, month, day } = parseDateParts(getWeekSunday(weekNumber));
  return fromZonedTime(new Date(year, month, day, FINAL_LOCK_HOUR, 0, 0, 0), ET_TIMEZONE);
}

/** Whether a week's whole-sheet deadline has passed. */
export function isWeekLocked(weekNumber: number, now: Date = new Date()): boolean {
  return now >= getFinalLockAt(weekNumber);
}

/**
 * Whether one game's picks have closed.
 *
 * A game locks at its own kickoff. Callers must ALSO check `isWeekLocked` —
 * `isPickLocked` below does both, and is what UI and services should use.
 */
export function isGameLocked(startTime: string | Date, now: Date = new Date()): boolean {
  const kickoff = typeof startTime === 'string' ? new Date(startTime) : startTime;
  return now >= kickoff;
}

/**
 * Whether a pick on a given game is closed — the single condition the RLS
 * policies, the save RPC and the UI all express. Mirrors `pick_locked()` in
 * 0001_init.sql exactly; the two must never diverge.
 */
export function isPickLocked(
  weekNumber: number,
  startTime: string | Date,
  now: Date = new Date()
): boolean {
  return isGameLocked(startTime, now) || isWeekLocked(weekNumber, now);
}

/**
 * When a week hands over to the next: the TUESDAY after its Sunday, 06:00 ET.
 *
 * That is after Monday Night Football has finished and been scored, and before
 * the new slate is worth showing. Between the Sunday lock and this moment the
 * current week is still the one just played, so members see their locked sheet
 * and the results coming in rather than a week they cannot pick yet.
 *
 * Built from the week's own calendar date rather than by adding a fixed number
 * of hours to the Sunday lock. The two differ: a fixed offset drifts by an hour
 * across the November DST change, which would quietly move the rollover to
 * 05:00 ET for the back half of the season.
 */
export function getWeekRolloverAt(weekNumber: number): Date {
  const { year, month, day } = parseDateParts(getWeekSunday(weekNumber));
  // day + 2 is the Tuesday; the Date constructor normalises month overflow.
  return fromZonedTime(new Date(year, month, day + 2, ROLLOVER_HOUR, 0, 0, 0), ET_TIMEZONE);
}

/**
 * The week number the pool is currently on.
 *
 * Clamped to 1..WEEK_COUNT: before the season it reads 1, after it reads 18.
 */
export function getCurrentWeekNumber(now: Date = new Date()): number {
  let current = 1;
  for (let week = 1; week < WEEK_COUNT; week++) {
    if (now < getWeekRolloverAt(week)) break;
    current = week + 1;
  }
  return current;
}

/** Canonical week id: `week-2026-08`. The database derives the lock from this. */
export function buildWeekId(weekNumber: number, season: number = SEASON): string {
  assertWeekNumber(weekNumber);
  return `week-${season}-${String(weekNumber).padStart(2, '0')}`;
}

/** Pulls the season and week number back out of a week id, or null if malformed. */
export function parseWeekId(weekId: string): { season: number; weekNumber: number } | null {
  const match = /^week-(\d{4})-(\d{2})$/.exec(weekId);
  if (!match) return null;

  const weekNumber = Number(match[2]);
  if (weekNumber < 1 || weekNumber > WEEK_COUNT) return null;

  return { season: Number(match[1]), weekNumber };
}

function assertWeekNumber(weekNumber: number): void {
  if (!Number.isInteger(weekNumber) || weekNumber < 1 || weekNumber > WEEK_COUNT) {
    throw new Error(`Week number must be an integer 1..${WEEK_COUNT}, got ${weekNumber}`);
  }
}

/** Formats a date in ET. */
export function formatETTime(date: Date, formatStr: string = 'h:mm a zzz'): string {
  return format(toZonedTime(date, ET_TIMEZONE), formatStr, { timeZone: ET_TIMEZONE });
}

/** Human-readable time remaining until an instant, or 'Locked' once past. */
export function getTimeUntil(target: Date, now: Date = new Date()): string {
  if (now >= target) return 'Locked';

  const diff = target.getTime() - now.getTime();
  const hours = Math.floor(diff / (1000 * 60 * 60));
  const minutes = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));

  if (hours > 24) {
    const days = Math.floor(hours / 24);
    return `${days}d ${hours % 24}h`;
  }
  return `${hours}h ${minutes}m`;
}
