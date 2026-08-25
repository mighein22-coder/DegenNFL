import type { Handler } from '@netlify/functions';

/**
 * Netlify Function: team records proxy.
 *
 * Fetches NFL standings server-side to avoid browser CORS issues, and returns a
 * compact map of team abbreviation -> "W-L" or "W-L-T".
 *
 * NFL games can end in a tie, so the record has an optional third component —
 * unlike the NHL app's fixed "W-L-OTL". Note this is unrelated to how the pool
 * scores: picks are graded against a hooked spread, so a tied GAME still leaves
 * every pick a clear win or loss. The tie only shows up here, in the team's own
 * record.
 *
 * TODO(spike): the ESPN standings response shape is unverified — see
 * scripts/spike-espn.mjs and the note at the top of nfl-schedule.ts. The
 * groups/children nesting below is the reported shape, not an observed one.
 */

const ESPN_STANDINGS =
  'https://site.api.espn.com/apis/v2/sports/football/nfl/standings?level=3';

/** Reads a named stat out of ESPN's `stats: [{ name, value }]` array. */
function stat(entry: any, name: string): number {
  const found = entry.stats?.find((s: any) => s.name === name);
  return Number(found?.value ?? 0);
}

/** Walks the arbitrarily nested groups/children tree collecting standings entries. */
function collectEntries(node: any, into: any[]): void {
  for (const entry of node?.standings?.entries ?? []) into.push(entry);
  for (const child of node?.children ?? []) collectEntries(child, into);
  for (const group of node?.groups ?? []) collectEntries(group, into);
}

const handler: Handler = async () => {
  try {
    const response = await fetch(ESPN_STANDINGS);
    if (!response.ok) {
      throw new Error(`ESPN API returned status ${response.status}`);
    }

    const data = await response.json();

    const entries: any[] = [];
    collectEntries(data, entries);

    const records: Record<string, string> = {};
    for (const entry of entries) {
      const abbrev: string | undefined = entry.team?.abbreviation;
      if (!abbrev) continue;

      const wins = stat(entry, 'wins');
      const losses = stat(entry, 'losses');
      const ties = stat(entry, 'ties');

      // Only show the third component when there is actually a tie — "9-7" is
      // the normal case and "9-7-0" reads like a hockey record.
      records[abbrev] = ties > 0 ? `${wins}-${losses}-${ties}` : `${wins}-${losses}`;
    }

    console.log(`[TEAM RECORDS] ${Object.keys(records).length} teams`);

    return {
      statusCode: 200,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
        'Cache-Control': 'public, max-age=3600'
      },
      body: JSON.stringify(records)
    };
  } catch (error: any) {
    console.error('[TEAM RECORDS ERROR]', error);
    return {
      statusCode: 500,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: error.message || 'Failed to fetch NFL standings' })
    };
  }
};

export { handler };
