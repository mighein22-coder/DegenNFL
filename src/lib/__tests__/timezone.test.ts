import { describe, it, expect } from 'vitest';
import {
  getWeekSunday,
  getFinalLockAt,
  isWeekLocked,
  isGameLocked,
  isPickLocked,
  getCurrentWeekNumber,
  getWeekRolloverAt,
  buildWeekId,
  parseWeekId,
  formatETTime,
  getTimeUntil
} from '../timezone';
import { SEASON_WEEK1_SUNDAY, WEEK_COUNT } from '../../constants';

describe('getWeekSunday', () => {
  it('returns the configured anchor for week 1', () => {
    expect(getWeekSunday(1)).toBe(SEASON_WEEK1_SUNDAY);
  });

  it('advances exactly seven days per week', () => {
    expect(getWeekSunday(2)).toBe('2026-09-20');
    expect(getWeekSunday(5)).toBe('2026-10-11');
  });

  it('crosses the year boundary without drifting', () => {
    // Week 18 is 17 weeks (119 days) after 2026-09-13.
    expect(getWeekSunday(18)).toBe('2027-01-10');
  });

  it('lands on a Sunday for every week of the season', () => {
    for (let w = 1; w <= WEEK_COUNT; w++) {
      const date = new Date(`${getWeekSunday(w)}T12:00:00Z`);
      expect(date.getUTCDay()).toBe(0);
    }
  });

  it('rejects a week number outside the season', () => {
    expect(() => getWeekSunday(0)).toThrow();
    expect(() => getWeekSunday(19)).toThrow();
    expect(() => getWeekSunday(1.5)).toThrow();
  });
});

describe('getFinalLockAt', () => {
  it('is 13:00 ET, which is 17:00 UTC during daylight time', () => {
    // Mid-September is EDT (UTC-4).
    expect(getFinalLockAt(1).toISOString()).toBe('2026-09-13T17:00:00.000Z');
  });

  it('is 13:00 ET, which is 18:00 UTC after the DST change', () => {
    // DST ends 2026-11-01, so week 9 (2026-11-08) is EST (UTC-5).
    expect(getWeekSunday(9)).toBe('2026-11-08');
    expect(getFinalLockAt(9).toISOString()).toBe('2026-11-08T18:00:00.000Z');
  });

  it('stays 13:00 ET across the whole season, DST change included', () => {
    for (let w = 1; w <= WEEK_COUNT; w++) {
      expect(formatETTime(getFinalLockAt(w), 'HH:mm')).toBe('13:00');
    }
  });
});

describe('isWeekLocked', () => {
  it('is open a minute before the deadline and locked a minute after', () => {
    const lock = getFinalLockAt(3);
    expect(isWeekLocked(3, new Date(lock.getTime() - 60_000))).toBe(false);
    expect(isWeekLocked(3, new Date(lock.getTime() + 60_000))).toBe(true);
  });
});

describe('isGameLocked', () => {
  it('locks a game at its own kickoff', () => {
    const kickoff = '2026-09-17T00:15:00.000Z'; // Thursday night
    expect(isGameLocked(kickoff, new Date('2026-09-16T23:00:00Z'))).toBe(false);
    expect(isGameLocked(kickoff, new Date('2026-09-17T00:16:00Z'))).toBe(true);
  });
});

describe('isPickLocked', () => {
  // Week 1: final lock is 2026-09-13T17:00Z.
  const sundayLateGame = '2026-09-14T00:20:00.000Z'; // Sunday Night Football

  it('locks a late Sunday game at the weekly deadline, before its kickoff', () => {
    // 15:00Z Sunday: SNF has not kicked off, but the 13:00 ET lock has not passed either.
    expect(isPickLocked(1, sundayLateGame, new Date('2026-09-13T15:00:00Z'))).toBe(false);
    // 17:30Z: still hours before SNF kicks, but the weekly deadline has passed.
    expect(isPickLocked(1, sundayLateGame, new Date('2026-09-13T17:30:00Z'))).toBe(true);
  });

  it('locks an early game at kickoff, before the weekly deadline', () => {
    // An international game kicking at 09:30 ET (13:30Z) — before the 13:00 ET lock.
    const londonGame = '2026-09-13T13:30:00.000Z';
    expect(isPickLocked(1, londonGame, new Date('2026-09-13T13:00:00Z'))).toBe(false);
    expect(isPickLocked(1, londonGame, new Date('2026-09-13T14:00:00Z'))).toBe(true);
    // ...and the weekly lock has NOT passed at that point.
    expect(isWeekLocked(1, new Date('2026-09-13T14:00:00Z'))).toBe(false);
  });

  it('locks a Thursday game days before the weekly deadline', () => {
    const tnf = '2026-09-11T00:15:00.000Z';
    expect(isPickLocked(1, tnf, new Date('2026-09-11T00:16:00Z'))).toBe(true);
    expect(isWeekLocked(1, new Date('2026-09-11T00:16:00Z'))).toBe(false);
  });
});

