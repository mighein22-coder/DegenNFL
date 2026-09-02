import { describe, expect, it } from 'vitest';
import { summarizeSheet } from '../sheet';
import { BONUS_POINTS, ORDINARY_POINTS } from '../../constants';
import { getFinalLockAt } from '../timezone';
import type { Game, Pick } from '../../types';

/**
 * The dashboard's summary of a member's week.
 *
 * These assertions are all about the states that are NOT the happy path — a
 * half-locked sheet, a week whose schedule has not been captured, a bonus spent
 * on a game that has already kicked off. Getting those right is the whole
 * reason the derivation is a function rather than a few booleans in a view.
 *
 * Week 1 of 2026 is Sunday 13 September, so the final lock is 13 Sep 13:00 ET
 * (17:00 UTC, EDT). Every instant below is chosen relative to that.
 */

const WEEK = 1;

function game(id: string, startTime: string, spread: number = -3.5): Game {
  return {
    id,
    weekId: 'week-2026-01',
    homeTeamId: 'PHI',
    awayTeamId: 'DAL',
    startTime,
    status: 'SCHEDULED',
    spread
  };
}

function pick(gameId: string, confidence: number = ORDINARY_POINTS): Pick {
  return {
    userId: 'me',
    weekId: 'week-2026-01',
    gameId,
    selectedTeamId: 'PHI',
    confidence,
    pointsEarned: 0,
    result: 'PENDING'
  };
}

describe('summarizeSheet', () => {
  const thursday = '2026-09-10T00:20:00Z'; // Thu night, before the Sunday lock
  const sunday = '2026-09-13T17:00:00Z'; // Sun 13:00 ET — the final lock itself
  const monday = '2026-09-15T00:15:00Z'; // MNF

  it('reports a week with no schedule as NOT_OPEN rather than empty', () => {
    const summary = summarizeSheet(WEEK, [], [], new Date('2026-09-08T12:00:00Z'));
    expect(summary.status).toBe('NOT_OPEN');
    expect(summary.nextKickoff).toBeNull();
  });

  it('is EMPTY when the week is open and nothing has been picked', () => {
    const summary = summarizeSheet(
      WEEK,
      [game('a', thursday), game('b', sunday)],
      [],
      new Date('2026-09-09T12:00:00Z')
    );
    expect(summary.status).toBe('EMPTY');
    expect(summary.remaining).toBe(5);
    expect(summary.bonusSet).toBe(false);
  });

  it('splits picks into locked and open by each game own kickoff', () => {
    const now = new Date('2026-09-11T12:00:00Z'); // after Thursday, before Sunday
    const summary = summarizeSheet(
      WEEK,
      [game('thu', thursday), game('sun', sunday)],
      [pick('thu', BONUS_POINTS), pick('sun')],
      now
    );

    expect(summary.lockedPicks.map(p => p.gameId)).toEqual(['thu']);
    expect(summary.openPicks.map(p => p.gameId)).toEqual(['sun']);
    expect(summary.picked).toBe(2);
    expect(summary.remaining).toBe(3);
    expect(summary.status).toBe('PARTIAL');
  });

  it('counts a bonus spent on an already-locked game as spent', () => {
    const summary = summarizeSheet(
      WEEK,
      [game('thu', thursday), game('sun', sunday)],
      [pick('thu', BONUS_POINTS)],
      new Date('2026-09-11T12:00:00Z')
    );
    expect(summary.bonusSet).toBe(true);
  });

  it('is COMPLETE at five picks while games remain open', () => {
    const games = ['a', 'b', 'c', 'd', 'e'].map(id => game(id, sunday));
    const picks = ['a', 'b', 'c', 'd'].map(id => pick(id));
    picks.push(pick('e', BONUS_POINTS));

    const summary = summarizeSheet(WEEK, games, picks, new Date('2026-09-11T12:00:00Z'));
    expect(summary.status).toBe('COMPLETE');
    expect(summary.remaining).toBe(0);
  });

  it('is LOCKED once the week final lock passes, even with games still to kick off', () => {
    // Monday Night Football has not kicked off, but the sheet closed on Sunday.
    const summary = summarizeSheet(
      WEEK,
      [game('mnf', monday)],
      [],
      new Date(getFinalLockAt(WEEK).getTime() + 60_000)
    );

    expect(summary.status).toBe('LOCKED');
    expect(summary.openGames).toHaveLength(0);
    expect(summary.nextKickoff).toBeNull();
  });

  it('is LOCKED when every game has kicked off, before the final lock', () => {
    // A week whose whole slate somehow sits before Sunday 13:00 ET: nothing is
    // changeable, so LOCKED, even though isWeekLocked is still false.
    const summary = summarizeSheet(
      WEEK,
      [game('thu', thursday)],
      [pick('thu')],
      new Date('2026-09-11T12:00:00Z')
    );
    expect(summary.status).toBe('LOCKED');
  });

  it('LOCKED outranks COMPLETE, and keeps the counts that tell them apart', () => {
    const games = ['a', 'b', 'c', 'd', 'e'].map(id => game(id, thursday));
    const picks = ['a', 'b', 'c', 'd', 'e'].map(id => pick(id));

    const summary = summarizeSheet(WEEK, games, picks, new Date('2026-09-11T12:00:00Z'));
    expect(summary.status).toBe('LOCKED');
    expect(summary.picked).toBe(5);
    expect(summary.remaining).toBe(0);
  });

  it('takes the earliest still-open kickoff as the next deadline', () => {
    const summary = summarizeSheet(
      WEEK,
      [game('late', monday), game('sun', sunday), game('thu', thursday)],
      [],
      new Date('2026-09-11T12:00:00Z')
    );
    // Thursday has passed; Sunday is next.
    expect(summary.nextKickoff?.toISOString()).toBe(new Date(sunday).toISOString());
  });

  it('reports games with no line separately from locked ones', () => {
    // The book had this one OFF when the week was activated. It is on the
    // sheet, it is not locked, and it still cannot be picked.
    const noLine: Game = { ...game('a', sunday), spread: undefined };

    const summary = summarizeSheet(
      WEEK,
      [noLine, game('b', sunday)],
      [],
      new Date('2026-09-11T12:00:00Z')
    );

    expect(summary.gamesWithoutLine.map(g => g.id)).toEqual(['a']);
    expect(summary.openGames).toHaveLength(2);
  });

  it('never reports a negative remaining count', () => {
    // Six picks cannot happen — the database forbids it three ways over — but
    // a negative 'still to make' would be nonsense on screen if it ever did.
    const games = ['a', 'b', 'c', 'd', 'e', 'f'].map(id => game(id, sunday));
    const picks = games.map(g => pick(g.id));

    const summary = summarizeSheet(WEEK, games, picks, new Date('2026-09-11T12:00:00Z'));
    expect(summary.remaining).toBe(0);
  });
});
