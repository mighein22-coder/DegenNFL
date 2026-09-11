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
   */
  weekId?: string;
  /**
   * Restrict wins, losses, points and rank to a single segment. Omit or pass
   * null for the cumulative season table.
   */
  segment?: number | null;
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
 * Scoping is per segment and total: when a segment is selected, points, wins,
 * losses and rank all count only that segment's weeks. `seasonPoints` stays
 * cumulative in every scope so a member's overall position is never hidden.
 *
 * Members with no picks in the selected segment still appear, at zero — they
 * are behind, not absent.
 */
export function computeStandings(
  profiles: Profile[],
  picks: Pick[],
  scope: StandingsScope = {}
): StandingsRow[] {
  const { segment = null } = scope;
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

  const rows = profiles.map(profile => {
    const userPicks = picksByUser.get(profile.id) ?? [];
    const scoped =
      segment == null ? userPicks : userPicks.filter(p => segmentOf(p.weekId) === segment);

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
