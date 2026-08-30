import { createClient } from '@supabase/supabase-js';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseAnonKey) {
  throw new Error('Missing Supabase environment variables. Please check your .env.local file.');
}

export const supabase = createClient(supabaseUrl, supabaseAnonKey);

/**
 * Row types — the exact snake_case shapes stored in Postgres.
 *
 * These are deliberately named `*Row` so they cannot be mistaken for the
 * camelCase application types in `src/types.ts`. Confusing the two is what let
 * the NHL app's `getCurrentWeek` return a raw row while `getAllWeeks` returned
 * a mapped one, both typed as `Week`, and hid a dozen type errors that `vite
 * build` never surfaced. Map rows to app types at the service boundary; do not
 * let a `*Row` escape into a component.
 */
export type Profile = {
  id: string;
  email: string;
  name: string;
  avatar: string | null;
  role: 'admin' | 'member';
  created_at: string;
  updated_at: string;
};

/**
 * An invite. Single-use, and the only route to a profile — see 0003_invites.sql.
 *
 * `code` is never readable by a member: the RLS policy shows rows to admins
 * only, so a member cannot read somebody else’s unclaimed code.
 */
export type InviteRow = {
  code: string;
  /** When set, only this address may redeem it. Lower case. */
  email: string | null;
  created_by: string | null;
  created_at: string;
  expires_at: string | null;
  claimed_by: string | null;
  claimed_at: string | null;
};

export type WeekRow = {
  id: string;
  season: number;
  week_number: number;
  /**
   * Sunday 13:00 ET. Derived by trigger from `id` — never supplied by a client.
   * See 0001_init.sql.
   */
  final_lock_at: string;
  status: 'OPEN' | 'LOCKED' | 'COMPLETED';
  created_at: string;
};

export type GameRow = {
  id: string;
  week_id: string;
  espn_event_id: string | null;
  home_team_id: string;
  away_team_id: string;
  /** Kickoff. Also the moment this game's picks lock. */
  start_time: string;
  status: 'SCHEDULED' | 'LIVE' | 'FINAL';
  home_score: number | null;
  away_score: number | null;
  /**
   * The line from the HOME team's point of view, always ending in .5.
   * Service-role write only — a member who could set this could pick against
   * a number of their own choosing.
   */
  spread: number | null;
  spread_captured_at: string | null;
  created_at: string;
  updated_at: string;
};

export type PickRow = {
  id: string;
  user_id: string;
  week_id: string;
  game_id: string;
  selected_team_id: string;
  confidence: number;
  points_earned: number;
  result: 'WIN' | 'LOSS' | 'PENDING';
  created_at: string;
  updated_at: string;
};
