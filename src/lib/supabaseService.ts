import { supabase } from './supabase';
import type { GameRow, InviteRow, PickRow, Profile, WeekRow } from './supabase';
import { buildWeekId, getCurrentWeekNumber } from './timezone';
import { SEASON } from '../constants';
import type { Game, Pick, Week } from '../types';

/**
 * The service boundary.
 *
 * Everything above this line speaks camelCase application types; everything
 * below speaks snake_case Postgres rows. Mapping happens HERE and nowhere else.
 *
 * The NHL app let a raw row escape from one function while another returned a
 * mapped object, both typed as `Week`, and hid a dozen type errors that `vite
 * build` never surfaced (it does not typecheck). Hence `npm run typecheck` in
 * CI, and hence the `*Row` naming.
 *
 * SCOPE NOTE: this is the scaffold's version. The read paths and the pick-save
 * path are real; the aggregate views (team stats, affinity) are not written yet
 * and are marked below. See TASKS.md.
 */

// ---------------------------------------------------------------------------
// Mappers
// ---------------------------------------------------------------------------

function toWeek(row: WeekRow): Week {
  return {
    id: row.id,
    season: row.season,
    weekNumber: row.week_number,
    finalLockAt: row.final_lock_at,
    status: row.status
  };
}

function toGame(row: GameRow): Game {
  return {
    id: row.id,
    weekId: row.week_id,
    espnEventId: row.espn_event_id ?? undefined,
    homeTeamId: row.home_team_id,
    awayTeamId: row.away_team_id,
    startTime: row.start_time,
    status: row.status,
    homeScore: row.home_score ?? undefined,
    awayScore: row.away_score ?? undefined,
    // Postgres numeric comes back as a string over the wire. Coercing here,
    // once, keeps every caller from having to remember that.
    spread: row.spread == null ? undefined : Number(row.spread),
    spreadCapturedAt: row.spread_captured_at ?? undefined
  };
}

function toPick(row: PickRow): Pick {
  return {
    userId: row.user_id,
    weekId: row.week_id,
    gameId: row.game_id,
    selectedTeamId: row.selected_team_id,
    confidence: row.confidence,
    pointsEarned: row.points_earned,
    result: row.result
  };
}

// ---------------------------------------------------------------------------
// Invites
//
//    A profile IS membership, and after 0003 the only way to get one is to
//    redeem an invite. Nothing here can create a profile directly — the grant
//    and the policy that used to allow it are both gone.
// ---------------------------------------------------------------------------

/**
 * Turn an invite code into this user’s profile.
 *
 * Called for a signed-in user who has none yet, which is a normal state: if
 * the Supabase project requires email confirmation, signup cannot redeem
 * immediately, because there is no session to attach a profile to until the
 * address is confirmed. It is also how a mistyped code is recovered from,
 * rather than stranding the account.
 *
 * The code is normalised server-side, so case, spaces and dashes do not
 * matter. The email is read from `auth.users` rather than taken from here —
 * an email-bound invite is only worth something if the person redeeming it
 * cannot assert their own address.
 */
export async function redeemInvite(code: string, name: string): Promise<Profile> {
  const { data, error } = await supabase.rpc('redeem_invite', {
    p_code: code,
    p_name: name
  });

  if (error) throw error;
  return data as Profile;
}

/**
 * Mint a single-use invite code. Admin-only, enforced in the database.
 *
 * Pass an email to bind the code to one address, which makes it useless to
 * anyone else who sees it. Leave it out for a code you hand over in person.
 */
export async function createInvite(
  email?: string,
  expiresAt?: string
): Promise<InviteRow> {
  const { data, error } = await supabase.rpc('admin_create_invite', {
    p_email: email ?? null,
    p_expires_at: expiresAt ?? null
  });

  if (error) throw error;
  return data as InviteRow;
}

/** Every invite, outstanding and spent. Returns nothing for a non-admin. */
export async function listInvites(): Promise<InviteRow[]> {
  const { data, error } = await supabase
    .from('invites')
    .select('*')
    .order('created_at', { ascending: false });

  if (error) throw error;
  return (data ?? []) as InviteRow[];
}

