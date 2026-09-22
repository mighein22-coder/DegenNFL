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
 * The weeks whose football is over: every game in them final, with a score.
 *
 * THE CALENDAR IS NOT THE ANSWER, and reading it off one is what the first cut
 * of this got wrong. It took "completed" from the Tuesday 18:00 ET rollover, so
 * a week whose Monday night game had finished and been scored still did not
 * count until the following evening — the screen sat a full day behind results
 * every member had already seen on the Matrix.
 *
 * Asking the games instead needs no calendar, no clock and no season: a week is
 * over when its last game is over, whenever that happens to be. It is also the
 * same condition `sync-week` closes a week on (`weekLifecycle.ts`), so this
 * screen and the server agree on what "completed" means.
 *
 * A SCORE is required as well as the FINAL status. `sync-week` writes the two
 * together and grades picks only against a game that has both, so a final game
 * without a score is one whose picks cannot have been resolved yet.
 *
 * A week with NO games is not complete. Nothing to be over is not the same as
 * being over, and a week row exists from the moment somebody opens the app in
 * it — days before its schedule is seeded.
 */
export function completedWeekIds(games: Game[]): Set<string> {
  const weeks = new Set<string>();
  const unfinished = new Set<string>();

  for (const game of games) {
    weeks.add(game.weekId);
    if (game.status !== 'FINAL' || game.homeScore == null || game.awayScore == null) {
      unfinished.add(game.weekId);
    }
  }

  for (const weekId of unfinished) weeks.delete(weekId);
  return weeks;
}

/**
 * One member's picks, from the weeks that are actually over.
 *
 * WHY A WEEK IN FLIGHT IS NOT COUNTED. The screen reads any member, not just
 * the one signed in, and other members' picks arrive a game at a time: RLS
 * reveals each one at its own kickoff, and the Sunday 13:00 ET lock releases
 * the rest. So on a Sunday morning another member's "season" is one
 * Thursday-night pick — a real row, honestly fetched, and a completely false
 * picture of who they back. Counting whole weeks only is what makes two members
 * on this screen comparable.
 *
 * It applies to the signed-in member too, for the same reason: their own
 * in-flight week is complete in the data, so leaving it in would make their
 * numbers the one set on the screen that is measured differently. `My History`
 * is where the week being played belongs, and it still shows all of it.
 *
 * `games` must be every game of the weeks being considered, not only the games
 * picked — a week is judged by its whole slate. `getGamesForWeeks` returns
 * exactly that.
 */
export function completedWeekPicks(
  picks: Pick[],
  games: Game[],
  userId: string
): Pick[] {
  const complete = completedWeekIds(games);
  return picks.filter(pick => pick.userId === userId && complete.has(pick.weekId));
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
