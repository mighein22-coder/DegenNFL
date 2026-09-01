import { schedule } from '@netlify/functions';
import type { Handler } from '@netlify/functions';
import { createClient } from '@supabase/supabase-js';
import {
  getCurrentWeekNumber,
  getFinalLockAt,
  buildWeekId,
  formatETTime
} from './_shared/etTime';
import { activateWeek, syncAndGradeWeek } from './_shared/weekLifecycle';
import { readSupabaseEnv } from './_shared/supabaseEnv';
import { SEASON } from '../../src/constants';

/**
 * Netlify Scheduled Function: weekly-rollover
 *
 * The Tuesday 18:00 ET job. It closes the week that just finished and opens the
 * next one — creating its row, seeding its schedule, and capturing and freezing
 * every line in it. Until this runs, the coming week has no games and no
 * numbers, which is exactly the point: the pool's lines are set once, together,
 * before any of that week's games kick off.
 *
 * This is the only time-triggered thing in the app. Everything else happens
 * because a member opened a page.
 *
 * WHY TWO CRON TIMES FOR ONE EVENT
 *
 * Netlify cron expressions are UTC only, and Tuesday 18:00 ET is 22:00 UTC
 * under EDT but 23:00 UTC under EST. A single fixed UTC hour would therefore
 * drift by an hour when DST ends in November, roughly halfway through the
 * season. So the job fires at both, and decides for itself whether the ET
 * rollover has actually happened — which is what `getCurrentWeekNumber` already
 * encodes, DST-correctly, and is the same function the UI uses to decide which
 * week to show. The early firing is a no-op; the correct one does the work.
 *
 * Being idempotent is not a nicety here, it is the design: this runs twice
 * every Tuesday, and `activateWeek` never re-prices a line it has already
 * frozen.
 *
 * If a Tuesday is missed entirely — Netlify outage, ESPN down — an admin can
 * run the same activation by hand from the Admin panel. See
 * netlify/functions/admin-activate-week.ts.
 */

const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

const rollover: Handler = async () => {
  // Nobody is watching a cron run, so this message exists to be found in the
  // function log months later. A rollover that dies here is the season not
  // opening, which is why it logs the specific variable rather than a shrug.
  const env = readSupabaseEnv();
  if (!env.ok) {
    console.error('[ROLLOVER] Missing env vars', env.missing, env.message);
    return { statusCode: 500, body: JSON.stringify({ error: env.message }) };
  }

  // No bearer token here: a scheduled invocation has no user. The service-role
  // key is the whole authority, which is why this file must never grow an HTTP
  // path that a browser could reach.
  const admin = createClient(env.env.url, env.env.serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false }
  });

  const now = new Date();
  const week = getCurrentWeekNumber(now);
  const finalLock = getFinalLockAt(week);

  // Has the ET rollover into this week actually happened, and is this week
  // still ahead of us?
  //
  // `getCurrentWeekNumber` clamps to 1 before the season and to 18 after it, so
  // without this window the job would cheerfully activate week 1 every Tuesday
  // from now until September — freezing lines months before they mean anything.
  // The window is the seven days ending at the week's own Sunday lock, which
  // the Tuesday 18:00 ET rollover falls inside and nothing else does.
  const windowOpens = new Date(finalLock.getTime() - WEEK_MS);

  if (now < windowOpens || now >= finalLock) {
    console.log(
      `[ROLLOVER] ${formatETTime(now, 'EEE HH:mm zzz')}: outside week ${week}'s ` +
        `activation window, nothing to do`
    );
    return { statusCode: 200, body: JSON.stringify({ skipped: true, week }) };
  }

  const summary: Record<string, unknown> = { week, ranAt: formatETTime(now, 'EEE HH:mm zzz') };

  // 1. Close out the week that just finished. Monday Night Football ends around
  //    23:30 ET, so by now it is final and gradable. Members will usually have
  //    triggered this already just by opening the app; doing it here means a
  //    quiet week still closes.
  if (week > 1) {
    const priorWeekId = buildWeekId(week - 1, SEASON);
    try {
      summary.priorWeek = await syncAndGradeWeek(admin, priorWeekId);
    } catch (error: any) {
      // A week nobody ever opened has no row. Not fatal — there is nothing in
      // it to grade.
      console.warn(`[ROLLOVER] Could not close ${priorWeekId}:`, error.message ?? error);
      summary.priorWeekError = error.message ?? String(error);
    }
  }

  // 2. Open the new one.
  try {
    const activation = await activateWeek(admin, SEASON, week);
    summary.activation = activation;

    if (activation.gamesWithoutLine.length > 0) {
      // Deliberately loud. These games are seeded but unpickable until an admin
      // sets a line with admin_set_spread, and the pool has until Sunday.
      console.error(
        `[ROLLOVER] Week ${week} opened with ${activation.gamesWithoutLine.length} ` +
          `game(s) missing a line — an admin must set these: ` +
          activation.gamesWithoutLine.join(', ')
      );
    }
  } catch (error: any) {
    console.error('[ROLLOVER ERROR]', error);
    return {
      statusCode: 500,
      body: JSON.stringify({ ...summary, error: error.message ?? String(error) })
    };
  }

  console.log('[ROLLOVER]', summary);
  return { statusCode: 200, body: JSON.stringify(summary) };
};

// 22:00 and 23:00 UTC on Tuesdays — see the note above on DST.
export const handler = schedule('0 22,23 * * 2', rollover);
