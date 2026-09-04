import { describe, expect, it } from 'vitest';
import {
  MAX_PLAUSIBLE_SPREAD,
  describeHookedSpread,
  findGamesWithoutLine,
  parseSpreadInput
} from '../missingLines';
import { getFinalLockAt, isPickLocked } from '../timezone';
import type { Game } from '../../types';

/**
 * The Admin panel's missing-line list.
 *
 * The assertions that matter are about the DEADLINE, not the listing. Two
 * different clocks close a pick and they disagree about which games they cover,
 * so a panel that names the wrong one sends an admin to bed on a Saturday with
 * a Sunday-night game it says is still fixable.
 *
 * Week 1 of 2026 is Sunday 13 September, so the sheet locks 13 Sep 13:00 ET —
 * 17:00 UTC, since September is EDT. Every instant below is chosen relative to
 * that, and the two late games are the interesting ones: both kick off AFTER
 * the sheet has already closed.
 */

const WEEK = 1;
const WEEK_LOCK = '2026-09-13T17:00:00.000Z'; // Sunday 13:00 ET

const THURSDAY = '2026-09-11T00:15:00.000Z'; // Thu 10 Sep 20:15 ET
const INTERNATIONAL = '2026-09-13T13:30:00.000Z'; // Sun 09:30 ET
const EARLY_SUNDAY = '2026-09-13T17:00:00.000Z'; // Sun 13:00 ET — the lock exactly
const LATE_SUNDAY = '2026-09-13T20:25:00.000Z'; // Sun 16:25 ET — after the lock
const MONDAY = '2026-09-15T00:15:00.000Z'; // Mon 14 Sep 20:15 ET

function game(
  id: string,
  away: string,
  home: string,
  startTime: string,
  spread?: number
): Game {
  return {
    id,
    weekId: 'week-2026-01',
    homeTeamId: home,
    awayTeamId: away,
    startTime,
    status: 'SCHEDULED',
    spread
  };
}

describe('findGamesWithoutLine', () => {
  it('returns only the games with no spread', () => {
    const games = [
      game('a', 'DAL', 'PHI', THURSDAY, -3.5),
      game('b', 'MIN', 'TB', LATE_SUNDAY),
      game('c', 'NYJ', 'BUF', EARLY_SUNDAY, 7.5)
    ];

    const rows = findGamesWithoutLine(games, WEEK, new Date('2026-09-09T12:00:00Z'));

    expect(rows.map(r => r.game.id)).toEqual(['b']);
    expect(rows[0].matchup).toBe('MIN @ TB');
  });

  it('is empty when every game has a line', () => {
    const games = [game('a', 'DAL', 'PHI', THURSDAY, -3.5)];
    expect(findGamesWithoutLine(games, WEEK, new Date('2026-09-09T12:00:00Z'))).toEqual([]);
  });

  it('deadlines a game on its own kickoff when that comes first', () => {
    const rows = findGamesWithoutLine(
      [game('a', 'DAL', 'PHI', THURSDAY)],
      WEEK,
      new Date('2026-09-09T12:00:00Z')
    );

    expect(rows[0].deadlineReason).toBe('KICKOFF');
    expect(rows[0].deadline.toISOString()).toBe(THURSDAY);
  });

  it('deadlines a Sunday-night or Monday game on the SHEET LOCK, hours before it kicks off', () => {
    const now = new Date('2026-09-09T12:00:00Z');
    const rows = findGamesWithoutLine(
      [game('a', 'MIN', 'TB', LATE_SUNDAY), game('b', 'KC', 'DEN', MONDAY)],
      WEEK,
      now
    );

    for (const row of rows) {
      expect(row.deadlineReason).toBe('WEEK_LOCK');
      expect(row.deadline.toISOString()).toBe(WEEK_LOCK);
      // The whole reason this case exists: the deadline is EARLIER than kickoff.
      expect(row.deadline.getTime()).toBeLessThan(row.kickoff.getTime());
      expect(row.deadline.getTime()).toBe(getFinalLockAt(WEEK).getTime());
    }
  });

  it('treats a 1:00 PM Sunday kickoff — the same instant as the lock — as its own kickoff', () => {
    const rows = findGamesWithoutLine(
      [game('a', 'NYJ', 'BUF', EARLY_SUNDAY)],
      WEEK,
      new Date('2026-09-09T12:00:00Z')
    );

    expect(rows[0].deadlineReason).toBe('KICKOFF');
    expect(rows[0].deadline.toISOString()).toBe(WEEK_LOCK);
  });

  it('orders by deadline, soonest first, not by kickoff', () => {
    const games = [
      game('mon', 'KC', 'DEN', MONDAY),
      game('intl', 'JAX', 'WSH', INTERNATIONAL),
      game('thu', 'DAL', 'PHI', THURSDAY),
      game('late', 'MIN', 'TB', LATE_SUNDAY)
    ];

    const rows = findGamesWithoutLine(games, WEEK, new Date('2026-09-09T12:00:00Z'));

    // Monday kicks off last but shares the sheet lock with the late Sunday
    // game, so the two are tied on deadline and are broken by matchup —
    // 'KC @ DEN' ahead of 'MIN @ TB'.
    expect(rows.map(r => r.game.id)).toEqual(['thu', 'intl', 'mon', 'late']);
  });

  it('agrees with isPickLocked at every instant', () => {
    const games = [
      game('thu', 'DAL', 'PHI', THURSDAY),
      game('intl', 'JAX', 'WSH', INTERNATIONAL),
      game('late', 'MIN', 'TB', LATE_SUNDAY),
      game('mon', 'KC', 'DEN', MONDAY)
    ];

    const instants = [
      '2026-09-09T12:00:00Z', // before anything
      '2026-09-11T02:00:00Z', // Thursday game under way
      '2026-09-13T14:00:00Z', // international under way, sheet still open
      '2026-09-13T18:00:00Z' // after the sheet lock
    ];

    for (const instant of instants) {
      const now = new Date(instant);
      for (const row of findGamesWithoutLine(games, WEEK, now)) {
        expect(row.locked).toBe(isPickLocked(WEEK, row.game.startTime, now));
        // ...and locked is exactly "the derived deadline has passed".
        expect(row.locked).toBe(now.getTime() >= row.deadline.getTime());
      }
    }
  });

  it('reports a passed deadline as Locked rather than a countdown', () => {
    const rows = findGamesWithoutLine(
      [game('mon', 'KC', 'DEN', MONDAY)],
      WEEK,
      // Sunday 14:00 ET: the sheet has locked, the game has not kicked off.
      new Date('2026-09-13T18:00:00Z')
    );

    expect(rows[0].locked).toBe(true);
    expect(rows[0].timeRemaining).toBe('Locked');
  });

  it('counts down to the deadline, not to kickoff', () => {
    const rows = findGamesWithoutLine(
      [game('mon', 'KC', 'DEN', MONDAY)],
      WEEK,
      new Date('2026-09-13T15:00:00Z') // two hours before the sheet lock
    );

    expect(rows[0].locked).toBe(false);
    expect(rows[0].timeRemaining).toBe('2h 0m');
  });
});

