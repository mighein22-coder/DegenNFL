import { describe, expect, it } from 'vitest';
import { completedWeekPicks, computeTeamAffinity } from '../affinity';
import { getWeekRolloverAt } from '../timezone';
import { BONUS_POINTS, ORDINARY_POINTS, SEASON } from '../../constants';
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
 */
describe('completedWeekPicks', () => {
  // Mid-week 2: week 1 is over, week 2 is being played.
  const midWeek2 = new Date(getWeekRolloverAt(1).getTime() + 60_000);

  function weekPick(weekNumber: number, userId: string, teamId: string): Pick {
    const weekId = `week-${SEASON}-${String(weekNumber).padStart(2, '0')}`;
    return {
      userId,
      weekId,
      gameId: `${weekId}-${teamId}`,
      selectedTeamId: teamId,
      confidence: ORDINARY_POINTS,
      pointsEarned: ORDINARY_POINTS,
      result: 'WIN'
    };
  }

  it('keeps only the named member', () => {
    const picks = [weekPick(1, 'me', 'PHI'), weekPick(1, 'you', 'DAL')];
    expect(completedWeekPicks(picks, 'me', midWeek2).map(p => p.selectedTeamId)).toEqual([
      'PHI'
    ]);
  });

  it('drops the week being played', () => {
    const picks = [weekPick(1, 'me', 'PHI'), weekPick(2, 'me', 'KC')];
    expect(completedWeekPicks(picks, 'me', midWeek2).map(p => p.selectedTeamId)).toEqual([
      'PHI'
    ]);
  });

  it('drops it for the signed-in member too — every column is measured alike', () => {
    // Same assertion as above, stated as the rule it is: there is no 'own
    // picks' exemption, because two members compared on this screen have to be
    // counted over the same weeks.
    const beforeAnyWeekEnds = new Date(getWeekRolloverAt(1).getTime() - 60_000);
    expect(completedWeekPicks([weekPick(1, 'me', 'PHI')], 'me', beforeAnyWeekEnds)).toEqual(
      []
    );
  });

  it('counts a week from the moment it rolls over, not from its Sunday lock', () => {
    const picks = [weekPick(1, 'me', 'PHI')];
    expect(completedWeekPicks(picks, 'me', getWeekRolloverAt(1))).toHaveLength(1);
    expect(
      completedWeekPicks(picks, 'me', new Date(getWeekRolloverAt(1).getTime() - 1))
    ).toHaveLength(0);
  });

  it('drops a pick whose week id does not parse', () => {
    const orphan: Pick = { ...weekPick(1, 'me', 'PHI'), weekId: 'not-a-week' };
    expect(completedWeekPicks([orphan], 'me', midWeek2)).toEqual([]);
  });

  it('settles another season by the season, not by this season’s clock', () => {
    const last: Pick = { ...weekPick(1, 'me', 'PHI'), weekId: `week-${SEASON - 1}-18` };
    const next: Pick = { ...weekPick(1, 'me', 'DAL'), weekId: `week-${SEASON + 1}-01` };
    // Week 18 of last season is finished however early in this one it is read.
    expect(completedWeekPicks([last, next], 'me', midWeek2).map(p => p.weekId)).toEqual([
      `week-${SEASON - 1}-18`
    ]);
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
