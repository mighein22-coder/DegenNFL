import type { SupabaseClient } from '@supabase/supabase-js';
import { hookSpread, gradePick, pointsFor, buildWeekId } from './etTime';

/**
 * The week's life cycle, in one module, under the service-role key.
 *
 * Two things happen to a week, and both of them write columns no client may
 * touch (`games.spread`, `games.home_score` / `away_score`, `picks.result` /
 * `points_earned`):
 *
 *   ACTIVATION, once, on the Tuesday the week opens. The schedule is seeded and
 *   every line is captured, hooked and frozen. This is the only moment a spread
 *   is ever written by the app.
 *
 *   SYNC, repeatedly, for the rest of the week. Scores land and picks are
 *   graded against the already-frozen line.
 *
 * Both are here rather than inside a handler because each has two callers: the
 * Tuesday cron (weekly-rollover) and an admin button (admin-activate-week) both
 * activate, and the cron and every member page load both sync. Two copies of
 * this logic is how the NHL app ended up with a sync that could disagree with
 * itself.
 *
 * WHY ACTIVATION CAPTURES THE LINE, AND KICKOFF NO LONGER DOES
 *
 * This function used to freeze each line at that game's kickoff. A spike
 * against the real feed on 2026-08-26 showed why that could not work: ESPN
 * carries odds on scheduled games (48 of 48 across 2026 weeks 1-3, a year out)
 * and drops the `odds` array entirely once a game is FINAL (0 of 64 sampled
 * across four completed weeks). Waiting for kickoff meant racing the feed for
 * the number, and mostly losing it — leaving games that could never be graded.
 *
 * Capturing on Tuesday, while every game in the week is still SCHEDULED, is on
 * the safe side of that boundary by days rather than seconds.
 */

const ESPN_SCOREBOARD_BASE =
  'https://site.api.espn.com/apis/site/v2/sports/football/nfl/scoreboard';

/** seasontype=2 is the regular season (1 = pre, 3 = post). */
export async function fetchScoreboard(season: number, weekNumber: number): Promise<any> {
  const url = `${ESPN_SCOREBOARD_BASE}?dates=${season}&seasontype=2&week=${weekNumber}`;
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`ESPN returned status ${response.status} for ${url}`);
  }
  return response.json();
}

/**
 * Pulls a signed, home-relative spread out of an ESPN odds object.
 *
 * VERIFIED against the live feed (2026 weeks 1-3, 48 games with odds). The
 * previously-unknown question was the sign convention, and the answer is that
 * `odds[0].spread` is already **home-relative**, exactly as `games.spread` is
 * defined: negative means the home team is favoured.
 *
 * The case that would have inverted silently is an away favourite, so it was
 * checked directly across all 14 of them. For example `BAL @ IND` reports
 * `details: "BAL -3.5"` alongside `spread: 3.5` — the string names the
 * favourite, the number is from Indianapolis's point of view. Taking the number
 * and ignoring the string is therefore correct, and is what happens below.
 *
 * The `details` branch survives only as a fallback for a payload that carries
 * the string without the number. It resolves the abbreviation to a side before
 * trusting the sign, because on its own the string means the opposite thing for
 * half the league.
 *
 * Returns null when there is no line to be had — a real state, not an error.
 * A book that has not opened a game reports `pointSpread.line: "OFF"` with no
 * `spread` and no `details` at all (2026 week 3 MIN @ TB did exactly this).
 * Such a game is seeded with a null spread, is unpickable until an admin sets
 * one with `admin_set_spread`, and is reported by name to the caller.
 */
export function extractSpread(
  odds: any,
  homeAbbrev: string,
  awayAbbrev: string
): number | null {
  if (!odds) return null;

  // The branch that actually fires. Home-relative already.
  if (typeof odds.spread === 'number') return odds.spread;

  // Per-team odds objects, if a payload ever carries them instead.
  if (typeof odds.homeTeamOdds?.spread === 'number') return odds.homeTeamOdds.spread;
  if (typeof odds.awayTeamOdds?.spread === 'number') return -odds.awayTeamOdds.spread;

  // Fallback: the "ABBR -3.5" string, which names the FAVOURITE rather than the
  // home team, so the sign must be flipped when the favourite is the away side.
  if (typeof odds.details === 'string') {
    const details = odds.details.trim();
    if (/^(even|pk|pick)$/i.test(details)) return 0;

    const match = /^([A-Z]{2,4})\s+([+-]?\d+(?:\.\d+)?)$/.exec(details);
    if (match) {
      const [, abbrev, value] = match;
      const magnitude = Number(value);
      if (abbrev === homeAbbrev) return magnitude;
      if (abbrev === awayAbbrev) return -magnitude;

      // An abbreviation matching neither side means our team map and ESPN's
      // disagree. Returning null loses the line; returning a guess loses money.
      console.warn(`[WEEK LIFECYCLE] Unrecognised favourite "${abbrev}" in "${details}"`);
      return null;
    }
  }

  return null;
}

