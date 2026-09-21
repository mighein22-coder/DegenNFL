import { describe, expect, it } from 'vitest';
import { matrixColumnStatus } from '../matrixColumn';
import type { Game } from '../../types';

/**
 * The League Matrix column header.
 *
 * Week 1 of 2026 is Sunday 13 September, so the final lock is 13 Sep 13:00 ET
 * (17:00 UTC, EDT). Every instant below is chosen relative to that, and the
 * game that matters most is Monday night — the one issue #29 was reported
 * against, which sat at "hidden" all Monday morning while its picks were
 * already on screen underneath it.
 */

const WEEK = 1;
const MNF = '2026-09-15T00:15:00.000Z'; // Mon 14 Sep, 20:15 ET.
const TNF = '2026-09-11T00:15:00.000Z'; // Thu 10 Sep, 20:15 ET.

function game(startTime: string, overrides: Partial<Game> = {}): Game {
  return {
    id: 'g1',
    weekId: 'week-2026-01',
    homeTeamId: 'PHI',
    awayTeamId: 'DAL',
    startTime,
    status: 'SCHEDULED',
    spread: -3.5,
    ...overrides
  };
}

describe('matrixColumnStatus', () => {
  it('hides a game that has not kicked off while the week is still open', () => {
    // Saturday: nothing has locked, so Monday night is genuinely secret.
    const status = matrixColumnStatus(WEEK, game(MNF), new Date('2026-09-12T15:00:00Z'));
    expect(status.state).toBe('HIDDEN');
    expect(status.label).toMatch(/^hidden · /);
  });

  it('stops saying hidden once the Sunday lock has passed — issue #29', () => {
    // Monday morning, the reported case: MNF is still 12 hours out, but the
    // 13:00 ET Sunday lock revealed every remaining pick the day before.
    const status = matrixColumnStatus(WEEK, game(MNF), new Date('2026-09-14T12:00:00Z'));
    expect(status.state).toBe('REVEALED');
    expect(status.label).not.toMatch(/hidden/);
    expect(status.label).toBe('in 12h 15m');
  });

  it('counts down in days when the game is more than a day out', () => {
    // Sunday evening, after the lock: MNF is a day and change away.
    const status = matrixColumnStatus(WEEK, game(MNF), new Date('2026-09-13T21:00:00Z'));
    expect(status.state).toBe('REVEALED');
    expect(status.label).toBe('in 1d 3h');
  });

  it('shows the kickoff time once a game has started', () => {
    const status = matrixColumnStatus(WEEK, game(TNF), new Date('2026-09-11T01:00:00Z'));
    expect(status.state).toBe('PLAYED');
    expect(status.label).toBe('Thu 8:15 PM');
  });

  it('shows the score once a game is final', () => {
    const final = game(TNF, { status: 'FINAL', homeScore: 24, awayScore: 17 });
    const status = matrixColumnStatus(WEEK, final, new Date('2026-09-11T04:00:00Z'));
    expect(status.state).toBe('SCORE');
    expect(status.label).toBe('17–24');
  });

  it('falls back to the kickoff time when a FINAL game has no score yet', () => {
    // The ingest marks a game FINAL before the scores land often enough that
    // rendering "undefined–undefined" was a real possibility.
    const final = game(TNF, { status: 'FINAL' });
    expect(matrixColumnStatus(WEEK, final, new Date('2026-09-11T04:00:00Z')).state).toBe(
      'PLAYED'
    );
  });

  it('still hides an early game that has not kicked off before the Sunday lock', () => {
    // A London game kicking 09:30 ET is open, and hidden, right up to its own
    // kickoff — the per-game rule, unaffected by the week's deadline.
    const london = game('2026-09-13T13:30:00.000Z');
    expect(matrixColumnStatus(WEEK, london, new Date('2026-09-13T12:00:00Z')).state).toBe(
      'HIDDEN'
    );
    expect(matrixColumnStatus(WEEK, london, new Date('2026-09-13T14:00:00Z')).state).toBe(
      'PLAYED'
    );
  });
});
