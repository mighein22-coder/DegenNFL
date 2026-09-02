import { describe, expect, it } from 'vitest';
import { buildHistory } from '../history';
import { computeStandings } from '../standings';
import { BONUS_POINTS, ORDINARY_POINTS } from '../../constants';
import type { Game, Pick } from '../../types';
import type { Profile } from '../supabase';

/**
 * The member's own season, grouped by week and segment.
 *
 * The assertion that matters most is the last one: the segment subtotals here
 * and the segment scope in `computeStandings` must agree. They are separate
 * code paths reading the same week ids, and a disagreement between them would
 * show a member one total on their history page and another in the table they
 * are being ranked by.
 */

function game(id: string, weekId: string, startTime: string): Game {
  return {
    id,
    weekId,
    homeTeamId: 'PHI',
    awayTeamId: 'DAL',
    startTime,
    status: 'FINAL',
    homeScore: 27,
    awayScore: 20,
    spread: -3.5
  };
}

function pick(
  gameId: string,
  weekId: string,
  result: Pick['result'],
  confidence: number = ORDINARY_POINTS
): Pick {
  return {
    userId: 'me',
    weekId,
    gameId,
    selectedTeamId: 'PHI',
    confidence,
    pointsEarned: result === 'WIN' ? confidence : 0,
    result
  };
}

describe('buildHistory', () => {
  it('returns nothing for a member who has not picked', () => {
    expect(buildHistory([], [])).toEqual([]);
  });

  it('groups picks into weeks and weeks into segments, newest first', () => {
    const games = [
      game('g1', 'week-2026-01', '2026-09-13T17:00:00Z'),
      game('g2', 'week-2026-02', '2026-09-20T17:00:00Z'),
      game('g3', 'week-2026-08', '2026-11-01T17:00:00Z')
    ];
    const picks = [
      pick('g1', 'week-2026-01', 'WIN'),
      pick('g2', 'week-2026-02', 'LOSS'),
      pick('g3', 'week-2026-08', 'WIN', BONUS_POINTS)
    ];

    const history = buildHistory(picks, games);

    // Weeks 1-6 are segment 1, 7-12 segment 2. Newest segment leads.
    expect(history.map(h => h.segment.number)).toEqual([2, 1]);
    expect(history[0].weeks.map(w => w.weekNumber)).toEqual([8]);
    expect(history[1].weeks.map(w => w.weekNumber)).toEqual([2, 1]);
  });

  it('omits segments the member has no picks in rather than showing zeroes', () => {
    const history = buildHistory(
      [pick('g1', 'week-2026-01', 'WIN')],
      [game('g1', 'week-2026-01', '2026-09-13T17:00:00Z')]
    );
    expect(history).toHaveLength(1);
    expect(history[0].segment.number).toBe(1);
  });

  it('totals points, wins, losses and pending per week and per segment', () => {
    const games = [
      game('g1', 'week-2026-01', '2026-09-13T17:00:00Z'),
      game('g2', 'week-2026-01', '2026-09-13T20:00:00Z'),
      game('g3', 'week-2026-02', '2026-09-20T17:00:00Z')
    ];
    const picks = [
      pick('g1', 'week-2026-01', 'WIN', BONUS_POINTS),
      pick('g2', 'week-2026-01', 'LOSS'),
      pick('g3', 'week-2026-02', 'PENDING')
    ];

    const [segment] = buildHistory(picks, games);

    expect(segment.points).toBe(3);
    expect(segment.wins).toBe(1);
    expect(segment.losses).toBe(1);
    expect(segment.pending).toBe(1);

    const week1 = segment.weeks.find(w => w.weekNumber === 1)!;
    expect(week1.points).toBe(3);
    expect(week1.wins).toBe(1);
    expect(week1.losses).toBe(1);
  });

  it('orders a week picks by kickoff', () => {
    const games = [
      game('late', 'week-2026-01', '2026-09-13T20:25:00Z'),
      game('early', 'week-2026-01', '2026-09-13T17:00:00Z')
    ];
    const picks = [
      pick('late', 'week-2026-01', 'WIN'),
      pick('early', 'week-2026-01', 'WIN')
    ];

    const [segment] = buildHistory(picks, games);
    expect(segment.weeks[0].picks.map(p => p.pick.gameId)).toEqual(['early', 'late']);
  });

  it('keeps a pick whose game row is missing, so its points stay in the subtotal', () => {
    const [segment] = buildHistory([pick('ghost', 'week-2026-01', 'WIN')], []);

    expect(segment.points).toBe(1);
    expect(segment.weeks[0].picks[0].game).toBeUndefined();
  });

  it('ignores a pick whose week id is not a week of this season', () => {
    expect(buildHistory([pick('g1', 'week-2026-99', 'WIN')], [])).toEqual([]);
  });

  it('agrees with computeStandings on what a segment totals', () => {
    const profiles: Profile[] = [
      {
        id: 'me',
        email: 'me@example.com',
        name: 'Me',
        avatar: null,
        role: 'member',
        created_at: '',
        updated_at: ''
      }
    ];

    const games = [
      game('g1', 'week-2026-06', '2026-10-18T17:00:00Z'), // last week of segment 1
      game('g2', 'week-2026-07', '2026-10-25T17:00:00Z') // first week of segment 2
    ];
    const picks = [
      pick('g1', 'week-2026-06', 'WIN', BONUS_POINTS),
      pick('g2', 'week-2026-07', 'WIN')
    ];

    const history = buildHistory(picks, games);

    for (const entry of history) {
      const [row] = computeStandings(profiles, picks, { segment: entry.segment.number });
      expect(row.totalPoints).toBe(entry.points);
      expect(row.wins).toBe(entry.wins);
      expect(row.losses).toBe(entry.losses);
    }
  });
});
