import { isWeekComplete, parseWeekId } from './timezone';
import { SEASON } from '../constants';
import type { Game, Pick } from '../types';

/**
 * Which teams a member backs, and how that has worked out.
 *
 * Only teams the member has actually picked appear. That is the whole answer to
 * the bye-week problem: 4-6 teams are idle every week and each team plays 17
 * games in 18, so a table of all 32 with holes in it would show absence of data
 * as if it were a result. A team the member has never picked has nothing to say
 * about the member, so it is not a row.
 *
 * Nothing here needs the schedule beyond the game a pick was made on — the
 * caller passes the games those picks belong to, which it has already loaded
 * for the history screen.
 */

export interface TeamAffinityRow {
  teamId: string;
  /** Times this member picked this team. */
  picked: number;
  wins: number;
  losses: number;
  /** Picked but not yet graded — the week is still being played. */
  pending: number;
  /** Points this team has actually earned the member. */
  points: number;
  /** Wins as a share of RESOLVED picks, or null while nothing has resolved. */
  winRate: number | null;
}

/**
 * One member's picks, from the weeks that are actually over.
 *
 * WHY A WEEK IN FLIGHT IS NOT COUNTED. The screen now reads any member, not
 * just the one signed in, and other members' picks arrive a game at a time:
 * RLS reveals each one at its own kickoff, and the Sunday 13:00 ET lock
 * releases the rest. So on a Sunday morning another member's "season" is one
 * Thursday-night pick — a real row, honestly fetched, and a completely false
 * picture of who they back. Counting whole weeks only is what makes two members
 * on this screen comparable.
 *
 * It applies to the signed-in member too, for the same reason: their own
 * in-flight week is complete in the data, so leaving it in would make their
 * numbers the one set on the screen that is measured differently. `My History`
 * is where the week being played belongs, and it still shows all of it.
 *
 * Weeks are cached by id rather than re-derived per pick — five picks a week
 * for eighteen weeks is a lot of `parseWeekId` for eighteen answers.
 */
export function completedWeekPicks(
  picks: Pick[],
  userId: string,
  now: Date = new Date()
): Pick[] {
  const decided = new Map<string, boolean>();

  return picks.filter(pick => {
    if (pick.userId !== userId) return false;

    let complete = decided.get(pick.weekId);
    if (complete === undefined) {
      const parsed = parseWeekId(pick.weekId);
      complete =
        parsed == null
          ? // A week id that does not parse has no calendar behind it, so there
            // is no honest way to say whether it is over. Dropped, like a pick
            // whose game is missing below.
            false
          : parsed.season === SEASON
            ? isWeekComplete(parsed.weekNumber, now)
            : // Another season's week is decided by the season, not the clock:
              // `isWeekComplete` measures against THIS season's calendar and
              // would put a finished 2025 week 5 in the future.
              parsed.season < SEASON;
      decided.set(pick.weekId, complete);
    }
    return complete;
  });
}

/**
 * Sorted by how often the team was picked, then by wins, then by team id so the
 * order is stable across renders and between two members with identical rows.
 */
export function computeTeamAffinity(picks: Pick[], games: Game[]): TeamAffinityRow[] {
  const gameById = new Map(games.map(game => [game.id, game]));
  const rows = new Map<string, TeamAffinityRow>();

  for (const pick of picks) {
    // A pick whose game is missing cannot be attributed to a side with any
    // confidence, so it is left out rather than guessed at.
    if (!gameById.has(pick.gameId)) continue;

    const row = rows.get(pick.selectedTeamId) ?? {
      teamId: pick.selectedTeamId,
      picked: 0,
      wins: 0,
      losses: 0,
      pending: 0,
      points: 0,
      winRate: null
    };

    row.picked += 1;
    row.points += pick.pointsEarned;
    if (pick.result === 'WIN') row.wins += 1;
    else if (pick.result === 'LOSS') row.losses += 1;
    else row.pending += 1;

    rows.set(pick.selectedTeamId, row);
  }

  for (const row of rows.values()) {
    const resolved = row.wins + row.losses;
    row.winRate = resolved === 0 ? null : row.wins / resolved;
  }

  return [...rows.values()].sort(
    (a, b) => b.picked - a.picked || b.wins - a.wins || a.teamId.localeCompare(b.teamId)
  );
}