export interface ActivationResult {
  weekId: string;
  gamesSeeded: number;
  linesFrozen: number;
  /** "BAL @ IND" for each game that opened without a line. Needs an admin. */
  gamesWithoutLine: string[];
  errors: string[];
}

/**
 * Open a week: create its row, seed its schedule, freeze every line.
 *
 * Idempotent by construction, because it is triggered by a clock and clocks
 * fire twice. A game that already has a spread is never touched — that is the
 * "frozen for the week" guarantee, and it is also what makes a re-run a no-op.
 */
export async function activateWeek(
  admin: SupabaseClient,
  season: number,
  weekNumber: number
): Promise<ActivationResult> {
  const weekId = buildWeekId(weekNumber, season);
  const result: ActivationResult = {
    weekId,
    gamesSeeded: 0,
    linesFrozen: 0,
    gamesWithoutLine: [],
    errors: []
  };

  // 1. The week row. Only the id is supplied; `weeks_derive_from_id` computes
  //    season, week_number and final_lock_at, so there is nothing to forge even
  //    here where we hold the service-role key.
  const { error: weekError } = await admin
    .from('weeks')
    .upsert({ id: weekId }, { onConflict: 'id', ignoreDuplicates: true });

  if (weekError) throw new Error(`Creating week ${weekId}: ${weekError.message}`);

  // 2. The schedule.
  const feed = await fetchScoreboard(season, weekNumber);
  const events: any[] = feed.events ?? [];

  const byEventId = new Map<string, any>();
  const seeds: Record<string, unknown>[] = [];

  for (const espnEvent of events) {
    const competition = espnEvent.competitions?.[0];
    if (!competition) continue;

    const home = competition.competitors?.find((c: any) => c.homeAway === 'home');
    const away = competition.competitors?.find((c: any) => c.homeAway === 'away');
    const homeAbbrev: string | undefined = home?.team?.abbreviation;
    const awayAbbrev: string | undefined = away?.team?.abbreviation;

    if (!homeAbbrev || !awayAbbrev) {
      result.errors.push(`Event ${espnEvent.id} has no identifiable teams`);
      continue;
    }

    byEventId.set(String(espnEvent.id), competition);
    seeds.push({
      week_id: weekId,
      espn_event_id: String(espnEvent.id),
      home_team_id: homeAbbrev,
      away_team_id: awayAbbrev,
      start_time: espnEvent.date
    });
  }

  if (seeds.length === 0) {
    result.errors.push(`ESPN returned no usable games for ${weekId}`);
    return result;
  }

  const { error: seedError } = await admin
    .from('games')
    .upsert(seeds, { onConflict: 'week_id,espn_event_id', ignoreDuplicates: true });

  if (seedError) throw new Error(`Seeding games for ${weekId}: ${seedError.message}`);
  result.gamesSeeded = seeds.length;

  // 3. The lines. Re-read rather than trusting the upsert, so a re-run sees the
  //    spreads a previous run already froze and leaves them alone.
  const { data: games, error: gamesError } = await admin
    .from('games')
    .select('id, espn_event_id, home_team_id, away_team_id, spread')
    .eq('week_id', weekId);

  if (gamesError) throw new Error(`Loading games for ${weekId}: ${gamesError.message}`);

  const capturedAt = new Date().toISOString();

  for (const game of games ?? []) {
    if (game.spread != null) continue; // already frozen; never re-price

    const competition = game.espn_event_id ? byEventId.get(game.espn_event_id) : undefined;
    const matchup = `${game.away_team_id} @ ${game.home_team_id}`;

    const raw = competition
      ? extractSpread(competition.odds?.[0], game.home_team_id, game.away_team_id)
      : null;

    if (raw === null) {
      // Not fatal. The game is seeded and visible; game_has_line() keeps it
      // unpickable until an admin supplies a number.
      result.gamesWithoutLine.push(matchup);
      continue;
    }

    const { error } = await admin
      .from('games')
      .update({
        spread: hookSpread(raw),
        spread_captured_at: capturedAt,
        updated_at: capturedAt
      })
      .eq('id', game.id)
      .is('spread', null); // never overwrite a line another run just froze

    if (error) {
      result.errors.push(`Freezing line for ${matchup}: ${error.message}`);
      continue;
    }
    result.linesFrozen++;
  }

  console.log(`[ACTIVATE WEEK] ${weekId}`, result);
  return result;
}

export interface SyncResult {
  gamesUpdated: number;
  picksResolved: number;
  closed: boolean;
  errors: string[];
}

/**
 * Land scores and grade picks for a week that is already activated.
 *
 * Called on every member page load as well as by the Tuesday cron, because a
 * week that is locked but not finished still needs Thursday's and Sunday's
 * results appearing as members check in — grading cannot wait for Tuesday.
 *
 * Notably it does NOT touch `games.spread`. Lines are activation's business.
 */
