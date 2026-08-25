import type { Handler, HandlerEvent } from '@netlify/functions';
import { hookSpread } from '../../src/lib/scoring';

/**
 * Netlify Function: fetch one NFL week's schedule (and its lines).
 *
 * ============================ STUB — READ THIS ==============================
 *
 * The ESPN parsing below is NOT verified. The session that scaffolded this repo
 * could not reach site.api.espn.com (blocked by the environment's egress
 * policy), so the response shape here is written from the endpoint's documented-
 * by-observation structure and has never been run against a real payload.
 *
 * Before trusting it, run the spike on a machine with open network access:
 *
 *     node scripts/spike-espn.mjs 8
 *     node scripts/spike-espn.mjs 8 --json > week8.json
 *
 * and reconcile every `TODO(spike)` below with what actually comes back.
 * ============================================================================
 *
 * There is no free official NFL API equivalent to the NHL one this project's
 * sibling uses, which is why this undocumented endpoint is the candidate. It
 * can change without notice — keeping all of the parsing in this one file is
 * deliberate, so the blast radius of that is one module.
 *
 * POST body: { weekNumber: number, season?: number }
 * Returns:   { games: GameSeed[], sourceUrl: string }
 */

const ESPN_BASE = 'https://site.api.espn.com/apis/site/v2/sports/football/nfl/scoreboard';

/** Rows shaped for a direct insert into `games`. Snake_case to match Postgres. */
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
   * this. Freezing the line is sync-week's job, under the service-role key.
   */
  spread: number | null;
}

/**
 * Pulls a signed, home-relative spread out of an ESPN odds object.
 *
 * TODO(spike): confirm which of these branches actually fires. They handle the
 * three shapes the endpoint is reported to use, and they disagree about sign
 * conventions, so guessing wrong inverts every favourite in the pool.
 *
 * The `details` branch is the dangerous one: "KC -3.5" names the FAVOURITE by
 * abbreviation, not the home team, so the sign has to be flipped when the
 * favourite is the away side. Verify against a game where the away team is
 * favoured before trusting it.
 */
function extractSpread(
  odds: any,
  homeAbbrev: string,
  awayAbbrev: string
): number | null {
  if (!odds) return null;

  // Shape 1: an explicit home-relative numeric spread.
  if (typeof odds.spread === 'number') {
    return odds.spread;
  }

  // Shape 2: per-team odds objects.
  if (typeof odds.homeTeamOdds?.spread === 'number') {
    return odds.homeTeamOdds.spread;
  }
  if (typeof odds.awayTeamOdds?.spread === 'number') {
    return -odds.awayTeamOdds.spread;
  }

  // Shape 3: the "ABBR -3.5" string. Pick'em is often spelled "EVEN"/"PK".
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
      console.warn(`[NFL SCHEDULE] Unrecognised favourite "${abbrev}" in "${details}"`);
      return null;
    }
  }

  return null;
}

const handler: Handler = async (event: HandlerEvent) => {
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
    // seasontype=2 is the regular season (1 = pre, 3 = post).
    const url = `${ESPN_BASE}?dates=${season}&seasontype=2&week=${weekNumber}`;

    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`ESPN returned status ${response.status}`);
    }

    const data = await response.json();
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
        // Hooked here so what the pick sheet displays is the number the pool
        // will actually be graded against — never the raw market line.
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
