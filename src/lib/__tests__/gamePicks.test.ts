import { describe, expect, it } from 'vitest';
import { gameAvailability, summarizeGamePicks } from '../gamePicks';
import type { Profile } from '../supabase';
import type { Game, Pick } from '../../types';

/**
 * The per-game picks screen (issue #44).
 *
 * Week 1 of 2026 is Sunday 13 September, so the final lock is 13 Sep 13:00 ET
 * (17:00 UTC, EDT). A game opens to the screen when `isPickLocked` says so —
 * kickoff, or that lock if it comes first — which is the Matrix's own rule.
 */

const WEEK = 1;
const TNF = '2026-09-11T00:15:00.000Z'; // Thu 10 Sep, 20:15 ET.
const MNF = '2026-09-15T00:15:00.000Z'; // Mon 14 Sep, 20:15 ET.

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

function pick(userId: string, teamId: string, confidence = 1, gameId = 'g1'): Pick {
  return {
    userId,
    weekId: 'week-2026-01',
    gameId,
    selectedTeamId: teamId,
    confidence,
    pointsEarned: 0,
    result: 'PENDING'
  };
}

describe('gameAvailability', () => {
  it('keeps a game closed while it is unrevealed, and says when it opens', () => {
    // Wednesday, before Thursday night kicks off.
    const result = gameAvailability(WEEK, game(TNF), new Date('2026-09-09T15:00:00Z'));
    expect(result.revealed).toBe(false);
    if (!result.revealed) expect(result.label).toBe('Opens Thu 8:15 PM ET · in 1d 9h');
  });

  it('opens a Thursday game at its own kickoff, days before the Sunday lock', () => {
    const afterKickoff = new Date('2026-09-11T00:16:00Z');
    expect(gameAvailability(WEEK, game(TNF), afterKickoff).revealed).toBe(true);
    // And the Sunday game that has not kicked off is still closed that night.
    expect(gameAvailability(WEEK, game(MNF), afterKickoff).revealed).toBe(false);
  });

  it('opens every remaining game at the Sunday lock, Monday night included', () => {
    expect(gameAvailability(WEEK, game(MNF), new Date('2026-09-13T16:59:00Z')).revealed).toBe(
      false
    );
    expect(gameAvailability(WEEK, game(MNF), new Date('2026-09-13T17:00:00Z')).revealed).toBe(
      true
    );
  });

  it('names the Sunday lock, not Monday kickoff, as when a late game opens', () => {
    const result = gameAvailability(WEEK, game(MNF), new Date('2026-09-12T15:00:00Z'));
    expect(result.revealed).toBe(false);
    if (!result.revealed) expect(result.label).toMatch(/^Opens Sun 1:00 PM ET/);
  });

  it('names kickoff when the game starts before the Sunday lock', () => {
    // An international game at 9:30 ET Sunday closes before the 1 PM lock.
    const london = game('2026-09-13T13:30:00.000Z');
    const result = gameAvailability(WEEK, london, new Date('2026-09-12T15:00:00Z'));
    expect(result.revealed).toBe(false);
    if (!result.revealed) expect(result.label).toMatch(/^Opens Sun 9:30 AM ET/);
  });
});

describe('summarizeGamePicks', () => {
  const members = [
    profile('a', 'Alice'),
    profile('b', 'Bob'),
    profile('c', 'Carol'),
    profile('d', 'Dave')
  ];

  it('splits the picks into the home and away sides', () => {
    const summary = summarizeGamePicks(
      game(TNF),
      [pick('a', 'PHI'), pick('b', 'DAL'), pick('c', 'PHI')],
      members
    );
    expect(summary.home.teamId).toBe('PHI');
    expect(summary.home.picks.map(p => p.member.name)).toEqual(['Alice', 'Carol']);
    expect(summary.away.teamId).toBe('DAL');
    expect(summary.away.picks.map(p => p.member.name)).toEqual(['Bob']);
  });

  it('lists the 3-point picks first, then by name', () => {
    const summary = summarizeGamePicks(
      game(TNF),
      [pick('a', 'PHI'), pick('b', 'PHI'), pick('c', 'PHI', 3)],
      members
    );
    expect(summary.home.picks.map(p => p.member.name)).toEqual(['Carol', 'Alice', 'Bob']);
    expect(summary.home.bonusCount).toBe(1);
    expect(summary.away.bonusCount).toBe(0);
  });

  it('lists everybody with no pick on the game, by name', () => {
    const summary = summarizeGamePicks(
      game(TNF),
      [pick('c', 'PHI'), pick('a', 'DAL')],
      members
    );
    expect(summary.noPick.map(m => m.name)).toEqual(['Bob', 'Dave']);
  });

  it('ignores picks on other games', () => {
    const summary = summarizeGamePicks(
      game(TNF),
      [pick('a', 'PHI', 1, 'g2'), pick('b', 'DAL')],
      members
    );
    expect(summary.home.picks).toHaveLength(0);
    expect(summary.noPick.map(m => m.name)).toEqual(['Alice', 'Carol', 'Dave']);
  });

  it('does not count a pick for a team that is not in the game as a pick', () => {
    const summary = summarizeGamePicks(game(TNF), [pick('a', 'NYG')], members);
    expect(summary.home.picks).toHaveLength(0);
    expect(summary.away.picks).toHaveLength(0);
    expect(summary.noPick.map(m => m.name)).toContain('Alice');
  });

  it('skips a pick by someone who is not a member', () => {
    const summary = summarizeGamePicks(game(TNF), [pick('ghost', 'PHI')], members);
    expect(summary.home.picks).toHaveLength(0);
    expect(summary.noPick).toHaveLength(4);
  });
});
