import type { Handler, HandlerEvent, HandlerResponse } from '@netlify/functions';
import { hookSpread } from '../../src/lib/scoring';
import { extractSpread, fetchScoreboard } from './_shared/weekLifecycle';

/**
 * Netlify Function: fetch one NFL week's schedule and its lines.
 *
 * READ-ONLY. It reports what ESPN currently says about a week so an admin can
 * look before activating it — nothing here writes to the database. Seeding the
 * schedule and freezing the lines is `activateWeek` in
 * `_shared/weekLifecycle.ts`, reached through the Tuesday cron or
 * `admin-activate-week`.
 *
 * The parsing itself lives in `_shared/weekLifecycle.ts` rather than here.
 * It used to be duplicated between this file and sync-week because both were
 * unverified guesses at the same unknown shape, and sharing two guesses would
 * only have made them look more trustworthy than they were. The spike settled
 * the shape on 2026-08-26, so there is now one copy with the evidence written
 * next to it.
 *
 * ESPN's scoreboard endpoint is undocumented and can change without notice,
 * which is why all of the parsing sits behind that one module.
 *
 * POST body: { weekNumber: number, season?: number }
 * Returns:   { games: GameSeed[], sourceUrl: string }
 */

/** Rows shaped like `games`. Snake_case to match Postgres. */
interface GameSeed {
  week_id: string;
  espn_event_id: string;
  home_team_id: string;
  away_team_id: string;
  start_time: string;
  status: 'SCHEDULED';
  /**
   * Reported for reference only. `games.spread` is not client-writable — the
   * column grants in 0001_init.sql see to that — so a caller cannot persist
   * this. Freezing the line is activation's job, under the service-role key.
   */
  spread: number | null;
}

// The explicit return type matters: without it TypeScript infers a union of the
// literal shapes returned below, and a branch that omits `headers` widens the key
// to `undefined`, which the HandlerResponse index signature rejects.
const handler: Handler = async (event: HandlerEvent): Promise<HandlerResponse> => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: JSON.stringify({ error: 'Method Not Allowed' }) };
  }

  try {
    const body = JSON.parse(event.body || '{}');
    const weekNumber = Number(body.weekNumber);
    const season = Number(body.season ?? new Date().getFullYear());

    // Validate before interpolating into the URL.
    if (!Number.isInteger(weekNumber) || weekNumber < 1 || weekNumber > 18) {
      return {
        statusCode: 400,
        body: JSON.stringify({ error: 'weekNumber must be an integer between 1 and 18' })
      };
    }
    if (!Number.isInteger(season) || season < 2020 || season > 2100) {
      return { statusCode: 400, body: JSON.stringify({ error: 'season is out of range' }) };
    }

    const weekId = `week-${season}-${String(weekNumber).padStart(2, '0')}`;
    const data = await fetchScoreboard(season, weekNumber);
    const events: any[] = data.events ?? [];

    const games: GameSeed[] = [];
    let missingLines = 0;

    for (const espnEvent of events) {
      const competition = espnEvent.competitions?.[0];
      if (!competition) continue;

      const home = competition.competitors?.find((c: any) => c.homeAway === 'home');
      const away = competition.competitors?.find((c: any) => c.homeAway === 'away');

      const homeAbbrev: string | undefined = home?.team?.abbreviation;
      const awayAbbrev: string | undefined = away?.team?.abbreviation;

      if (!homeAbbrev || !awayAbbrev) {
        console.warn(`[NFL SCHEDULE] Event ${espnEvent.id} has no identifiable teams`);
        continue;
      }

      const raw = extractSpread(competition.odds?.[0], homeAbbrev, awayAbbrev);
      if (raw === null) missingLines++;

      games.push({
        week_id: weekId,
        espn_event_id: String(espnEvent.id),
        home_team_id: homeAbbrev,
        away_team_id: awayAbbrev,
        start_time: espnEvent.date,
        status: 'SCHEDULED',
        // Hooked here so the preview shows the number the pool would actually
        // be graded against — never the raw market line.
        spread: raw === null ? null : hookSpread(raw)
      });
    }

    console.log(
      `[NFL SCHEDULE] ${weekId}: ${games.length} games, ${missingLines} without a line`
    );

    return {
      statusCode: 200,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*'
      },
      body: JSON.stringify({
        games,
        sourceUrl: `https://www.espn.com/nfl/schedule/_/week/${weekNumber}/year/${season}`
      })
    };
  } catch (error: any) {
    console.error('[NFL SCHEDULE ERROR]', error);
    return {
      statusCode: 500,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: error.message || 'Failed to fetch NFL schedule' })
    };
  }
};

export { handler };
