import { supabase } from './supabase';
import type { GameRow, PickRow, Profile, WeekRow } from './supabase';
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
export async function syncScheduleForWeek(weekNumber: number): Promise<number> {
  const response = await fetch('/.netlify/functions/nfl-schedule', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ weekNumber, season: SEASON })
  });

  if (!response.ok) {
    throw new Error(`nfl-schedule returned ${response.status}`);
  }

  const { games } = (await response.json()) as {
    games: Array<Record<string, unknown>>;
  };

  const seeds = games.map(g => ({
    week_id: g.week_id,
    espn_event_id: g.espn_event_id,
    home_team_id: g.home_team_id,
    away_team_id: g.away_team_id,
    start_time: g.start_time
  }));

  const { error } = await supabase
    .from('games')
    .upsert(seeds, { onConflict: 'week_id,espn_event_id', ignoreDuplicates: true });

  if (error) throw error;
  return seeds.length;
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