describe('getCurrentWeekNumber', () => {
  it('reads week 1 before the season starts', () => {
    expect(getCurrentWeekNumber(new Date('2026-08-01T12:00:00Z'))).toBe(1);
  });

  it('stays on week 1 through Monday night', () => {
    // Monday 2026-09-14, during MNF.
    expect(getCurrentWeekNumber(new Date('2026-09-15T01:00:00Z'))).toBe(1);
  });

  it('rolls to week 2 on Tuesday morning ET', () => {
    // Tuesday 2026-09-15 06:00 ET = 10:00Z.
    expect(getCurrentWeekNumber(new Date('2026-09-15T09:59:00Z'))).toBe(1);
    expect(getCurrentWeekNumber(new Date('2026-09-15T10:01:00Z'))).toBe(2);
  });

  it('clamps at the last week once the season is over', () => {
    expect(getCurrentWeekNumber(new Date('2027-06-01T12:00:00Z'))).toBe(WEEK_COUNT);
  });
});

describe('getWeekRolloverAt', () => {
  it('is the Tuesday after the week’s Sunday, at 06:00 ET', () => {
    // 2026-09-13 is the Sunday; the Tuesday is 2026-09-15, 06:00 EDT = 10:00Z.
    expect(getWeekRolloverAt(1).toISOString()).toBe('2026-09-15T10:00:00.000Z');
  });

  it('stays 06:00 ET after the DST change rather than drifting to 05:00', () => {
    // Week 9's Sunday is 2026-11-08, a week after DST ends; its Tuesday is
    // 2026-11-10, and 06:00 EST is 11:00Z (not the 10:00Z it would be on EDT).
    expect(getWeekRolloverAt(9).toISOString()).toBe('2026-11-10T11:00:00.000Z');
    for (let w = 1; w <= WEEK_COUNT; w++) {
      expect(formatETTime(getWeekRolloverAt(w), 'HH:mm')).toBe('06:00');
    }
  });

  it('falls after that week’s final lock and before the next week’s', () => {
    for (let w = 1; w < WEEK_COUNT; w++) {
      expect(getWeekRolloverAt(w).getTime()).toBeGreaterThan(getFinalLockAt(w).getTime());
      expect(getWeekRolloverAt(w).getTime()).toBeLessThan(getFinalLockAt(w + 1).getTime());
    }
  });
});

describe('week ids', () => {
  it('zero-pads the week number so ids sort lexically', () => {
    expect(buildWeekId(1)).toBe('week-2026-01');
    expect(buildWeekId(18)).toBe('week-2026-18');
    expect(buildWeekId(9) < buildWeekId(10)).toBe(true);
  });

  it('round-trips', () => {
    for (let w = 1; w <= WEEK_COUNT; w++) {
      expect(parseWeekId(buildWeekId(w))).toEqual({ season: 2026, weekNumber: w });
    }
  });

  it('rejects malformed and out-of-range ids', () => {
    expect(parseWeekId('week-2026-19')).toBeNull();
    expect(parseWeekId('week-2026-00')).toBeNull();
    expect(parseWeekId('week-2026-1')).toBeNull();
    expect(parseWeekId('week-2026-10-11')).toBeNull(); // an NHL-style id
    expect(parseWeekId('nonsense')).toBeNull();
  });
});

describe('getTimeUntil', () => {
  it('reports Locked once the moment has passed', () => {
    const t = new Date('2026-09-13T17:00:00Z');
    expect(getTimeUntil(t, new Date('2026-09-13T17:00:01Z'))).toBe('Locked');
  });

  it('reports days and hours when more than a day out', () => {
    const t = new Date('2026-09-13T17:00:00Z');
    expect(getTimeUntil(t, new Date('2026-09-11T14:00:00Z'))).toBe('2d 3h');
  });

  it('reports hours and minutes when inside a day', () => {
    const t = new Date('2026-09-13T17:00:00Z');
    expect(getTimeUntil(t, new Date('2026-09-13T14:30:00Z'))).toBe('2h 30m');
  });
});
