import { describe, expect, it } from 'vitest';
import { computeStandings, rankStandings } from '../standings';
import { BONUS_POINTS, ORDINARY_POINTS } from '../../constants';
import type { Pick } from '../../types';
import type { Profile } from '../supabase';

/**
 * The order members are listed in.
 *
 * Points → wins → fewest losses → name, and ONE function produces it. The
 * Standings screen, the Dashboard's top five and the League Matrix all order
 * their rows from `computeStandings`, so the cases below are the contract for
 * all three screens at once — the Matrix and the Dashboard have nothing of
 * their own left to test.
 *
 * The losses tiebreaker only ever separates anybody when two members have
 * played a different number of picks, which in this pool means a missed week
 * or a sheet left short. Those are the cases written out below; a pool where
 * everyone always plays five would never reach that clause at all.
 */

function profile(id: string, name: string): Profile {
  return {
    id,
    email: `${id}@example.com`,
    name,
    avatar: null,
    role: 'member',
    created_at: '2026-09-01T00:00:00Z',
    updated_at: '2026-09-01T00:00:00Z'
  };
}

/** `n` resolved picks for a member, `wins` of them won, each worth 1 point. */
function picks(userId: string, wins: number, losses: number, weekId = 'week-2026-01'): Pick[] {
  const out: Pick[] = [];
  for (let i = 0; i < wins + losses; i++) {
    const won = i < wins;
    out.push({
      userId,
      weekId,
      gameId: `${userId}-g${i}`,
      selectedTeamId: 'PHI',
      confidence: ORDINARY_POINTS,
      pointsEarned: won ? ORDINARY_POINTS : 0,
      result: won ? 'WIN' : 'LOSS'
    });
  }
  return out;
}

describe('rankStandings', () => {
  const row = (name: string, totalPoints: number, wins: number, losses: number) => ({
    name,
    totalPoints,
    wins,
    losses,
    rank: 0
  });

  it('orders by points descending first', () => {
    const ranked = rankStandings(
      [row('Ann', 4, 4, 1), row('Bob', 9, 3, 2), row('Cat', 7, 7, 0)],
      'totalPoints'
    );
    expect(ranked.map(r => r.name)).toEqual(['Bob', 'Cat', 'Ann']);
    expect(ranked.map(r => r.rank)).toEqual([1, 2, 3]);
  });

  it('breaks a points tie on wins descending', () => {
    const ranked = rankStandings(
      [row('Ann', 6, 2, 3), row('Bob', 6, 4, 1)],
      'totalPoints'
    );
    expect(ranked.map(r => r.name)).toEqual(['Bob', 'Ann']);
  });

  it('breaks a points-and-wins tie on fewest losses', () => {
    // Same 6 points off the same 4 wins, but Ann sat a week out and Bob did
    // not. Ann is ahead: she has given nothing away.
    const ranked = rankStandings(
      [row('Bob', 6, 4, 6), row('Ann', 6, 4, 1)],
      'totalPoints'
    );
    expect(ranked.map(r => r.name)).toEqual(['Ann', 'Bob']);
    // And that separation has to reach the rank numbers too, or the table
    // would show a shared rank for two rows it just put in an order.
    expect(ranked.map(r => r.rank)).toEqual([1, 2]);
  });

  it('shares a rank only when points, wins AND losses all match', () => {
    const ranked = rankStandings(
      [row('Cat', 3, 3, 2), row('Ann', 6, 4, 1), row('Bob', 6, 4, 1)],
      'totalPoints'
    );
    expect(ranked.map(r => r.name)).toEqual(['Ann', 'Bob', 'Cat']);
    // Competition ranks: the tie at the top pushes Cat to third, not second.
    expect(ranked.map(r => r.rank)).toEqual([1, 1, 3]);
  });

  it('falls back to name only when nothing else separates two members', () => {
    const ranked = rankStandings(
      [row('Zoe', 6, 4, 1), row('Ann', 6, 4, 1)],
      'totalPoints'
    );
    expect(ranked.map(r => r.name)).toEqual(['Ann', 'Zoe']);
  });
});

describe('computeStandings', () => {
  it('puts the fewer-losses member ahead of an equal-points, equal-wins rival', () => {
    const profiles = [profile('a', 'Ann'), profile('b', 'Bob')];
    const rows = computeStandings(profiles, [
      ...picks('a', 3, 0), // 3 points from 3 wins, no losses
      ...picks('b', 3, 2) // the same 3 points, but two picks lost
    ]);

    expect(rows.map(r => r.name)).toEqual(['Ann', 'Bob']);
    expect(rows.map(r => r.rank)).toEqual([1, 2]);
  });

  it('still ranks a bonus-pick haul above a longer winning streak worth less', () => {
    const profiles = [profile('a', 'Ann'), profile('b', 'Bob')];
    const rows = computeStandings(profiles, [
      ...picks('a', 3, 0), // 3 points, 3 wins
      {
        userId: 'b',
        weekId: 'week-2026-01',
        gameId: 'b-bonus',
        selectedTeamId: 'PHI',
        confidence: BONUS_POINTS,
        pointsEarned: BONUS_POINTS,
        result: 'WIN'
      },
      ...picks('b', 1, 0) // 4 points off 2 wins
    ]);

    // Points come first: fewer wins and the same losses do not matter yet.
    expect(rows.map(r => r.name)).toEqual(['Bob', 'Ann']);
  });

  it('keeps a member with no picks at the bottom rather than dropping them', () => {
    const profiles = [profile('a', 'Ann'), profile('z', 'Zeb')];
    const rows = computeStandings(profiles, picks('a', 1, 0));

    expect(rows.map(r => r.name)).toEqual(['Ann', 'Zeb']);
    expect(rows[1]).toMatchObject({ totalPoints: 0, wins: 0, losses: 0, rank: 2 });
  });

  it('orders a segment scope by that segment, not by the season', () => {
    const profiles = [profile('a', 'Ann'), profile('b', 'Bob')];
    const rows = computeStandings(
      profiles,
      [
        ...picks('a', 5, 0, 'week-2026-01'), // segment 1 only
        ...picks('b', 2, 1, 'week-2026-07') // segment 2 only
      ],
      { segment: 2 }
    );

    expect(rows.map(r => r.name)).toEqual(['Bob', 'Ann']);
    expect(rows[0]).toMatchObject({ totalPoints: 2, seasonPoints: 2 });
    // Season points stay cumulative in every scope, so Ann's five are still
    // visible even though they count for nothing in this table.
    expect(rows[1]).toMatchObject({ totalPoints: 0, seasonPoints: 5 });
  });
});
