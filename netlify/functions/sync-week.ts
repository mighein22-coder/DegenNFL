import type { Handler, HandlerEvent } from '@netlify/functions';
import { createClient } from '@supabase/supabase-js';
import { hookSpread, gradePick, pointsFor } from '../../src/lib/scoring';

/**
 * Netlify Function: sync-week
 *
 * Server-side score sync and pick resolution, using the service-role key. It
 * bypasses RLS entirely, which is what lets it write the columns no client can
 * touch: `games.home_score` / `away_score` / `spread`, and `picks.result` /
 * `points_earned`.
 *
 * Three jobs, in order:
 *
 *   1. FREEZE THE LINE. Once a game kicks off, whatever spread the odds feed
 *      last reported becomes that game's number, permanently. Everyone is
 *      graded against one line, and it is hooked to a half point so no pick can
 *      land on it. A game that kicks off with no line captured cannot be
 *      graded — that is reported, not guessed at.
 *   2. UPDATE SCORES for games that have finished.
 *   3. RESOLVE PICKS against the frozen line.
 *
 * POST body: { weekId: string }
 * Returns:   { gamesUpdated, linesFrozen, picksResolved, errors }
 */

interface SyncResult {
  gamesUpdated: number;
  linesFrozen: number;
  picksResolved: number;
  errors: string[];
}

const handler: Handler = async (event: HandlerEvent) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: JSON.stringify({ error: 'Method Not Allowed' }) };
  }

  const supabaseUrl = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !serviceRoleKey) {
    console.error('[SYNC WEEK] Missing env vars', {
      hasUrl: !!supabaseUrl,
      hasKey: !!serviceRoleKey
    });
    return {
      statusCode: 500,
      body: JSON.stringify({
        error: 'Server misconfiguration: missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY'
      })
    };
  }

  const admin = createClient(supabaseUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false }
  });

  // Authenticate the caller: any signed-in member will do.
  //
  // Carried over from the NHL app, where this replaced a shared secret. The
  // client half of that pair was `VITE_SYNC_WEEK_SECRET`, and Vite inlines
  // `VITE_*` into the bundle every visitor downloads — so the secret was
  // printed in public JS and this endpoint was effectively unauthenticated.
  //
  // A Supabase access token cannot be published that way: it is per-user, it
  // expires, and Supabase vouches for it. Signing a member out revokes their
  // access with no redeploy. DO NOT reintroduce a VITE_-prefixed secret here.
  //
  // Deliberately NOT gated on `profiles.role`. Scoring happens whenever any
  // member opens the app, so an admin-only gate would leave scores frozen
  // until an admin logged in. The blast radius is bounded: it takes one weekId,
  // reads a public odds/score feed, and writes only what that week already
  // implies. It cannot be steered to write anything of the caller's choosing.
  const authHeader = event.headers['authorization'] || event.headers['Authorization'];
  const token = authHeader?.replace(/^Bearer /i, '').trim();

  if (!token) {
    console.warn('[SYNC WEEK] Request with no bearer token');
    return { statusCode: 401, body: JSON.stringify({ error: 'Unauthorized' }) };
  }

  const { data: auth, error: authError } = await admin.auth.getUser(token);
  if (authError || !auth?.user) {
    console.warn('[SYNC WEEK] Rejected token:', authError?.message ?? 'no user for token');
    return { statusCode: 401, body: JSON.stringify({ error: 'Unauthorized' }) };
  }

  const result: SyncResult = {
    gamesUpdated: 0,
    linesFrozen: 0,
    picksResolved: 0,
    errors: []
  };

  try {
    const body = JSON.parse(event.body || '{}');
    const weekId: string = body.weekId;

    if (!weekId || !/^week-\d{4}-\d{2}$/.test(weekId)) {
      return {
        statusCode: 400,
        body: JSON.stringify({ error: 'weekId must be formatted week-YYYY-NN' })
      };
    }

    const { data: week, error: weekError } = await admin
      .from('weeks')
      .select('id, season, week_number, status')
      .eq('id', weekId)
      .single();

    if (weekError || !week) {
      return { statusCode: 404, body: JSON.stringify({ error: `Unknown week ${weekId}` }) };
    }

    // A COMPLETED week is finished; re-syncing it would only risk rewriting
    // settled results. (FrozenDegenerates learned this one the same way.)
    if (week.status === 'COMPLETED') {
      console.log(`[SYNC WEEK] ${weekId} already COMPLETED, nothing to do`);
      return { statusCode: 200, body: JSON.stringify(result) };
    }

    const { data: games, error: gamesError } = await admin
      .from('games')
      .select('id, espn_event_id, home_team_id, away_team_id, start_time, status, home_score, away_score, spread, spread_captured_at')
      .eq('week_id', weekId);

    if (gamesError) throw new Error(`Loading games: ${gamesError.message}`);
    if (!games?.length) {
      console.log(`[SYNC WEEK] ${weekId} has no games seeded yet`);
      return { statusCode: 200, body: JSON.stringify(result) };
    }

    // ---------------------------------------------------------------------
    // Fetch the live feed once for the whole week.
    //
    // TODO(spike): unverified response shape — see scripts/spike-espn.mjs and
    // the header of nfl-schedule.ts. Everything below this line that reads an
    // ESPN field needs reconciling against a real payload before it is trusted.
    // ---------------------------------------------------------------------
    const feedUrl =
      `https://site.api.espn.com/apis/site/v2/sports/football/nfl/scoreboard` +
      `?dates=${week.season}&seasontype=2&week=${week.week_number}`;

    const feedResponse = await fetch(feedUrl);
    if (!feedResponse.ok) {
      throw new Error(`ESPN returned status ${feedResponse.status}`);
    }
    const feed = await feedResponse.json();

    const byEventId = new Map<string, any>();
    for (const espnEvent of feed.events ?? []) {
      byEventId.set(String(espnEvent.id), espnEvent.competitions?.[0]);
    }

    const now = new Date();

    for (const game of games) {
      const competition = game.espn_event_id ? byEventId.get(game.espn_event_id) : undefined;
      if (!competition) {
        result.errors.push(`No feed entry for game ${game.id} (${game.espn_event_id})`);
        continue;
      }

      const update: Record<string, unknown> = {};

      // --- 1. Freeze the line at kickoff --------------------------------
      //
      // Only ever written once. `spread_captured_at` is the flag: a game that
      // already has one keeps its number no matter what the market does next.
      if (!game.spread_captured_at && new Date(game.start_time) <= now) {
        const raw = extractSpread(
          competition.odds?.[0],
          game.home_team_id,
          game.away_team_id
        );

        if (raw !== null) {
          update.spread = hookSpread(raw);
          update.spread_captured_at = now.toISOString();
          result.linesFrozen++;
        } else {
          // Not fatal on its own — but picks on this game cannot be graded
          // until somebody supplies a line, so it must be visible.
          result.errors.push(
            `No line available for ${game.away_team_id} @ ${game.home_team_id} at kickoff`
          );
        }
      }

      // --- 2. Scores ------------------------------------------------------
      const home = competition.competitors?.find((c: any) => c.homeAway === 'home');
      const away = competition.competitors?.find((c: any) => c.homeAway === 'away');
      const completed = competition.status?.type?.completed === true;
      const inProgress = competition.status?.type?.state === 'in';

      if (home?.score != null && away?.score != null) {
        const homeScore = Number(home.score);
        const awayScore = Number(away.score);
        const status = completed ? 'FINAL' : inProgress ? 'LIVE' : 'SCHEDULED';

        if (
          homeScore !== game.home_score ||
          awayScore !== game.away_score ||
          status !== game.status
        ) {
          update.home_score = homeScore;
          update.away_score = awayScore;
          update.status = status;
        }
      }

      if (Object.keys(update).length > 0) {
        update.updated_at = now.toISOString();
        const { error } = await admin.from('games').update(update).eq('id', game.id);
        if (error) {
          result.errors.push(`Updating game ${game.id}: ${error.message}`);
          continue;
        }
        result.gamesUpdated++;

        // Keep the in-memory row current so grading below sees this write.
        Object.assign(game, update);
      }
    }

    // ---------------------------------------------------------------------
    // 3. Resolve picks.
    //
    // Only PENDING picks on FINAL games with a frozen line. Already-scored
    // picks are never revisited: re-grading settled results is how a sync bug
    // turns into a disputed payout.
    // ---------------------------------------------------------------------
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
          result.errors.push(
            `Pick ${pick.id} names ${pick.selected_team_id}, not in this game`
          );
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

    // ---------------------------------------------------------------------
    // 4. Close the week once every game is final and every pick is scored.
    // ---------------------------------------------------------------------
    const allFinal = games.every(g => g.status === 'FINAL');
    if (allFinal && result.errors.length === 0) {
      const { count } = await admin
        .from('picks')
        .select('id', { count: 'exact', head: true })
        .eq('week_id', weekId)
        .eq('result', 'PENDING');

      if ((count ?? 0) === 0) {
        await admin.from('weeks').update({ status: 'COMPLETED' }).eq('id', weekId);
        console.log(`[SYNC WEEK] ${weekId} closed`);
      }
    }

    console.log(`[SYNC WEEK] ${weekId}`, result);
    return { statusCode: 200, body: JSON.stringify(result) };
  } catch (error: any) {
    console.error('[SYNC WEEK ERROR]', error);
    result.errors.push(error.message ?? String(error));
    return { statusCode: 500, body: JSON.stringify(result) };
  }
};

