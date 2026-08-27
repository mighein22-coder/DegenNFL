-- ============================================================================
-- 0001_init.sql — DegenNFL schema
--
-- This creates the schema in its LOCKED-DOWN END STATE. It is not a fresh,
-- permissive schema waiting to be hardened later.
--
-- The NHL app (FrozenDegenerates) reached this state over eight migrations,
-- most of them written after a security review found the hole. Every guard
-- below is carried over deliberately, and the comment on each names the
-- migration that earned it. Do not relax one without reading that history
-- first — each of them closed a way for a member to move the standings from
-- the browser console.
--
--   FrozenDegenerates 0001  profiles.role not self-writable
--   FrozenDegenerates 0002  signup can insert its own profile row
--   FrozenDegenerates 0003  picks hidden until they lock
--   FrozenDegenerates 0004  the deadline enforced in the database, not just JS
--   FrozenDegenerates 0005  save_picks as one transaction (a partial write
--                           could otherwise lose a member's sheet)
--   FrozenDegenerates 0006  picks.points_earned / result not member-writable
--   FrozenDegenerates 0007  games scores not publicly writable
--   FrozenDegenerates 0008  weeks deadline derived from the id, not trusted
--
-- WHAT IS NEW HERE, AND WHY
--
--   * Weeks are 1..18, identified `week-YYYY-NN`. The final lock is DERIVED
--     from that id (0008's rule applied to the new key).
--   * Picks lock PER GAME at kickoff, as well as at the Sunday 13:00 ET final
--     lock. `pick_locked()` replaces the NHL app's `picks_revealed()`.
--   * Games carry a SPREAD, and it is service-role write only. A member who
--     could set the line could pick against a number of their own choosing —
--     the spread-era version of the 0008 hole.
--   * `games.spread` must end in a half point. That CHECK is what makes every
--     pick a win or a loss, which is why nothing here knows about pushes.
--
-- Safe to run more than once.
-- ============================================================================

begin;

-- ---------------------------------------------------------------------------
-- 1. Season calendar
--
--    SEASON_WEEK1_SUNDAY in src/constants.ts is mirrored here. The database
--    derives every deadline from it rather than accepting one from a client.
--    If you change the season, change BOTH — nothing will catch a mismatch
--    automatically, because the app and the database compute independently on
--    purpose.
-- ---------------------------------------------------------------------------

create or replace function public.season_week1_sunday()
returns date
language sql
immutable
as $$
  select date '2026-09-13';
$$;

comment on function public.season_week1_sunday() is
  'Sunday of Week 1. Mirrors SEASON_WEEK1_SUNDAY in src/constants.ts.';

/*
 * The whole-sheet deadline for a week: Sunday 13:00 America/New_York.
 * NFL weeks are exactly seven days apart, so this needs no calendar table.
 *
 * The timestamptz cast applies the ET offset in force on that date, so the
 * November DST change is handled by Postgres rather than by arithmetic here.
 */
create or replace function public.week_final_lock_at(week_number smallint)
returns timestamptz
language sql
immutable
as $$
  select (
    (public.season_week1_sunday() + ((week_number - 1) * 7))::timestamp
      + time '13:00'
  ) at time zone 'America/New_York';
$$;

comment on function public.week_final_lock_at(smallint) is
  'Sunday 13:00 ET of the given week. Mirrors getFinalLockAt() in src/lib/timezone.ts.';

/*
 * Pulls the week number out of a `week-YYYY-NN` id, or raises.
 *
 * This is the hinge of the whole deadline design: because the lock is computed
 * from the id, and the id is the primary key, a member cannot move their own
 * deadline without changing the key of a row they do not control.
 */
create or replace function public.week_number_from_id(week_id text)
returns smallint
language plpgsql
immutable
as $$
declare
  parts text[];
  parsed smallint;
begin
  parts := regexp_match(week_id, '^week-(\d{4})-(\d{2})$');
  if parts is null then
    raise exception 'Malformed week id "%": expected week-YYYY-NN', week_id;
  end if;

  parsed := parts[2]::smallint;
  if parsed < 1 or parsed > 18 then
    raise exception 'Week number % out of range 1..18 in id "%"', parsed, week_id;
  end if;

  return parsed;
end;
$$;

create or replace function public.season_from_id(week_id text)
returns smallint
language plpgsql
immutable
as $$
declare
  parts text[];
begin
  parts := regexp_match(week_id, '^week-(\d{4})-(\d{2})$');
  if parts is null then
    raise exception 'Malformed week id "%": expected week-YYYY-NN', week_id;
  end if;
  return parts[1]::smallint;
end;
$$;

-- ---------------------------------------------------------------------------
-- 2. Tables
-- ---------------------------------------------------------------------------

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text not null,
  name text not null,
  avatar text,
  role text not null default 'member' check (role in ('admin', 'member')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.weeks (
  id text primary key check (id ~ '^week-\d{4}-\d{2}$'),
  season smallint not null,
  week_number smallint not null check (week_number between 1 and 18),
  -- Derived by trigger from `id`. Never trust a client value here.
  final_lock_at timestamptz not null,
  status text not null default 'OPEN' check (status in ('OPEN', 'LOCKED', 'COMPLETED')),
  created_at timestamptz not null default now(),
  unique (season, week_number)
);

create table if not exists public.games (
  id uuid primary key default gen_random_uuid(),
  week_id text not null references public.weeks(id),
  espn_event_id text,
  home_team_id text not null,
  away_team_id text not null,
  -- Kickoff. Also the moment this individual game's picks lock.
  start_time timestamptz not null,
  status text not null default 'SCHEDULED' check (status in ('SCHEDULED', 'LIVE', 'FINAL')),
  home_score smallint,
  away_score smallint,

  -- The line, from the HOME team's point of view. Negative = home favoured.
  spread numeric(4, 1),
  spread_captured_at timestamptz,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint games_teams_differ check (home_team_id <> away_team_id),
  unique (week_id, espn_event_id),

  -- THE CONSTRAINT THAT MAKES THE NO-PUSH DESIGN HOLD.
  --
  -- A whole-number line lets a game land exactly on the number, which would be
  -- a tie the rest of the system has no representation for: `picks.result` has
  -- no PUSH, and `points_earned` is an integer. Rather than add a third state
  -- everywhere, every line is hooked to a half point before it is stored (see
  -- hookSpread() in src/lib/scoring.ts).
  --
  -- Enforced here as well as in the application because a bug in the sync
  -- function would otherwise produce a season of quiet ties that nobody
  -- notices until a payout is disputed. Here it is a failed insert instead.
  constraint games_spread_is_hooked
    check (spread is null or (abs(spread) * 2)::int % 2 = 1)
);

create table if not exists public.picks (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  week_id text not null references public.weeks(id),
  game_id uuid not null references public.games(id) on delete cascade,
  selected_team_id text not null,
  -- A POINT VALUE, not a rank: four games at 1 point and one at 3. There is
  -- deliberately no 2 -- see "Rules of the pool" in CLAUDE.md. The name is
  -- kept from the NHL original because it is still what the idea is called.
  confidence smallint not null check (confidence in (1, 3)),

  -- Scored by sync-week under the service-role key. Never client-writable.
  points_earned smallint not null default 0,
  result text not null default 'PENDING' check (result in ('WIN', 'LOSS', 'PENDING')),

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  -- One pick per game.
  --
  -- The rest of the week shape -- four 1s and one 3 -- cannot be expressed as
  -- a table constraint now that the 1s repeat, so it lives in
  -- picks_one_bonus_per_week and picks_enforce_sheet_shape below.
  --
  -- Note what the old unique (user_id, week_id, confidence) was quietly also
  -- doing: with five distinct values it capped a member at five rows a week.
  -- That cap is now the trigger job, and it matters because INSERT on picks
  -- is granted to authenticated directly -- members are not forced through
  -- save_picks.
  unique (user_id, game_id)
);

create index if not exists games_week_idx on public.games (week_id);
create index if not exists picks_week_idx on public.picks (week_id);
create index if not exists picks_user_idx on public.picks (user_id);

/*
 * The 3-point game is the scarce one: exactly one per member per week, and a
 * locked pick has already spent it. A partial unique index says that
 * atomically -- which is what the old (user_id, week_id, confidence) unique
 * did for every value back when all five were distinct.
 */
create unique index if not exists picks_one_bonus_per_week
  on public.picks (user_id, week_id) where confidence = 3;

/*
 * The rest of the sheet shape, which no index can express: at most four
 * 1-point picks, and therefore at most five picks in all.
 *
 * This is not belt-and-braces over save_picks. Because INSERT on public.picks
 * is granted to authenticated, a member can POST rows straight at PostgREST
 * without ever calling save_picks, so the cap has to live here or it does not
 * exist at all. Under the old schema it fell out of the unique constraint for
 * free; under 1/3 scoring it has to be written down.
 *
 * SECURITY DEFINER so the count is complete regardless of the caller RLS, and
 * an advisory lock so two concurrent inserts cannot both read four and both
 * write a fifth.
 */
create or replace function public.picks_enforce_sheet_shape()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_ones  int;
  v_bonus int;
begin
  perform pg_advisory_xact_lock(hashtext(new.user_id::text || ':' || new.week_id));

  select count(*) filter (where confidence = 1),
         count(*) filter (where confidence = 3)
    into v_ones, v_bonus
    from public.picks
   where user_id = new.user_id
     and week_id = new.week_id
     and id <> new.id;

  if new.confidence = 1 then
    v_ones := v_ones + 1;
  else
    v_bonus := v_bonus + 1;
  end if;

  if v_bonus > 1 then
    raise exception 'picks: only one 3-point pick per week';
  end if;

  if v_ones > 4 then
    raise exception 'picks: at most four 1-point picks per week';
  end if;

  return new;
end;
$$;

drop trigger if exists picks_enforce_sheet_shape on public.picks;
create trigger picks_enforce_sheet_shape
  before insert or update on public.picks
  for each row execute function public.picks_enforce_sheet_shape();

/*
 * Does this game have a line yet?
 *
 * Spreads are set once on the Tuesday the week opens. A game whose line never
 * arrived (the book had it OFF) keeps a null spread until an admin supplies
 * one with admin_set_spread, and until then it must not be pickable: a pick
 * made against a line that does not exist cannot be graded, and the member
 * had no number in front of them when they made it.
 *
 * Fails closed on a missing game, like pick_locked.
 */
create or replace function public.game_has_line(p_game_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    (select spread is not null from public.games where id = p_game_id),
    false
  );
$$;

-- ---------------------------------------------------------------------------
-- 3. Helper predicates
-- ---------------------------------------------------------------------------

/*
 * Who is an admin?
 *
 * SECURITY DEFINER so the check can read `profiles` regardless of the caller's
 * own visibility into that table, and an explicit search_path so it cannot be
 * redirected. `profiles.role` is itself protected below, so a member cannot
 * promote themselves into this. (FrozenDegenerates 0008.)
 */
create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    (select p.role = 'admin' from public.profiles p where p.id = auth.uid()),
    false
  );
$$;

/*
 * Has a pick on this game closed?
 *
 * TWO conditions, either sufficient:
 *   1. the game has kicked off, or
 *   2. the week's Sunday 13:00 ET final lock has passed.
 *
 * This is the DegenNFL replacement for the NHL app's picks_revealed(week_id).
 * The per-game half is what lets Thursday night games close days before the
 * rest of the sheet, and it also handles the ~09:30 ET international games
 * with no special case.
 *
 * Lock and reveal are the SAME expression (see pick_revealed below) so the two
 * can never disagree about when a pick closes — the invariant FrozenDegenerates
 * 0003 and 0004 established between visibility and writability.
 *
 * SECURITY DEFINER: it must read `games` and `weeks` even when evaluated inside
 * a policy on `picks` for a caller whose own SELECT is restricted.
 */
create or replace function public.pick_locked(p_game_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    (
      select now() >= g.start_time or now() >= w.final_lock_at
        from public.games g
        join public.weeks w on w.id = g.week_id
       where g.id = p_game_id
    ),
    -- No such game: treat as locked. Failing closed here means a dangling
    -- game_id cannot be used to write a pick that nothing can grade.
    true
  );
$$;

/*
 * May other members see this pick yet? Same condition as the lock, by design.
 * Kept as a separate name so the two uses read clearly at the call site.
 */
create or replace function public.pick_revealed(p_game_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.pick_locked(p_game_id);
$$;

-- ---------------------------------------------------------------------------
-- 4. Triggers: derive what must not be trusted
-- ---------------------------------------------------------------------------

/*
 * Derive `season`, `week_number` and `final_lock_at` from the week `id`.
 *
 * FrozenDegenerates 0008 exists because `weeks` was writable by any member and
 * the deadline was stored rather than derived, so one UPDATE reopened a closed
 * week and let a member resubmit a perfect sheet against known results. The fix
 * was to make the deadline underivable from anything a client says. Same rule
 * here, on the new key.
 *
 * An honest caller loses nothing: the app builds the id and the week number
 * from the same value (see buildWeekId in src/lib/timezone.ts).
 */
create or replace function public.weeks_derive_from_id()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  new.season := public.season_from_id(new.id);
  new.week_number := public.week_number_from_id(new.id);
  new.final_lock_at := public.week_final_lock_at(new.week_number);

  if tg_op = 'UPDATE' and current_user in ('anon', 'authenticated') then
    if new.id is distinct from old.id
       or new.week_number is distinct from old.week_number
       or new.season is distinct from old.season
       or new.final_lock_at is distinct from old.final_lock_at then
      raise exception 'weeks: id, season, week_number and final_lock_at are not client-writable';
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists weeks_derive_from_id on public.weeks;
create trigger weeks_derive_from_id
  before insert or update on public.weeks
  for each row execute function public.weeks_derive_from_id();

/*
 * Guard the columns that decide the standings.
 *
 * FrozenDegenerates 0006 and 0007. `points_earned` and `result` are what the
 * standings are summed from, and scores plus the spread are what those are
 * computed from — so all four are service-role territory. The column grants
 * below are the primary defence; this trigger is the backstop that catches a
 * grant accidentally widened later.
 */
create or replace function public.games_guard_scoring_columns()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if current_user not in ('anon', 'authenticated') then
    return new;
  end if;

  if tg_op = 'INSERT' then
    if new.home_score is not null or new.away_score is not null
       or new.spread is not null or new.spread_captured_at is not null
       or new.status <> 'SCHEDULED' then
      raise exception 'games: scores, spread and status are not client-writable';
    end if;
  else
    raise exception 'games: rows are not client-updatable';
  end if;

  return new;
end;
$$;

drop trigger if exists games_guard_scoring_columns on public.games;
create trigger games_guard_scoring_columns
  before insert or update on public.games
  for each row execute function public.games_guard_scoring_columns();

create or replace function public.picks_guard_scoring_columns()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if current_user not in ('anon', 'authenticated') then
    return new;
  end if;

  if tg_op = 'INSERT' then
    if new.points_earned <> 0 or new.result <> 'PENDING' then
      raise exception 'picks: points_earned and result are not client-writable';
    end if;
  else
    raise exception 'picks: rows are not client-updatable; delete and re-insert via save_picks';
  end if;

  return new;
end;
$$;

drop trigger if exists picks_guard_scoring_columns on public.picks;
create trigger picks_guard_scoring_columns
  before insert or update on public.picks
  for each row execute function public.picks_guard_scoring_columns();

/*
 * profiles.role is not self-writable. (FrozenDegenerates 0001.)
 * Without this, is_admin() above is decorative.
 */
create or replace function public.profiles_guard_privileged_columns()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if current_user in ('anon', 'authenticated')
     and new.role is distinct from old.role then
    raise exception 'profiles: role is not client-writable';
  end if;
  return new;
end;
$$;

drop trigger if exists profiles_guard_privileged_columns on public.profiles;
create trigger profiles_guard_privileged_columns
  before update on public.profiles
  for each row execute function public.profiles_guard_privileged_columns();

-- ---------------------------------------------------------------------------
-- 5. Row Level Security
-- ---------------------------------------------------------------------------

alter table public.profiles enable row level security;
alter table public.weeks    enable row level security;
alter table public.games    enable row level security;
alter table public.picks    enable row level security;

-- --- profiles ---------------------------------------------------------------

drop policy if exists profiles_select_all on public.profiles;
create policy profiles_select_all
  on public.profiles for select to authenticated
  using (true); -- standings need every member's name and avatar

-- Signup inserts its own row. (FrozenDegenerates 0002.)
drop policy if exists profiles_insert_self on public.profiles;
create policy profiles_insert_self
  on public.profiles for insert to authenticated
  with check (auth.uid() = id);

drop policy if exists profiles_update_self on public.profiles;
create policy profiles_update_self
  on public.profiles for update to authenticated
  using (auth.uid() = id) with check (auth.uid() = id);

-- --- weeks ------------------------------------------------------------------

drop policy if exists weeks_select_all on public.weeks;
create policy weeks_select_all
  on public.weeks for select to authenticated using (true);

-- Seeding a week stays a normal member action: the app creates the row the
-- first time anyone opens a new week. The trigger above makes that safe.
drop policy if exists weeks_insert_authenticated on public.weeks;
create policy weeks_insert_authenticated
  on public.weeks for insert to authenticated with check (true);

-- Changing an existing week is an admin action, and reaches `status` only.
drop policy if exists weeks_update_admin on public.weeks;
create policy weeks_update_admin
  on public.weeks for update to authenticated
  using (public.is_admin()) with check (public.is_admin());

-- No DELETE policy: a deleted week would orphan its games and picks.

-- --- games ------------------------------------------------------------------

drop policy if exists games_select_all on public.games;
create policy games_select_all
  on public.games for select to authenticated using (true);

drop policy if exists games_insert_authenticated on public.games;
create policy games_insert_authenticated
  on public.games for insert to authenticated with check (true);

-- No UPDATE or DELETE policy for clients. (FrozenDegenerates 0007: `games`
-- carried `using (true)` for role `public`, so a logged-out visitor could
-- rewrite a final score and move the standings.)

-- --- picks ------------------------------------------------------------------

/*
 * Visibility. (FrozenDegenerates 0003.)
 *
 * Your own picks always; everyone else's only once that game has locked. Note
 * this is per GAME, not per week — after Thursday night everyone can see each
 * other's Thursday pick while the Sunday sheet stays hidden. That is the
 * intended behaviour of per-game locking, not a leak.
 */
drop policy if exists picks_select_visible on public.picks;
create policy picks_select_visible
  on public.picks for select to authenticated
  using (auth.uid() = user_id or public.pick_revealed(game_id));

/*
 * Writability. (FrozenDegenerates 0004, regraded to per-game.)
 *
 * The exact inverse of the visibility rule, so the two cannot disagree.
 */
drop policy if exists picks_insert_own on public.picks;
create policy picks_insert_own
  on public.picks for insert to authenticated
  with check (
    auth.uid() = user_id
    and not public.pick_locked(game_id)
    and public.game_has_line(game_id)
  );

drop policy if exists picks_delete_own on public.picks;
create policy picks_delete_own
  on public.picks for delete to authenticated
  using (auth.uid() = user_id and not public.pick_locked(game_id));

-- No UPDATE policy: picks are replaced, not edited. save_picks does that in one
-- transaction, and the guard trigger above rejects client UPDATE outright.

-- ---------------------------------------------------------------------------
-- 6. Column-level privileges
--
--    Checked BEFORE RLS runs, so these are the first line rather than the last.
--    Each grant names exactly the columns the app supplies and nothing else.
-- ---------------------------------------------------------------------------

revoke all on public.weeks    from anon, authenticated;
revoke all on public.games    from anon, authenticated;
revoke all on public.picks    from anon, authenticated;
revoke all on public.profiles from anon, authenticated;

-- Reads are open to members and gated by the RLS policies above; `anon` gets
-- nothing at all, because this pool has no public pages. Granted explicitly
-- rather than relying on Supabase's default table grants, so the schema states
-- its own intent and the local test harness exercises the real thing.
grant select on public.weeks, public.games, public.picks, public.profiles
  to authenticated;

-- The trigger derives season / week_number / final_lock_at, so the client only
-- ever needs to name the id.
grant insert (id, status) on public.weeks to authenticated;
grant update (status)     on public.weeks to authenticated;

-- Schedule columns only. Not scores, not the spread.
grant insert (week_id, espn_event_id, home_team_id, away_team_id, start_time)
  on public.games to authenticated;

-- The five pick columns. Not points_earned, not result.
grant insert (user_id, week_id, game_id, selected_team_id, confidence)
  on public.picks to authenticated;
grant delete on public.picks to authenticated;

grant insert (id, email, name, avatar) on public.profiles to authenticated;
grant update (name, avatar, updated_at) on public.profiles to authenticated;

grant insert, update, delete on public.weeks, public.games, public.picks, public.profiles
  to service_role;

-- ---------------------------------------------------------------------------
-- 7. save_picks — replace a member's sheet in one transaction
--
--    FrozenDegenerates 0005 introduced this because a delete-then-insert from
--    the client could fail between the two statements and lose a member's whole
--    sheet.
--
--    THE PER-GAME REWRITE. The NHL version deleted the entire week and
--    re-inserted it. Under per-game locking that would rewrite picks whose
--    games have already kicked off, which is exactly the attack the locks
--    exist to prevent. So this version:
--
--      1. refuses outright if the submitted sheet would change a locked pick;
--      2. replaces only the rows whose games are still open;
--      3. accepts a partial sheet — with games locking one at a time, fewer
--         than five picks is a normal intermediate state, not an error.
--
--    The week shape spans locked and unlocked rows together: once a Thursday
--    pick locks as the 3-point game, the bonus is spent for the week. The
--    picks_one_bonus_per_week index and the picks_enforce_sheet_shape trigger
--    enforce it; the pre-checks below turn those errors into readable ones.
-- ---------------------------------------------------------------------------

create or replace function public.save_picks(
  p_week_id text,
  p_picks jsonb
)
returns setof public.picks
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_ones    int;
  v_bonus   int;
begin
  if v_user_id is null then
    raise exception 'save_picks: not authenticated';
  end if;

  if jsonb_typeof(p_picks) <> 'array' then
    raise exception 'save_picks: expected an array of picks';
  end if;

  -- The submitted sheet is read straight out of the jsonb argument each time
  -- rather than staged in a temporary table. A temp table would survive between
  -- calls inside one transaction and would have to be cleared defensively; this
  -- has no state to get wrong.

  -- (0) The sheet must be internally consistent.
  --
  -- Confidence is a point value rather than a rank, so 1s repeat by design
  -- and only the 3 is scarce. Counting is deferred to (2b), where the locked
  -- rows are in view too.

  if exists (
    select 1
      from jsonb_to_recordset(p_picks) as i(game_id uuid)
     group by i.game_id having count(*) > 1
  ) then
    raise exception 'save_picks: one pick per game';
  end if;

  if exists (
    select 1
      from jsonb_to_recordset(p_picks) as i(confidence smallint)
     where i.confidence is null or i.confidence not in (1, 3)
  ) then
    raise exception 'save_picks: confidence must be 1 (ordinary) or 3 (bonus)';
  end if;

  if exists (
    select 1
      from jsonb_to_recordset(p_picks) as i(game_id uuid, selected_team_id text)
     where i.game_id is null or coalesce(i.selected_team_id, '') = ''
  ) then
    raise exception 'save_picks: every pick needs a game_id and a selected_team_id';
  end if;

  -- (1) Every submitted game must belong to this week, and the selected team
  --     must actually be playing in it. Without the first check a member could
  --     hang a pick from an open week onto a closed one's sheet; without the
  --     second they could "pick" a team on a bye and never lose.
  if exists (
    select 1
      from jsonb_to_recordset(p_picks) as i(game_id uuid, selected_team_id text)
      left join public.games g on g.id = i.game_id
     where g.id is null
        or g.week_id <> p_week_id
        or i.selected_team_id not in (g.home_team_id, g.away_team_id)
  ) then
    raise exception
      'save_picks: every pick must name a team playing in a game in week %', p_week_id;
  end if;

  -- (2) The sheet describes the caller's UNLOCKED picks. Locked ones are not
  --     the client's to send and are left exactly as they are, so a sheet that
  --     omits them is correct rather than an attempt to remove them. Resending
  --     a locked pick unchanged is tolerated (a stale tab, a retry); changing
  --     or adding one is refused.
  if exists (
    select 1
      from jsonb_to_recordset(p_picks)
             as i(game_id uuid, selected_team_id text, confidence smallint)
     where public.pick_locked(i.game_id)
       and not exists (
         select 1 from public.picks e
          where e.user_id = v_user_id
            and e.game_id = i.game_id
            and e.selected_team_id = i.selected_team_id
            and e.confidence = i.confidence
       )
  ) then
    raise exception 'save_picks: that game is locked';
  end if;

  -- (2b) The finished sheet must have the pool shape: at most four 1-point
  --      picks and at most one 3-point pick.
  --
  --      This spans locked and unlocked rows together, because the week that
  --      results from this call is the locked rows that stay plus the unlocked
  --      rows about to be written. Once a Thursday pick locks as the bonus,
  --      the 3 is spent for the week.
  --
  --      picks_enforce_sheet_shape enforces the same rule against anyone who
  --      bypasses this function; here it becomes an error the UI can show.
  select
    count(*) filter (where confidence = 1),
    count(*) filter (where confidence = 3)
    into v_ones, v_bonus
    from (
      select e.confidence
        from public.picks e
       where e.user_id = v_user_id
         and e.week_id = p_week_id
         and public.pick_locked(e.game_id)
      union all
      select i.confidence
        from jsonb_to_recordset(p_picks) as i(game_id uuid, confidence smallint)
       where not public.pick_locked(i.game_id)
    ) sheet;

  if v_bonus > 1 then
    raise exception 'save_picks: only one 3-point pick per week';
  end if;

  if v_ones > 4 then
    raise exception 'save_picks: at most four 1-point picks per week';
  end if;

  -- (2c) Every picked game must already have a line. Spreads are set on the
  --      Tuesday the week opens; a game the book never posted keeps a null
  --      spread until an admin supplies one with admin_set_spread. Picking it
  --      before then would be picking blind against a number that does not
  --      exist, and could not be graded afterwards.
  if exists (
    select 1
      from jsonb_to_recordset(p_picks) as i(game_id uuid)
     where not public.game_has_line(i.game_id)
  ) then
    raise exception 'save_picks: that game has no line yet';
  end if;

  -- (3) Replace only the still-open rows, in this transaction.
  delete from public.picks e
   where e.user_id = v_user_id
     and e.week_id = p_week_id
     and not public.pick_locked(e.game_id);

  insert into public.picks (user_id, week_id, game_id, selected_team_id, confidence)
  select v_user_id, p_week_id, i.game_id, i.selected_team_id, i.confidence
    from jsonb_to_recordset(p_picks)
           as i(game_id uuid, selected_team_id text, confidence smallint)
   where not public.pick_locked(i.game_id);

  return query
    select * from public.picks
     where user_id = v_user_id and week_id = p_week_id
     order by confidence desc;
end;
$$;

revoke all on function public.save_picks(text, jsonb) from public;
grant execute on function public.save_picks(text, jsonb) to authenticated;

comment on function public.save_picks(text, jsonb) is
  'Replaces the caller''s unlocked picks for a week in one transaction. Refuses to touch a locked pick.';

-- ---------------------------------------------------------------------------
-- admin_set_spread(game, raw line)
--
--    The escape hatch for a game the book never posted a line on. Spreads are
--    captured once, on the Tuesday the week opens, and a game whose odds were
--    OFF at that moment lands with a null spread -- which game_has_line then
--    makes unpickable until this is called.
--
--    games.spread is not client-writable by any grant, and
--    games_guard_scoring_columns rejects client writes outright. That trigger
--    exempts roles other than anon and authenticated, so a SECURITY DEFINER
--    function owned by the migration role can do this without widening a
--    single grant. The admin check is this function's own.
-- ---------------------------------------------------------------------------

create or replace function public.admin_set_spread(
  p_game_id uuid,
  p_raw_spread numeric
)
returns public.games
language plpgsql
security definer
set search_path = public
as $$
declare
  v_hooked numeric(4, 1);
  v_game   public.games;
begin
  if not exists (
    select 1 from public.profiles
     where id = auth.uid() and role = 'admin'
  ) then
    raise exception 'admin_set_spread: admins only';
  end if;

  if p_raw_spread is null or (p_raw_spread * 2) <> trunc(p_raw_spread * 2) then
    raise exception 'admin_set_spread: expected a whole or half point line, got %',
      p_raw_spread;
  end if;

  -- Mirrors hookSpread() in src/lib/scoring.ts: the half point always goes
  -- against the favourite, so the magnitude moves outward and the side is
  -- kept. A pick-em has no favourite to move against, so home lays it.
  if (abs(p_raw_spread) * 2)::int % 2 = 1 then
    v_hooked := p_raw_spread;
  elsif p_raw_spread = 0 then
    v_hooked := -0.5;
  elsif p_raw_spread < 0 then
    v_hooked := p_raw_spread - 0.5;
  else
    v_hooked := p_raw_spread + 0.5;
  end if;

  -- The 'spread is null' guard is the whole safety property: a frozen line is
  -- never moved, by an admin or by anyone else.
  update public.games
     set spread = v_hooked,
         spread_captured_at = now(),
         updated_at = now()
   where id = p_game_id
     and spread is null
  returning * into v_game;

  if v_game.id is null then
    raise exception
      'admin_set_spread: no such game, or its line is already frozen';
  end if;

  return v_game;
end;
$$;

revoke all on function public.admin_set_spread(uuid, numeric) from public;
grant execute on function public.admin_set_spread(uuid, numeric) to authenticated;

comment on function public.admin_set_spread(uuid, numeric) is
  'Admin-only. Hooks and freezes a line on a game that has none. Never overwrites a frozen line.';

commit;

-- ============================================================================
-- Verification queries. Run these after applying, before letting anyone in.
-- ============================================================================
--
-- 1. No client role can write a scoring column. Expect ZERO rows.
--
-- select grantee, table_name, column_name, privilege_type
--   from information_schema.column_privileges
--  where grantee in ('anon', 'authenticated')
--    and privilege_type in ('INSERT', 'UPDATE')
--    and (
--      (table_name = 'picks' and column_name in ('points_earned', 'result'))
--   or (table_name = 'games' and column_name in ('home_score', 'away_score', 'spread', 'spread_captured_at'))
--   or (table_name = 'weeks' and column_name in ('final_lock_at', 'week_number', 'season'))
--   or (table_name = 'profiles' and column_name = 'role')
--    );
--
-- 2. No unexpected permissive policy survives under some other name.
--
-- select tablename, policyname, cmd, roles, qual, with_check
--   from pg_policies where schemaname = 'public' order by tablename, cmd;
--
-- 3. The derived lock agrees with the app for every week. Expect 18 rows,
--    each 13:00 ET on a Sunday.
--
-- select n as week,
--        public.week_final_lock_at(n::smallint) as final_lock_at,
--        to_char(public.week_final_lock_at(n::smallint) at time zone 'America/New_York',
--                'Dy HH24:MI') as et
--   from generate_series(1, 18) n;
--
-- 4. No stored spread can produce a tie. Expect ZERO rows, always.
--
-- select id, week_id, spread from public.games
--  where spread is not null and (abs(spread) * 2)::int % 2 = 0;
