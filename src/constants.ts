import type { Team } from './types';

/**
 * Season configuration.
 *
 * Unlike the NHL app — where a "week" is a Saturday date and the season is
 * bounded by two dates — the NFL has canonical weeks 1..18, exactly seven days
 * apart. That means the entire calendar is derivable from a single anchor: the
 * Sunday of Week 1. Every deadline, every segment boundary, and every week id
 * follows from it.
 *
 * UPDATE THESE EVERY SEASON. `SEASON_WEEK1_SUNDAY` is mirrored in
 * `supabase/migrations/0001_init.sql` as `season_week1_sunday()`, because the
 * database derives the final lock rather than trusting the client with it. If
 * you change one, change both — there is a test that will not catch it, since
 * the test cannot see the database.
 */
export const SEASON = 2026;

/**
 * Sunday of Week 1, YYYY-MM-DD.
 *
 * 2026: the season opens Wednesday 9 Sep (NE @ SEA, 20:20 ET), there is a
 * second game Thursday 10 Sep, and the first Sunday slate is 13 Sep. Confirmed
 * against the published ESPN schedule, which is what this anchor has to agree
 * with — note it is the SUNDAY that anchors the calendar, not the opener.
 *
 * One consequence worth knowing: the week rolls over Tuesday 18:00 ET, so in
 * 2026 the Week 1 sheet is open for about 26 hours before its first game locks.
 * That is the tightest window of the season.
 */
export const SEASON_WEEK1_SUNDAY = '2026-09-13';

/** NFL regular season length. 18 weeks since 2021. */
export const WEEK_COUNT = 18;

/** Picks per week: four ordinary and one bonus. */
export const PICKS_PER_WEEK = 5;

/**
 * What a pick is worth.
 *
 * Four games at 1 point and one at 3 — see 'Rules of the pool' in CLAUDE.md.
 * These are the only two values `picks.confidence` may hold, and the database
 * says so three times over in 0001_init.sql: the CHECK on the column, the
 * picks_one_bonus_per_week partial index, and the picks_enforce_sheet_shape
 * trigger.
 *
 * The column is still called `confidence` because that is still what it means
 * — which game you like most — even though it now carries the point value
 * directly rather than a 1..5 rank.
 */
export const ORDINARY_POINTS = 1;
export const BONUS_POINTS = 3;

/** How many of the week's picks carry BONUS_POINTS. */
export const BONUS_PICKS_PER_WEEK = 1;

/** ...and therefore how many carry ORDINARY_POINTS. */
export const ORDINARY_PICKS_PER_WEEK = PICKS_PER_WEEK - BONUS_PICKS_PER_WEEK;

/** Label shown for the whole-season view, alongside the three segments. */
export const FULL_SEASON_LABEL = 'Full Season';

/**
 * The 32 NFL teams, keyed by the abbreviation ESPN uses in its scoreboard feed.
 *
 * `logoColor` is each club's primary colour. These are the one place raw hex is
 * correct rather than a design token — they belong to the teams, not to us, and
 * must not shift when the app's brand ramp does.
 *
 * ESPN abbreviation gotchas, all load-bearing: Washington is WSH (not WAS),
 * the Rams are LAR and the Chargers LAC (both distinct from LA), and
 * Jacksonville is JAX (not JAC).
 */
