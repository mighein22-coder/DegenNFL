import { BONUS_POINTS, PICKS_PER_WEEK } from '../constants';
import { isPickLocked, isWeekLocked } from './timezone';
import type { Game, Pick } from '../types';

/**
 * What state a member's sheet is actually in, for the week.
 *
 * The Dashboard has to say one true sentence about the week, and under
 * per-game locking "have you submitted?" is not a question with a yes/no
 * answer. Three picks locked in on Thursday and two still open is neither
 * submitted nor unsubmitted, and a screen that renders it as either is lying
 * to the member about what they can still do.
 *
 * So the state is derived here, as a pure function, rather than assembled from
 * booleans in the view. `PicksView` derives the same facts for its own purpose
 * (which point values are still assignable); this is the summary version, and
 * both go through `isPickLocked` so neither can disagree with the database
 * about what "locked" means.
 */

export type SheetStatus =
  /** The week exists but its schedule has not been captured yet. Not an error. */
  | 'NOT_OPEN'
  /** Open for picks, none made. */
  | 'EMPTY'
  /** Open for picks, some made, fewer than PICKS_PER_WEEK. */
  | 'PARTIAL'
  /** Open for picks, all five made. Still changeable on the unlocked ones. */
  | 'COMPLETE'
  /** Nothing left to change: every game has kicked off, or the week has closed. */
  | 'LOCKED';

export interface SheetSummary {
  status: SheetStatus;
  /** The member's picks whose game has locked. These points are spent. */
  lockedPicks: Pick[];
  /** The member's picks that can still be changed. */
  openPicks: Pick[];
  /** Games still open to pick — the ones a member can act on right now. */
  openGames: Game[];
  /** Games in the week whose picks have closed. */
  lockedGames: Game[];
  /** Picks made, locked and open together. */
  picked: number;
  /** How many of the five are still to be made. Never negative. */
  remaining: number;
  /** Whether the 3-point bonus has been spent, on a locked pick or an open one. */
  bonusSet: boolean;
  /** Games in the week with no line, which cannot be picked until an admin sets one. */
  gamesWithoutLine: Game[];
  /**
   * The next kickoff among games still open — the deadline that actually bites
   * next, which is usually sooner than the Sunday one.
   */
  nextKickoff: Date | null;
}

/**
 * @param weekNumber The week being summarised.
 * @param games      Every game in that week.
 * @param myPicks    The signed-in member's picks, and ONLY theirs. `getPicksForWeek`
 *                   returns other members' revealed picks too; passing those in
 *                   would report someone else's sheet as the member's own.
 */
export function summarizeSheet(
  weekNumber: number,
  games: Game[],
  myPicks: Pick[],
  now: Date = new Date()
): SheetSummary {
  const lockedByGameId = new Map<string, boolean>();
  for (const game of games) {
    lockedByGameId.set(game.id, isPickLocked(weekNumber, game.startTime, now));
  }

  const openGames = games.filter(game => !lockedByGameId.get(game.id));
  const lockedGames = games.filter(game => lockedByGameId.get(game.id));
  const lockedPicks = myPicks.filter(pick => lockedByGameId.get(pick.gameId));
  const openPicks = myPicks.filter(pick => !lockedByGameId.get(pick.gameId));

  const picked = lockedPicks.length + openPicks.length;

  const kickoffs = openGames
    .map(game => new Date(game.startTime))
    .sort((a, b) => a.getTime() - b.getTime());

  // A game with no line is not pickable, so it cannot count towards a sheet
  // being completable — but it is still an open game, and the member needs to
  // see why it is on the sheet and unclickable.
  const gamesWithoutLine = games.filter(game => game.spread == null);

  return {
    status: deriveStatus(weekNumber, games, openGames, picked, now),
    lockedPicks,
    openPicks,
    openGames,
    lockedGames,
    picked,
    remaining: Math.max(0, PICKS_PER_WEEK - picked),
    bonusSet: myPicks.some(pick => pick.confidence === BONUS_POINTS),
    gamesWithoutLine,
    nextKickoff: kickoffs[0] ?? null
  };
}

/**
 * LOCKED outranks COMPLETE deliberately.
 *
 * Once nothing can change, whether the sheet was finished is history rather
 * than a call to action — and the Dashboard's job is to tell a member what to
 * do next. It exposes `picked` alongside, so a view can still draw the
 * difference between five locked in and three locked in with two never made.
 */
function deriveStatus(
  weekNumber: number,
  games: Game[],
  openGames: Game[],
  picked: number,
  now: Date
): SheetStatus {
  if (games.length === 0) return 'NOT_OPEN';
  if (isWeekLocked(weekNumber, now) || openGames.length === 0) return 'LOCKED';
  if (picked >= PICKS_PER_WEEK) return 'COMPLETE';
  return picked === 0 ? 'EMPTY' : 'PARTIAL';
}
