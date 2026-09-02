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