export async function syncAndGradeWeek(
  admin: SupabaseClient,
  weekId: string
): Promise<SyncResult> {
  const result: SyncResult = { gamesUpdated: 0, picksResolved: 0, closed: false, errors: [] };

  const { data: week, error: weekError } = await admin
    .from('weeks')
    .select('id, season, week_number, status')
    .eq('id', weekId)
    .single();

  if (weekError || !week) throw new Error(`Unknown week ${weekId}`);

  // A COMPLETED week is finished; re-syncing it would only risk rewriting
  // settled results. (FrozenDegenerates learned this one the same way.)
  if (week.status === 'COMPLETED') {
    console.log(`[SYNC WEEK] ${weekId} already COMPLETED, nothing to do`);
    result.closed = true;
    return result;
  }

  const { data: games, error: gamesError } = await admin
    .from('games')
    .select('id, espn_event_id, home_team_id, away_team_id, start_time, status, home_score, away_score, spread')
    .eq('week_id', weekId);

  if (gamesError) throw new Error(`Loading games: ${gamesError.message}`);
  if (!games?.length) {
    console.log(`[SYNC WEEK] ${weekId} has no games seeded yet`);
    return result;
  }

  const feed = await fetchScoreboard(week.season, week.week_number);
  const byEventId = new Map<string, any>();
  for (const espnEvent of feed.events ?? []) {
    byEventId.set(String(espnEvent.id), espnEvent.competitions?.[0]);
  }

  const now = new Date();

  // 1. Scores.
  for (const game of games) {
    const competition = game.espn_event_id ? byEventId.get(game.espn_event_id) : undefined;
    if (!competition) {
      result.errors.push(`No feed entry for game ${game.id} (${game.espn_event_id})`);
      continue;
    }

    const home = competition.competitors?.find((c: any) => c.homeAway === 'home');
    const away = competition.competitors?.find((c: any) => c.homeAway === 'away');
    const completed = competition.status?.type?.completed === true;
    const inProgress = competition.status?.type?.state === 'in';

    if (home?.score == null || away?.score == null) continue;

    const homeScore = Number(home.score);
    const awayScore = Number(away.score);
    const status = completed ? 'FINAL' : inProgress ? 'LIVE' : 'SCHEDULED';

    if (
      homeScore === game.home_score &&
      awayScore === game.away_score &&
      status === game.status
    ) {
      continue;
    }

    const update = {
      home_score: homeScore,
      away_score: awayScore,
      status,
      updated_at: now.toISOString()
    };

    const { error } = await admin.from('games').update(update).eq('id', game.id);
    if (error) {
      result.errors.push(`Updating game ${game.id}: ${error.message}`);
      continue;
    }
    result.gamesUpdated++;

    // Keep the in-memory row current so grading below sees this write.
    Object.assign(game, update);
  }

  // 2. Resolve picks. Only PENDING picks on FINAL games with a frozen line.
  //    Already-scored picks are never revisited: re-grading settled results is
  //    how a sync bug turns into a disputed payout.
  const gradable = games.filter(
    g => g.status === 'FINAL' && g.spread != null && g.home_score != null && g.away_score != null
  );

  if (gradable.length > 0) {
    const { data: picks, error: picksError } = await admin
      .from('picks')
      .select('id, game_id, selected_team_id, confidence')
      .eq('week_id', weekId)
      .eq('result', 'PENDING')
      .in('game_id', gradable.map(g => g.id));

    if (picksError) throw new Error(`Loading picks: ${picksError.message}`);

    const gameById = new Map(gradable.map(g => [g.id, g]));

    for (const pick of picks ?? []) {
      const game = gameById.get(pick.game_id);
      if (!game) continue;

      const selectedIsHome = pick.selected_team_id === game.home_team_id;
      if (!selectedIsHome && pick.selected_team_id !== game.away_team_id) {
        // The pick names a team not in this game. save_picks rejects that, so
        // it should be unreachable — report it rather than grading a guess.
        result.errors.push(`Pick ${pick.id} names ${pick.selected_team_id}, not in this game`);
        continue;
      }

      const outcome = gradePick(
        Number(game.home_score),
        Number(game.away_score),
        Number(game.spread),
        selectedIsHome
      );

      const { error } = await admin
        .from('picks')
        .update({
          result: outcome,
          // 1 or 3 — the pick's own point value on a win, nothing on a loss.
          points_earned: pointsFor(outcome, pick.confidence),
          updated_at: now.toISOString()
        })
        .eq('id', pick.id);

      if (error) {
        result.errors.push(`Scoring pick ${pick.id}: ${error.message}`);
        continue;
      }
      result.picksResolved++;
    }
  }

  // 3. Close the week once every game is final and every pick is scored.
  const allFinal = games.every(g => g.status === 'FINAL');
  if (allFinal && result.errors.length === 0) {
    const { count } = await admin
      .from('picks')
      .select('id', { count: 'exact', head: true })
      .eq('week_id', weekId)
      .eq('result', 'PENDING');

    if ((count ?? 0) === 0) {
      await admin.from('weeks').update({ status: 'COMPLETED' }).eq('id', weekId);
      result.closed = true;
      console.log(`[SYNC WEEK] ${weekId} closed`);
    }
  }

  console.log(`[SYNC WEEK] ${weekId}`, result);
  return result;
}
