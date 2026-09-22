import { describe, expect, it } from 'vitest';
import { completedWeekPicks, computeTeamAffinity } from '../affinity';
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

/**
 * Whose picks, and from which weeks.
 *
 * The screen offers any member, and other members' picks arrive a game at a
 * time — so the two things worth pinning down are that a week still being
 * played contributes nothing, and that the rule does not quietly exempt the
 * member doing the looking.
 *
 * A WEEK IS OVER WHEN ITS GAMES ARE, which is the fix for the bug this block
 * was rewritten for: the first cut read "completed" off the Tuesday 18:00 ET
 * rollover, so week 2 stayed invisible all the Tuesday after its Monday night
 * game had finished and been scored.
 */
describe('completedWeekPicks', () => {
  function weekGame(weekId: string, id: string, status: Game['status']): Game {
    return {
      id,
      weekId,
      homeTeamId: 'PHI',
      awayTeamId: 'DAL',
      startTime: '2026-09-13T17:00:00Z',
      status,
      homeScore: status === 'FINAL' ? 24 : undefined,
      awayScore: status === 'FINAL' ? 17 : undefined,
      spread: -3.5
    };
  }

  function weekPick(weekId: string, userId: string, gameId: string, teamId: string): Pick {
    return {
      userId,
      weekId,
      gameId,
      selectedTeamId: teamId,
      confidence: ORDINARY_POINTS,
      pointsEarned: ORDINARY_POINTS,
      result: 'WIN'
    };
  }

  // Week 1 is played out; week 2 still has a game to come.
  const games = [
    weekGame('week-2026-01', 'w1g1', 'FINAL'),
    weekGame('week-2026-01', 'w1g2', 'FINAL'),
    weekGame('week-2026-02', 'w2g1', 'FINAL'),
    weekGame('week-2026-02', 'w2g2', 'SCHEDULED')
  ];

  it('keeps only the named member', () => {
    const picks = [
      weekPick('week-2026-01', 'me', 'w1g1', 'PHI'),
      weekPick('week-2026-01', 'you', 'w1g2', 'DAL')
    ];
    expect(completedWeekPicks(picks, games, 'me').map(p => p.gameId)).toEqual(['w1g1']);
  });

  it('drops the week with a game still to play', () => {
    const picks = [
      weekPick('week-2026-01', 'me', 'w1g1', 'PHI'),
      weekPick('week-2026-02', 'me', 'w2g1', 'PHI')
    ];
    expect(completedWeekPicks(picks, games, 'me').map(p => p.gameId)).toEqual(['w1g1']);
  });

  it('counts a week the moment its last game is final — not on the Tuesday after', () => {
    // The bug: every game of week 2 is played and scored, and the pick on it
    // must count NOW. Nothing here knows what day it is, which is the point.
    const played = games.map(g =>
      g.id === 'w2g2' ? weekGame('week-2026-02', 'w2g2', 'FINAL') : g
    );
    const picks = [
      weekPick('week-2026-01', 'me', 'w1g1', 'PHI'),
      weekPick('week-2026-02', 'me', 'w2g1', 'PHI')
    ];
    expect(completedWeekPicks(picks, played, 'me')).toHaveLength(2);
  });

  it('drops it for the signed-in member too — every column is measured alike', () => {
    // There is no 'own picks' exemption: two members compared on this screen
    // have to be counted over the same weeks.
    const picks = [weekPick('week-2026-02', 'me', 'w2g1', 'PHI')];
    expect(completedWeekPicks(picks, games, 'me')).toEqual([]);
  });

  it('does not count a final game that has no score yet', () => {
    // sync-week writes status and score together and grades against both, so a
    // final game with no score is one whose picks cannot have resolved.
    const unscored = [
      { ...weekGame('week-2026-01', 'w1g1', 'FINAL'), homeScore: undefined },
      weekGame('week-2026-01', 'w1g2', 'FINAL')
    ];
    const picks = [weekPick('week-2026-01', 'me', 'w1g2', 'PHI')];
    expect(completedWeekPicks(picks, unscored, 'me')).toEqual([]);
  });

  it('does not treat a week with no games as complete', () => {
    // A week row exists days before its schedule is seeded. Nothing to be over
    // is not the same as over.
    const picks = [weekPick('week-2026-03', 'me', 'ghost', 'PHI')];
    expect(completedWeekPicks(picks, games, 'me')).toEqual([]);
  });
});

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
