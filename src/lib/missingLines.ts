import { formatSpread, hookSpread } from './scoring';
import { getFinalLockAt, getTimeUntil, isPickLocked } from './timezone';
import type { Game } from '../types';

/**
 * The Admin panel's answer to "which games still need a line, and by when?"
 *
 * A game the book had OFF at capture time is seeded with a null spread and is
 * unpickable until an admin supplies one — `game_has_line()` blocks it in the
 * database, and `GameCard` refuses the click. `admin_set_spread` is the ONLY
 * path to that number: it gates on `auth.uid()`, which is null in the SQL
 * editor, so the panel is load-bearing rather than a convenience.
 *
 * WHY THE DEADLINE IS DERIVED HERE RATHER THAN STATED IN THE VIEW
 *
 * Two things close a pick, and which one bites first depends on the game:
 *
 *   * `start_time` — a Thursday night game, or an international kickoff at
 *     09:30 ET, closes days or hours before the sheet does.
 *   * `final_lock_at` — Sunday 13:00 ET, which closes a Sunday-night or Monday
 *     game while it is still four hours from kicking off.
 *
 * So the moment a line stops being worth setting is the EARLIER of the two, and
 * a panel that showed only one of them would be wrong about roughly half the
 * slate. Both `docs/OPERATIONS.md` and this panel used to say "Sunday", which is
 * the answer only for the last game of the week.
 *
 * Past that moment the line can still be written — `admin_set_spread` has no
 * clock in it — but it lands on a game nobody can pick. That is worth showing
 * as its own state rather than hiding the row.
 */

/** One game waiting on a line, with the deadline that actually applies to it. */
export interface MissingLineRow {
  game: Game;
  /** "MIN @ TB", the same shape `activateWeek` reports. */
  matchup: string;
  kickoff: Date;
  /** When picking closes on this game: the earlier of its kickoff and the sheet lock. */
  deadline: Date;
  /** Which of the two the deadline is, so the panel can say why rather than just when. */
  deadlineReason: 'KICKOFF' | 'WEEK_LOCK';
  /** True once that deadline has passed. A line set now cannot be picked against. */
  locked: boolean;
  /** Time left until `deadline`, or 'Locked'. */
  timeRemaining: string;
}

/**
 * Every game in the week with no line, soonest deadline first.
 *
 * The ordering is the point: the game that bites first is the one an admin has
 * to deal with first, and under per-game locking that is not the same as the
 * first game listed on the sheet.
 */
export function findGamesWithoutLine(
  games: Game[],
  weekNumber: number,
  now: Date = new Date()
): MissingLineRow[] {
  const weekLock = getFinalLockAt(weekNumber);

  return games
    .filter(game => game.spread == null)
    .map(game => {
      const kickoff = new Date(game.startTime);
      const kickoffFirst = kickoff <= weekLock;
      const deadline = kickoffFirst ? kickoff : weekLock;

      return {
        game,
        matchup: `${game.awayTeamId} @ ${game.homeTeamId}`,
        kickoff,
        deadline,
        deadlineReason: kickoffFirst ? 'KICKOFF' : 'WEEK_LOCK',
        // Derived through isPickLocked rather than from `deadline` directly, so
        // this can never drift from what the RLS policies and save_picks mean
        // by "locked". The two agreeing is asserted in the tests.
        locked: isPickLocked(weekNumber, game.startTime, now),
        timeRemaining: getTimeUntil(deadline, now)
      } satisfies MissingLineRow;
    })
    .sort((a, b) => a.deadline.getTime() - b.deadline.getTime() || a.matchup.localeCompare(b.matchup));
}

/**
 * The largest line this panel will accept.
 *
 * There is no range CHECK on `games.spread` — the column is `numeric(4, 1)`, so
 * the database would take 99.5 without complaint — and the write is permanent:
 * `admin_set_spread` refuses to move a line that is already frozen, and nothing
 * else in the app rewrites one. A fat-fingered `35` for `3.5` would therefore
 * be a season-long wrong number on a game with no way back short of tearing the
 * week down. The largest spread in NFL history is around 27, so 30 leaves room
 * for a real one and still catches the missing decimal point.
 */
export const MAX_PLAUSIBLE_SPREAD = 30;

export type SpreadInputResult =
  | { ok: true; raw: number; hooked: number }
  | { ok: false; message: string };

/**
 * Validates what an admin typed, and shows what would actually be stored.
 *
 * Accepts the RAW line from the HOME team's point of view and reports the
 * hooked value alongside, because the hook is the part that surprises people:
 * type -3 and the pool plays -3.5, since the half point always goes against the
 * favourite. Showing the stored number before the button is pressed is the only
 * check on a sign error, which is the mistake that inverts a game silently.
 *
 * The half-point rule itself is not reimplemented here — `hookSpread` owns it,
 * and `admin_set_spread` mirrors it in PL/pgSQL. This is the input gate in
 * front of both.
 */
export function parseSpreadInput(text: string): SpreadInputResult {
  const trimmed = text.trim();

  if (trimmed === '') {
    return {
      ok: false,
      message: "Enter a line from the home team's point of view — negative if home is favoured."
    };
  }

  // Number() would take ' ', '1e3' and '0x10'. Only a plain decimal is a line.
  if (!/^[+-]?(\d+(\.\d+)?|\.\d+)$/.test(trimmed)) {
    return {
      ok: false,
      message: `“${trimmed}” is not a number. Enter something like -3, 3, -3.5 or 7.5.`
    };
  }

  const raw = Number(trimmed);

  if (!Number.isInteger(raw * 2)) {
    return {
      ok: false,
      message: `Lines are posted on whole or half points. “${trimmed}” is neither.`
    };
  }

  if (Math.abs(raw) > MAX_PLAUSIBLE_SPREAD) {
    return {
      ok: false,
      message: `${raw} is larger than any real NFL line. Check for a missing decimal point — the line is frozen the moment it is set and cannot be changed afterwards.`
    };
  }

  return { ok: true, raw, hooked: hookSpread(raw) };
}

/**
 * The stored line in the form a human can check the sign against: "TB -3.5,
 * MIN +3.5". An admin reading team names catches an inverted line; an admin
 * reading a bare number does not.
 */
export function describeHookedSpread(
  hooked: number,
  homeTeamId: string,
  awayTeamId: string
): string {
  return `${homeTeamId} ${formatSpread(hooked, true)}, ${awayTeamId} ${formatSpread(hooked, false)}`;
}
