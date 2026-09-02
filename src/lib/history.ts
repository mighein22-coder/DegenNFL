import { getSegments, getSegmentForWeekId } from './segments';
import { parseWeekId } from './timezone';
import type { Game, Pick, Segment } from '../types';

/**
 * A member's own season, grouped the way the standings scope it.
 *
 * Two constraints shaped this:
 *
 *   * The subtotals must agree with the Standings screen. Both go through
 *     `getSegmentForWeekId`, so a week cannot land in segment 2 here and
 *     segment 3 there — the week id is the only input either of them has.
 *   * The grouping is done from data already loaded, not by querying per week.
 *     The NHL app fetched a week at a time from inside a render and produced an
 *     N+1; the caller here makes two `.in()` queries and hands both arrays over.
 *
 * A pick whose game is missing from `games` is kept, with `game: undefined`.
 * That should not happen — picks are foreign-keyed to games — but dropping the
 * row silently would make points disappear out of a subtotal, which is the one
 * failure a member would notice and could not explain.
 */

export interface HistoryPick {
  pick: Pick;
  game?: Game;
}

export interface WeekHistory {
  weekId: string;
  weekNumber: number;
  picks: HistoryPick[];
  points: number;
  wins: number;
  losses: number;
  pending: number;
}

export interface SegmentHistory {
  segment: Segment;
  /** Weeks with at least one pick, most recent first. */
  weeks: WeekHistory[];
  points: number;
  wins: number;
  losses: number;
  pending: number;
}

/**
 * Groups picks into weeks and weeks into segments, newest first.
 *
 * Segments a member has no picks in are omitted rather than rendered empty:
 * before week 7 there is nothing to say about segment 2, and a row of zeroes
 * reads like a scoring failure rather than a season not yet played.
 */
export function buildHistory(picks: Pick[], games: Game[]): SegmentHistory[] {
  const gameById = new Map(games.map(game => [game.id, game]));
  const segments = getSegments();

  const byWeek = new Map<string, HistoryPick[]>();
  for (const pick of picks) {
    const list = byWeek.get(pick.weekId);
    const entry: HistoryPick = { pick, game: gameById.get(pick.gameId) };
    if (list) list.push(entry);
    else byWeek.set(pick.weekId, [entry]);
  }

  const weeks: WeekHistory[] = [];
  for (const [weekId, entries] of byWeek) {
    const parsed = parseWeekId(weekId);
    if (!parsed) continue; // Not a week id this season understands.

    // Kickoff order, so a week reads the way it was played. Picks whose game is
    // missing sort last rather than throwing the comparator off.
    entries.sort((a, b) => kickoff(a) - kickoff(b));

    weeks.push({
      weekId,
      weekNumber: parsed.weekNumber,
      picks: entries,
      points: entries.reduce((sum, e) => sum + e.pick.pointsEarned, 0),
      wins: entries.filter(e => e.pick.result === 'WIN').length,
      losses: entries.filter(e => e.pick.result === 'LOSS').length,
      pending: entries.filter(e => e.pick.result === 'PENDING').length
    });
  }

  return segments
    .map(segment => {
      const inSegment = weeks
        .filter(week => getSegmentForWeekId(week.weekId, segments)?.number === segment.number)
        .sort((a, b) => b.weekNumber - a.weekNumber);

      return {
        segment,
        weeks: inSegment,
        points: inSegment.reduce((sum, w) => sum + w.points, 0),
        wins: inSegment.reduce((sum, w) => sum + w.wins, 0),
        losses: inSegment.reduce((sum, w) => sum + w.losses, 0),
        pending: inSegment.reduce((sum, w) => sum + w.pending, 0)
      };
    })
    .filter(entry => entry.weeks.length > 0)
    .sort((a, b) => b.segment.number - a.segment.number);
}

function kickoff(entry: HistoryPick): number {
  return entry.game ? new Date(entry.game.startTime).getTime() : Number.MAX_SAFE_INTEGER;
}
