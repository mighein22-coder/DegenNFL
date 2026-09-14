import type { Profile } from './supabase';
import { getSegments, getSegmentForWeekId } from './segments';
import type { Pick, Segment, StandingsRow } from '../types';

/**
 * Standings.
 *
 * Ported from the NHL app essentially unchanged. That is a deliberate result
 * rather than a coincidence: hooking every spread to a half point means a pick
 * is only ever WIN or LOSS and `pointsEarned` is only ever an integer, so
 * nothing in here needed to learn about pushes or fractional points.
 */

export interface StandingsScope {
  /**
   * Week whose points populate `weeklyScore`. When omitted, falls back to the
   * most recent week that has any resolved picks, so the column is meaningful
   * before the current week has been scored.
   *
   * This names the COLUMN only and filters nothing — `within` below is what
   * decides who is ahead of whom.
   */
  weekId?: string;
  /**
   * What counts toward points, wins, losses and rank: the whole season (omit
   * or pass null), one segment, or one week.
   *
   * One field rather than two nullable ones because the three are exclusive —
   * a table scoped to both a segment and a week is not a thing, and a shape
   * that cannot express it needs no rule saying so. The Matrix's scope pills
   * (issue #27) are this union, one pill each.
   */
  within?: { segment: number } | { week: string } | null;
}

/**
 * The latest week that has at least one scored pick, if any.
 *
 * Exported because the Standings screen has to NAME the week its weekly column
 * covers. Deriving it a second time in the view would let the header and the
 * numbers under it drift apart.
 */
export function mostRecentScoredWeekId(picks: Pick[]): string | undefined {
  let latest: string | undefined;
  for (const pick of picks) {
    if (pick.result !== 'PENDING' && (latest === undefined || pick.weekId > latest)) {
      latest = pick.weekId;
    }
  }
  return latest;
}

/**
 * Builds the standings table from raw profiles and picks.
 *
 * Kept as a pure function rather than a query so the season table and each
 * segment table can be derived from one fetch, letting the segment selector
 * switch scope without a round-trip. At pool scale (~20 members, 18 weeks, 5
 * picks each) that is a couple of thousand rows.
 *
 * Scope is season, one segment, or one week: whichever is chosen, points,
 * wins, losses and rank count only picks inside it. `seasonPoints` stays
 * cumulative in every scope so a member's overall position is never hidden.
 *
 * A WEEK SCOPE IS ONLY EVER AS COMPLETE AS WHAT THE READER MAY SEE. Unrevealed
 * picks are not in `picks` at all — `picks_select_visible` drops them before
 * they reach the client — so ordering by a week in progress ranks members
 * partly by how much of their sheet has kicked off. That is honest for a
 * result table filling in live, and it is why the Matrix (issue #27) labels
 * this scope by the week rather than presenting it as a standing.
 *
 * Members with no picks in the selected scope still appear, at zero — they
 * are behind, not absent.
 */
export function computeStandings(
  profiles: Profile[],
  picks: Pick[],
  scope: StandingsScope = {}
): StandingsRow[] {
  const { within = null } = scope;
  const segments: Segment[] = getSegments();
  const weekId = scope.weekId ?? mostRecentScoredWeekId(picks);

  // Precompute each week's segment once rather than per pick per member
  const segmentByWeek = new Map<string, number | null>();
  const segmentOf = (pickWeekId: string): number | null => {
    if (!segmentByWeek.has(pickWeekId)) {
      segmentByWeek.set(pickWeekId, getSegmentForWeekId(pickWeekId, segments)?.number ?? null);
    }
    return segmentByWeek.get(pickWeekId)!;
  };

  const picksByUser = new Map<string, Pick[]>();
  for (const pick of picks) {
    const list = picksByUser.get(pick.userId);
    if (list) list.push(pick);
    else picksByUser.set(pick.userId, [pick]);
  }

  const inScope = (pick: Pick): boolean => {
    if (within == null) return true;
    if ('week' in within) return pick.weekId === within.week;
    return segmentOf(pick.weekId) === within.segment;
  };

  const rows = profiles.map(profile => {
    const userPicks = picksByUser.get(profile.id) ?? [];
    const scoped = within == null ? userPicks : userPicks.filter(inScope);

    return {
      userId: profile.id,
      name: profile.name,
      avatar: profile.avatar ?? '',
      totalPoints: scoped.reduce((sum, p) => sum + p.pointsEarned, 0),
      seasonPoints: userPicks.reduce((sum, p) => sum + p.pointsEarned, 0),
      wins: scoped.filter(p => p.result === 'WIN').length,
      losses: scoped.filter(p => p.result === 'LOSS').length,
      weeklyScore: weekId
        ? userPicks.filter(p => p.weekId === weekId).reduce((sum, p) => sum + p.pointsEarned, 0)
        : 0,
      rank: 0
    };
  });

  return rankStandings(rows, 'totalPoints');
}

/**
 * The one ordering rule for members, everywhere they are listed.
 *
 * Points descending, then wins descending, then losses ASCENDING, then name
 * A-Z. Wins break point ties because the same points off more correct picks
 * means the confidence was spread better; losses break the rest because two
 * members level on points and wins are not level if one of them got there
 * having lost fewer — which happens here whenever somebody misses a week or
 * leaves a pick off a sheet, so it is not the dead tiebreaker it would be in a
 * pool where everyone always plays five.
 *
 * Name is last only so the order is stable, not because A-Z means anything.
 *
 * Deliberately NOT exported. Every screen that lists members — the Standings
 * table, the Dashboard's top five, the League Matrix — reaches this rule by
 * calling `computeStandings` and rendering the rows in the order it returns.
 * All three being the same order is the feature (issues #22, #23), and a
 * second caller sorting for itself is how that quietly stops being true.
 */
function compareStandings<T extends { wins: number; losses: number; name: string }>(
  a: T,
  b: T,
  scoreOf: (row: T) => number
): number {
  return (
    scoreOf(b) - scoreOf(a) ||
    b.wins - a.wins ||
    a.losses - b.losses ||
    a.name.localeCompare(b.name)
  );
}

/**
 * Sorts standings and assigns ranks.
 *
 * Ordering is `compareStandings` above.
 *
 * Ranks are *competition ranks*: members who tie on points, wins AND losses
 * share a rank, and the next rank skips accordingly (1, 2, 2, 4). All three
 * have to match — a rank shared by two rows the sort deliberately separated
 * would be the table contradicting itself.
 *
 * `scoreKey` selects which points column drives the ordering, so season and
 * per-segment standings can share this function.
 */
export function rankStandings<
  T extends { wins: number; losses: number; name: string; rank: number }
>(rows: T[], scoreKey: keyof T): T[] {
  const score = (row: T) => Number(row[scoreKey] ?? 0);

  const sorted = [...rows].sort((a, b) => compareStandings(a, b, score));

  let lastRank = 0;
  return sorted.map((row, idx) => {
    const prev = sorted[idx - 1];
    const tiedWithPrev =
      prev !== undefined &&
      score(prev) === score(row) &&
      prev.wins === row.wins &&
      prev.losses === row.losses;

    lastRank = tiedWithPrev ? lastRank : idx + 1;
    return { ...row, rank: lastRank };
  });
}
