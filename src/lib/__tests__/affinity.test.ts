import { describe, expect, it } from 'vitest';
import { computeTeamAffinity } from '../affinity';
import { BONUS_POINTS, ORDINARY_POINTS } from '../../constants';
import type { Game, Pick } from '../../types';

/**
 * Per-team picked/won/lost for one member.
 *
 * The bye-week rule is the one worth pinning down: teams the member has never
 * picked must not appear at all. A row of zeroes for an idle team reads as a
 * scoring failure, and with 4-6 teams idle every week there would be a lot of
 * them.
 */

function game(id: string, home: string, away: string): Game {
  return {
    id,
    weekId: 'week-2026-01',
    homeTeamId: home,
    awayTeamId: away,
    startTime: '2026-09-13T17:00:00Z',
    status: 'FINAL',
    spread: -3.5
  };
}

function pick(gameId: string, teamId: string, result: Pick['result'], confidence = ORDINARY_POINTS): Pick {
  return {
    userId: 'me',
    weekId: 'week-2026-01',
    gameId,
    selectedTeamId: teamId,
    confidence,
    pointsEarned: result === 'WIN' ? confidence : 0,
    result
  };
}

describe('computeTeamAffinity', () => {
  it('returns nothing when nothing has been picked', () => {
    expect(computeTeamAffinity([], [])).toEqual([]);
  });

  it('only lists teams the member actually picked', () => {
    const games = [game('g1', 'PHI', 'DAL')];
    const rows = computeTeamAffinity([pick('g1', 'PHI', 'WIN')], games);

    expect(rows.map(r => r.teamId)).toEqual(['PHI']);
    // DAL played, and was even on the same card — but it was not backed, so it
    // has nothing to say about this member.
    expect(rows.some(r => r.teamId === 'DAL')).toBe(false);
  });

  it('accumulates picks, results and points per team', () => {
    const games = [game('g1', 'PHI', 'DAL'), game('g2', 'NYG', 'PHI')];
    const rows = computeTeamAffinity(
      [pick('g1', 'PHI', 'WIN', BONUS_POINTS), pick('g2', 'PHI', 'LOSS')],
      games
    );

    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      teamId: 'PHI',
      picked: 2,
      wins: 1,
      losses: 1,
      pending: 0,
      points: 3,
      winRate: 0.5
    });
  });

  it('leaves the win rate null until something has resolved', () => {
    const rows = computeTeamAffinity(
      [pick('g1', 'PHI', 'PENDING')],
      [game('g1', 'PHI', 'DAL')]
    );
    expect(rows[0].winRate).toBeNull();
    expect(rows[0].pending).toBe(1);
  });

  it('excludes pending picks from the win rate denominator', () => {
    const games = [game('g1', 'PHI', 'DAL'), game('g2', 'NYG', 'PHI')];
    const rows = computeTeamAffinity(
      [pick('g1', 'PHI', 'WIN'), pick('g2', 'PHI', 'PENDING')],
      games
    );
    expect(rows[0].winRate).toBe(1);
  });

  it('sorts by times picked, then wins, then team id', () => {
    const games = [
      game('g1', 'PHI', 'DAL'),
      game('g2', 'PHI', 'NYG'),
      game('g3', 'KC', 'DEN'),
      game('g4', 'BUF', 'MIA')
    ];
    const rows = computeTeamAffinity(
      [
        pick('g1', 'PHI', 'WIN'),
        pick('g2', 'PHI', 'WIN'),
        pick('g3', 'KC', 'WIN'),
        pick('g4', 'BUF', 'LOSS')
      ],
      games
    );

    expect(rows.map(r => r.teamId)).toEqual(['PHI', 'KC', 'BUF']);
  });

  it('drops a pick whose game is missing rather than guessing a side', () => {
    expect(computeTeamAffinity([pick('ghost', 'PHI', 'WIN')], [])).toEqual([]);
  });
});