// ---------------------------------------------------------------------------
// Weeks
// ---------------------------------------------------------------------------

/**
 * The week the pool is currently on, creating its row if this is the first
 * visit of the week.
 *
 * Seeding is a normal member action rather than an admin one — whoever opens
 * the app first creates the row. That is safe because the database derives
 * `season`, `week_number` and `final_lock_at` from the id rather than taking
 * them from us (see 0001_init.sql), so there is nothing here worth forging.
 */
export async function getCurrentWeek(): Promise<Week> {
  const weekId = buildWeekId(getCurrentWeekNumber(), SEASON);

  const { data: existing, error } = await supabase
    .from('weeks')
    .select('*')
    .eq('id', weekId)
    .maybeSingle();

  if (error) throw error;
  if (existing) return toWeek(existing as WeekRow);

  // Only the id is sent. Everything else is derived server-side.
  const { data: created, error: insertError } = await supabase
    .from('weeks')
    .insert({ id: weekId })
    .select()
    .single();

  if (insertError) {
    // A concurrent first-visit lost the race. Re-read rather than fail.
    const { data: raced, error: reReadError } = await supabase
      .from('weeks')
      .select('*')
      .eq('id', weekId)
      .single();
    if (reReadError) throw insertError;
    return toWeek(raced as WeekRow);
  }

  return toWeek(created as WeekRow);
}

export async function getAllWeeks(): Promise<Week[]> {
  const { data, error } = await supabase
    .from('weeks')
    .select('*')
    .order('week_number', { ascending: true });

  if (error) throw error;
  return (data as WeekRow[]).map(toWeek);
}

// ---------------------------------------------------------------------------
// Games
// ---------------------------------------------------------------------------

export async function getGamesForWeek(weekId: string): Promise<Game[]> {
  const { data, error } = await supabase
    .from('games')
    .select('*')
    .eq('week_id', weekId)
    .order('start_time', { ascending: true });

  if (error) throw error;
  return (data as GameRow[]).map(toGame);
}

/**
 * Seeds a week's schedule from the nfl-schedule function.
 *
 * Note what is NOT written: the spread. The column grants in 0001_init.sql make
 * it service-role only, so the line arrives later, frozen at kickoff by
 * sync-week. The function returns a hooked spread for display, but it is not
 * ours to persist.
 */
export interface ActivationResult {
  weekId: string;
  gamesSeeded: number;
  linesFrozen: number;
  /** Matchups that opened without a line. Each needs setSpread() from an admin. */
  gamesWithoutLine: string[];
  errors: string[];
}

/**
 * Open a week by hand: seed its schedule and freeze its lines.
 *
 * Normally the Tuesday 18:00 ET cron does this and nobody touches it — see
 * netlify/functions/weekly-rollover.ts. This is the admin's manual trigger for
 * the Tuesdays it does not happen, and the recovery path for a week that needs
 * re-seeding.
 *
 * Safe to run twice: a line already frozen is never re-priced, so a second run
 * reports zero lines frozen and changes nothing.
 *
 * The seeding itself happens server-side under the service-role key rather than
 * here, because `games.spread` is not client-writable by any grant. The client
 * could seed the schedule; it could never set a line.
 */