export const TEAMS: Record<string, Team> = {
  // AFC East
  BUF: { id: 'BUF', name: 'Bills', abbreviation: 'BUF', city: 'Buffalo', conference: 'AFC', division: 'East', logoColor: '#00338D' },
  MIA: { id: 'MIA', name: 'Dolphins', abbreviation: 'MIA', city: 'Miami', conference: 'AFC', division: 'East', logoColor: '#008E97' },
  NE: { id: 'NE', name: 'Patriots', abbreviation: 'NE', city: 'New England', conference: 'AFC', division: 'East', logoColor: '#002244' },
  NYJ: { id: 'NYJ', name: 'Jets', abbreviation: 'NYJ', city: 'New York', conference: 'AFC', division: 'East', logoColor: '#125740' },

  // AFC North
  BAL: { id: 'BAL', name: 'Ravens', abbreviation: 'BAL', city: 'Baltimore', conference: 'AFC', division: 'North', logoColor: '#241773' },
  CIN: { id: 'CIN', name: 'Bengals', abbreviation: 'CIN', city: 'Cincinnati', conference: 'AFC', division: 'North', logoColor: '#FB4F14' },
  CLE: { id: 'CLE', name: 'Browns', abbreviation: 'CLE', city: 'Cleveland', conference: 'AFC', division: 'North', logoColor: '#311D00' },
  PIT: { id: 'PIT', name: 'Steelers', abbreviation: 'PIT', city: 'Pittsburgh', conference: 'AFC', division: 'North', logoColor: '#FFB612' },

  // AFC South
  HOU: { id: 'HOU', name: 'Texans', abbreviation: 'HOU', city: 'Houston', conference: 'AFC', division: 'South', logoColor: '#03202F' },
  IND: { id: 'IND', name: 'Colts', abbreviation: 'IND', city: 'Indianapolis', conference: 'AFC', division: 'South', logoColor: '#002C5F' },
  JAX: { id: 'JAX', name: 'Jaguars', abbreviation: 'JAX', city: 'Jacksonville', conference: 'AFC', division: 'South', logoColor: '#006778' },
  TEN: { id: 'TEN', name: 'Titans', abbreviation: 'TEN', city: 'Tennessee', conference: 'AFC', division: 'South', logoColor: '#0C2340' },

  // AFC West
  DEN: { id: 'DEN', name: 'Broncos', abbreviation: 'DEN', city: 'Denver', conference: 'AFC', division: 'West', logoColor: '#FB4F14' },
  KC: { id: 'KC', name: 'Chiefs', abbreviation: 'KC', city: 'Kansas City', conference: 'AFC', division: 'West', logoColor: '#E31837' },
  LV: { id: 'LV', name: 'Raiders', abbreviation: 'LV', city: 'Las Vegas', conference: 'AFC', division: 'West', logoColor: '#000000' },
  LAC: { id: 'LAC', name: 'Chargers', abbreviation: 'LAC', city: 'Los Angeles', conference: 'AFC', division: 'West', logoColor: '#0080C6' },

  // NFC East
  DAL: { id: 'DAL', name: 'Cowboys', abbreviation: 'DAL', city: 'Dallas', conference: 'NFC', division: 'East', logoColor: '#003594' },
  NYG: { id: 'NYG', name: 'Giants', abbreviation: 'NYG', city: 'New York', conference: 'NFC', division: 'East', logoColor: '#0B2265' },
  PHI: { id: 'PHI', name: 'Eagles', abbreviation: 'PHI', city: 'Philadelphia', conference: 'NFC', division: 'East', logoColor: '#004C54' },
  WSH: { id: 'WSH', name: 'Commanders', abbreviation: 'WSH', city: 'Washington', conference: 'NFC', division: 'East', logoColor: '#5A1414' },

  // NFC North
  CHI: { id: 'CHI', name: 'Bears', abbreviation: 'CHI', city: 'Chicago', conference: 'NFC', division: 'North', logoColor: '#0B162A' },
  DET: { id: 'DET', name: 'Lions', abbreviation: 'DET', city: 'Detroit', conference: 'NFC', division: 'North', logoColor: '#0076B6' },
  GB: { id: 'GB', name: 'Packers', abbreviation: 'GB', city: 'Green Bay', conference: 'NFC', division: 'North', logoColor: '#203731' },
  MIN: { id: 'MIN', name: 'Vikings', abbreviation: 'MIN', city: 'Minnesota', conference: 'NFC', division: 'North', logoColor: '#4F2683' },

  // NFC South
  ATL: { id: 'ATL', name: 'Falcons', abbreviation: 'ATL', city: 'Atlanta', conference: 'NFC', division: 'South', logoColor: '#A71930' },
  CAR: { id: 'CAR', name: 'Panthers', abbreviation: 'CAR', city: 'Carolina', conference: 'NFC', division: 'South', logoColor: '#0085CA' },
  NO: { id: 'NO', name: 'Saints', abbreviation: 'NO', city: 'New Orleans', conference: 'NFC', division: 'South', logoColor: '#D3BC8D' },
  TB: { id: 'TB', name: 'Buccaneers', abbreviation: 'TB', city: 'Tampa Bay', conference: 'NFC', division: 'South', logoColor: '#D50A0A' },

  // NFC West
  ARI: { id: 'ARI', name: 'Cardinals', abbreviation: 'ARI', city: 'Arizona', conference: 'NFC', division: 'West', logoColor: '#97233F' },
  LAR: { id: 'LAR', name: 'Rams', abbreviation: 'LAR', city: 'Los Angeles', conference: 'NFC', division: 'West', logoColor: '#003594' },
  SF: { id: 'SF', name: '49ers', abbreviation: 'SF', city: 'San Francisco', conference: 'NFC', division: 'West', logoColor: '#AA0000' },
  SEA: { id: 'SEA', name: 'Seahawks', abbreviation: 'SEA', city: 'Seattle', conference: 'NFC', division: 'West', logoColor: '#002244' }
};