/**
 * Pulls a signed, home-relative spread out of an ESPN odds object.
 *
 * Duplicated from nfl-schedule.ts rather than shared, for now, because both
 * copies are unverified guesses at the same unknown shape — see
 * scripts/spike-espn.mjs. Once the spike settles the real shape, collapse these
 * into one module under `_shared/`. Leaving a TODO here is deliberate: sharing
 * two guesses would only make them look more trustworthy than they are.
 *
 * TODO(spike): reconcile with a real payload, then de-duplicate.
 */
function extractSpread(odds: any, homeAbbrev: string, awayAbbrev: string): number | null {
  if (!odds) return null;

  if (typeof odds.spread === 'number') return odds.spread;
  if (typeof odds.homeTeamOdds?.spread === 'number') return odds.homeTeamOdds.spread;
  if (typeof odds.awayTeamOdds?.spread === 'number') return -odds.awayTeamOdds.spread;

  if (typeof odds.details === 'string') {
    const details = odds.details.trim();
    if (/^(even|pk|pick)$/i.test(details)) return 0;

    const match = /^([A-Z]{2,4})\s+([+-]?\d+(?:\.\d+)?)$/.exec(details);
    if (match) {
      const [, abbrev, value] = match;
      const magnitude = Number(value);
      if (abbrev === homeAbbrev) return magnitude;
      if (abbrev === awayAbbrev) return -magnitude;
      console.warn(`[SYNC WEEK] Unrecognised favourite "${abbrev}" in "${details}"`);
      return null;
    }
  }

  return null;
}

export { handler };