export async function activateWeek(weekNumber: number): Promise<ActivationResult> {
  const { data: sessionData } = await supabase.auth.getSession();
  const token = sessionData.session?.access_token;
  if (!token) throw new Error('activateWeek: not signed in');

  const response = await fetch('/.netlify/functions/admin-activate-week', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`
    },
    body: JSON.stringify({ weekNumber, season: SEASON })
  });

  if (!response.ok) {
    const detail = await response.json().catch(() => ({}));
    throw new Error(detail.error ?? `admin-activate-week returned ${response.status}`);
  }

  return (await response.json()) as ActivationResult;
}

/**
 * Set the line on a game that opened without one.
 *
 * Spreads are captured once, when the week is activated. A game the book had
 * OFF at that moment lands with a null spread and is unpickable until this is
 * called — so it is the admin's job before Sunday, not an emergency at kickoff.
 *
 * Takes the RAW line from the home team's point of view; the database hooks it
 * to a half point, exactly as hookSpread() would. Pass -3 and the game is
 * stored at -3.5.
 *
 * Goes through an RPC rather than an update because `games.spread` is not
 * client-writable — admin_set_spread is SECURITY DEFINER and does its own admin
 * check. It refuses to overwrite a line that is already frozen.
 */
export async function setSpread(gameId: string, rawSpread: number): Promise<Game> {
  const { data, error } = await supabase.rpc('admin_set_spread', {
    p_game_id: gameId,
    p_raw_spread: rawSpread
  });

  if (error) throw error;
  return toGame(data as GameRow);
}

// ---------------------------------------------------------------------------
// Picks
// ---------------------------------------------------------------------------

export async function getPicksForWeek(weekId: string): Promise<Pick[]> {
  const { data, error } = await supabase.from('picks').select('*').eq('week_id', weekId);
  if (error) throw error;
  // RLS already hides other members' unlocked picks — see 0001_init.sql. What
  // comes back here is exactly what the caller is allowed to see.
  return (data as PickRow[]).map(toPick);
}

export async function getAllPicks(): Promise<Pick[]> {
  const { data, error } = await supabase.from('picks').select('*');
  if (error) throw error;
  return (data as PickRow[]).map(toPick);
}

export interface PickSubmission {
  gameId: string;
  selectedTeamId: string;
  confidence: number;
}

/**
 * Saves the caller's sheet for a week.
 *
 * One RPC, one transaction. A client-side delete-then-insert could fail between
 * the two and lose a member's whole sheet — that happened in the NHL app before
 * its 0005.
 *
 * The submission describes only the picks still OPEN to change. Locked picks
 * are not ours to send and are preserved server-side, so a sheet of fewer than
 * five is normal here rather than an error: games lock one at a time from
 * Thursday night onward.
 */
export async function savePicks(
  weekId: string,
  picks: PickSubmission[]
): Promise<Pick[]> {
  const { data, error } = await supabase.rpc('save_picks', {
    p_week_id: weekId,
    p_picks: picks.map(p => ({
      game_id: p.gameId,
      selected_team_id: p.selectedTeamId,
      confidence: p.confidence
    }))
  });

  if (error) {
    // save_picks raises readable messages ('that game is locked', 'that
    // confidence value is already locked in on another game') — surface them
    // rather than a generic failure.
    throw new Error(error.message);
  }

  return (data as PickRow[]).map(toPick);
}

// ---------------------------------------------------------------------------
// Profiles
// ---------------------------------------------------------------------------

export async function getProfiles(): Promise<Profile[]> {
  const { data, error } = await supabase.from('profiles').select('*').order('name');
  if (error) throw error;
  return data as Profile[];
}

// ---------------------------------------------------------------------------
// Scoring trigger
// ---------------------------------------------------------------------------

/**
 * Asks the server to sync scores and grade picks for a week.
 *
 * Sends the caller's Supabase access token; sync-week verifies it with
 * `auth.getUser()`. There is deliberately no shared secret — the NHL app had
 * one in a `VITE_`-prefixed variable, which Vite inlined into the public
 * bundle, leaving the endpoint effectively unauthenticated.
 */
export async function syncWeek(weekId: string): Promise<void> {
  const { data: sessionData } = await supabase.auth.getSession();
  const token = sessionData.session?.access_token;
  if (!token) return; // not signed in; nothing to sync on their behalf

  const response = await fetch('/.netlify/functions/sync-week', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`
    },
    body: JSON.stringify({ weekId })
  });

  if (!response.ok) {
    console.warn(`[syncWeek] ${weekId} returned ${response.status}`);
    return;
  }

  const result = await response.json();
  if (result.errors?.length) {
    console.warn(`[syncWeek] ${weekId} reported issues:`, result.errors);
  }
}