describe('parseSpreadInput', () => {
  it('hooks a whole number against the favourite', () => {
    expect(parseSpreadInput('-3')).toEqual({ ok: true, raw: -3, hooked: -3.5 });
    expect(parseSpreadInput('3')).toEqual({ ok: true, raw: 3, hooked: 3.5 });
    expect(parseSpreadInput('+7')).toEqual({ ok: true, raw: 7, hooked: 7.5 });
  });

  it('leaves a line the market already hooked alone', () => {
    expect(parseSpreadInput('-3.5')).toEqual({ ok: true, raw: -3.5, hooked: -3.5 });
    expect(parseSpreadInput('10.5')).toEqual({ ok: true, raw: 10.5, hooked: 10.5 });
  });

  it('gives a pickem to the home team, as hookSpread does', () => {
    expect(parseSpreadInput('0')).toEqual({ ok: true, raw: 0, hooked: -0.5 });
  });

  it('tolerates surrounding whitespace', () => {
    expect(parseSpreadInput('  -3  ')).toEqual({ ok: true, raw: -3, hooked: -3.5 });
  });

  it('refuses an empty box', () => {
    expect(parseSpreadInput('').ok).toBe(false);
    expect(parseSpreadInput('   ').ok).toBe(false);
  });

  it('refuses anything that is not a plain decimal', () => {
    for (const text of ['abc', '3-', '--3', '1e1', '0x10', '3,5']) {
      expect(parseSpreadInput(text).ok).toBe(false);
    }
  });

  it('refuses a quarter point', () => {
    const result = parseSpreadInput('3.25');
    expect(result.ok).toBe(false);
    expect(result.ok === false && result.message).toMatch(/whole or half/);
  });

  it('refuses a line too big to be real — the missing decimal point', () => {
    const result = parseSpreadInput('35');
    expect(result.ok).toBe(false);
    expect(result.ok === false && result.message).toMatch(/decimal point/);

    // The boundary itself is allowed; nothing past it is.
    expect(parseSpreadInput(String(MAX_PLAUSIBLE_SPREAD)).ok).toBe(true);
    expect(parseSpreadInput(String(-MAX_PLAUSIBLE_SPREAD)).ok).toBe(true);
    expect(parseSpreadInput(String(MAX_PLAUSIBLE_SPREAD + 0.5)).ok).toBe(false);
  });
});

describe('describeHookedSpread', () => {
  it('names both sides so an inverted line is visible before it is frozen', () => {
    expect(describeHookedSpread(-3.5, 'TB', 'MIN')).toBe('TB -3.5, MIN +3.5');
    expect(describeHookedSpread(7.5, 'PHI', 'DAL')).toBe('PHI +7.5, DAL -7.5');
  });

  it('shows a hooked pickem as the home team laying the half point', () => {
    expect(describeHookedSpread(-0.5, 'TB', 'MIN')).toBe('TB -0.5, MIN +0.5');
  });
});
