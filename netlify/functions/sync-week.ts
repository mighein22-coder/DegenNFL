import type { Handler, HandlerEvent } from '@netlify/functions';
import { createClient } from '@supabase/supabase-js';
import { syncAndGradeWeek } from './_shared/weekLifecycle';

/**
 * Netlify Function: sync-week
 *
 * Server-side score sync and pick resolution, using the service-role key. It
 * bypasses RLS entirely, which is what lets it write the columns no client can
 * touch: `games.home_score` / `away_score`, and `picks.result` /
 * `points_earned`.
 *
 * Two jobs, in order:
 *
 *   1. UPDATE SCORES for games that have started or finished.
 *   2. RESOLVE PICKS against the frozen line, closing the week once every game
 *      is final and every pick is scored.
 *
 * This runs whenever a member opens the app, and that is the point: results
 * have to land through Thursday, Sunday and Monday as games finish, not once a
 * week. A locked-but-unfinished week is the normal state for four days out of
 * seven, and members watching their sheet are what drives it forward.
 *
 * IT NO LONGER TOUCHES `games.spread`. Lines are captured once, together, when
 * the week is activated on Tuesday — see netlify/functions/_shared/weekLifecycle.ts
 * for why kickoff was the wrong moment (ESPN drops the odds once a game is
 * final, so freezing at kickoff was a race against the feed).
 *
 * POST body: { weekId: string }
 * Returns:   { gamesUpdated, picksResolved, closed, errors }
 */

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
  // reads a public score feed, and writes only what that week already implies.
  // It cannot be steered to write anything of the caller's choosing.
  //
  // Contrast admin-activate-week, which *is* admin-gated: that one creates a
  // week and fixes the lines the pool is graded against.
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

  try {
    const body = JSON.parse(event.body || '{}');
    const weekId: string = body.weekId;

    if (!weekId || !/^week-\d{4}-\d{2}$/.test(weekId)) {
      return {
        statusCode: 400,
        body: JSON.stringify({ error: 'weekId must be formatted week-YYYY-NN' })
      };
    }

    const result = await syncAndGradeWeek(admin, weekId);
    return { statusCode: 200, body: JSON.stringify(result) };
  } catch (error: any) {
    console.error('[SYNC WEEK ERROR]', error);
    return {
      statusCode: 500,
      body: JSON.stringify({
        gamesUpdated: 0,
        picksResolved: 0,
        closed: false,
        errors: [error.message ?? String(error)]
      })
    };
  }
};

export { handler };
