import type { Handler, HandlerEvent } from '@netlify/functions';
import { createClient } from '@supabase/supabase-js';
import { activateWeek } from './_shared/weekLifecycle';
import { readSupabaseEnv } from './_shared/supabaseEnv';
import { SEASON } from '../../src/constants';

/**
 * Netlify Function: admin-activate-week
 *
 * Opens a week by hand: the same `activateWeek` the Tuesday cron runs, behind
 * an admin-only HTTP gate. One implementation, two triggers — a second copy of
 * the seeding-and-freezing logic would eventually disagree with the scheduled
 * one about what a week's lines are, which is the kind of disagreement that
 * ends in a disputed payout.
 *
 * It exists for the Tuesdays the cron does not survive: a Netlify incident, an
 * ESPN outage, a week whose schedule needed re-seeding. Running it twice is
 * safe — `activateWeek` never re-prices a line it has already frozen, so the
 * second run reports zero lines frozen and changes nothing.
 *
 * ADMIN-ONLY, unlike sync-week. sync-week is deliberately open to any signed-in
 * member because scores must keep landing whether or not an admin is around;
 * this one *creates* a week and fixes the numbers the whole pool is graded
 * against, so it is the caller's role that decides.
 *
 * POST body: { weekNumber: number, season?: number }
 */

const handler: Handler = async (event: HandlerEvent) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: JSON.stringify({ error: 'Method Not Allowed' }) };
  }

  // Necessarily before the bearer-token check below: verifying the caller's
  // token needs the admin client, which needs these. An unauthenticated caller
  // can therefore learn which variable is unset — a name, never a value.
  const env = readSupabaseEnv();
  if (!env.ok) {
    console.error('[ADMIN ACTIVATE] Missing env vars', env.missing);
    return { statusCode: 500, body: JSON.stringify({ error: env.message }) };
  }

  const admin = createClient(env.env.url, env.env.serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false }
  });

  // Same token scheme as sync-week: a Supabase access token, never a shared
  // secret. DO NOT reintroduce a VITE_-prefixed secret here — Vite inlines
  // those into the public bundle, which is how the NHL app leaked its own.
  const authHeader = event.headers['authorization'] || event.headers['Authorization'];
  const token = authHeader?.replace(/^Bearer /i, '').trim();

  if (!token) {
    console.warn('[ADMIN ACTIVATE] Request with no bearer token');
    return { statusCode: 401, body: JSON.stringify({ error: 'Unauthorized' }) };
  }

  const { data: auth, error: authError } = await admin.auth.getUser(token);
  if (authError || !auth?.user) {
    console.warn('[ADMIN ACTIVATE] Rejected token:', authError?.message ?? 'no user for token');
    return { statusCode: 401, body: JSON.stringify({ error: 'Unauthorized' }) };
  }

  // The role is read server-side under the service-role key rather than taken
  // from anything the caller sent. A client claiming to be an admin proves it
  // by being one in `profiles`.
  const { data: profile, error: profileError } = await admin
    .from('profiles')
    .select('role')
    .eq('id', auth.user.id)
    .single();

  if (profileError || profile?.role !== 'admin') {
    console.warn(`[ADMIN ACTIVATE] Non-admin ${auth.user.id} attempted activation`);
    return { statusCode: 403, body: JSON.stringify({ error: 'Admins only' }) };
  }

  try {
    const body = JSON.parse(event.body || '{}');
    const weekNumber = Number(body.weekNumber);
    const season = Number(body.season ?? SEASON);

    // Validate before it reaches a URL or a week id.
    if (!Number.isInteger(weekNumber) || weekNumber < 1 || weekNumber > 18) {
      return {
        statusCode: 400,
        body: JSON.stringify({ error: 'weekNumber must be an integer between 1 and 18' })
      };
    }
    if (!Number.isInteger(season) || season < 2020 || season > 2100) {
      return { statusCode: 400, body: JSON.stringify({ error: 'season is out of range' }) };
    }

    const result = await activateWeek(admin, season, weekNumber);

    console.log(`[ADMIN ACTIVATE] ${auth.user.id} activated week ${weekNumber}`, result);
    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(result)
    };
  } catch (error: any) {
    console.error('[ADMIN ACTIVATE ERROR]', error);
    return {
      statusCode: 500,
      body: JSON.stringify({ error: error.message || 'Failed to activate week' })
    };
  }
};

export { handler };
