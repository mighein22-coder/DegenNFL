export interface User {
  id: string;
  name: string;
  email: string;
  avatar: string;
  role: 'admin' | 'member';
}

export interface Team {
  id: string;
  name: string;
  abbreviation: string;
  city: string;
  conference: 'AFC' | 'NFC';
  division: 'East' | 'North' | 'South' | 'West';
  /** The club's own primary colour. Not a design token — see constants.ts. */
  logoColor: string;
}

export interface Game {
  id: string;
  weekId: string;
  espnEventId?: string;
  homeTeamId: string;
  awayTeamId: string;
  /** ISO string. Also the moment this individual game's picks lock. */
  startTime: string;
  status: 'SCHEDULED' | 'LIVE' | 'FINAL';
  homeScore?: number;
  awayScore?: number;
  /**
   * The line, from the HOME team's point of view. Negative means home is
   * favoured: -3.5 means home must win by 4 or more to cover.
   *
   * Always ends in .5 — see `hookSpread` in lib/scoring.ts and the CHECK
   * constraint in 0001_init.sql. Null until the line has been captured.
   */
  spread?: number;
  /** When the line was frozen. After this the line never moves again. */
  spreadCapturedAt?: string;
}

export interface Pick {
  userId: string;
  weekId: string;
  gameId: string;
  selectedTeamId: string;
  /**
   * The point value of this pick: ORDINARY_POINTS (1) or BONUS_POINTS (3).
   * Four 1s and one 3 make a full week. Not a rank — see constants.ts.
   */
  confidence: number;
  /** 0 on a loss or while pending, equal to `confidence` on a win. */
  pointsEarned: number;
  /**
   * No PUSH. Spreads are hooked to a half point, so a pick can never land
   * exactly on the number — every resolved pick is a win or a loss.
   */
  result: 'WIN' | 'LOSS' | 'PENDING';
}

export interface Week {
  id: string;
  season: number;
  /** 1..WEEK_COUNT. */
  weekNumber: number;
  /** Sunday 13:00 ET of this week — the whole-sheet deadline, ISO string. */
  finalLockAt: string;
  status: 'OPEN' | 'LOCKED' | 'COMPLETED';
}

export interface Segment {
  number: number;
  label: string;
  /** First week number of the segment. */
  startWeek: number;
  /** Last week number of the segment. */
  endWeek: number;
  weekCount: number;
}

export interface StandingsRow {
  userId: string;
  name: string;
  avatar: string;
  /**
   * Points for the selected scope — a single segment, or the whole season when
   * no segment is selected. This drives the rank.
   */
  totalPoints: number;
  /** Cumulative season points, shown alongside for reference in every scope. */
  seasonPoints: number;
  /** Wins and losses for the selected scope. */
  wins: number;
  losses: number;
  weeklyScore: number;
  rank: number;
}
