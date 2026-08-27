-- ============================================================================
-- 0002_scoring_and_activation.sql
--
-- Two rule changes, and the guards they need.
--
-- 1. SCORING became four games worth 1 point and one worth 3, replacing
--    confidence 1..5. `picks.confidence` now carries a POINT VALUE rather than
--    a rank.
--
--    This could not be done without dropping unique (user_id, week_id,
--    confidence): four picks worth 1 collide on it, so the sheet was literally
--    unstorable. That constraint was quietly doing a SECOND job, though --
--    with five distinct values it capped a member at five pick rows a week.
--    Since `grant insert ... on public.picks to authenticated` means members
--    are not forced through save_picks, dropping it without a replacement
--    would let anyone POST unlimited 1-point picks straight at PostgREST.
--    picks_one_bonus_per_week and picks_enforce_sheet_shape are that
--    replacement, and they are the most important thing in this file.
--
-- 2. SPREADS are captured once, on the Tuesday the week opens, rather than at
--    each game kickoff. A spike against the live ESPN feed on 2026-08-26 found
--    odds on 48 of 48 SCHEDULED games and on 0 of 64 FINAL ones, so freezing
--    at kickoff was a race against the feed that the pool would usually lose,
--    leaving games nothing could grade.
--
--    Nothing about that changes the schema by itself, but it creates a state
--    that needs one: a game the book had OFF at capture time keeps a null
--    spread. game_has_line() makes such a game unpickable, and
--    admin_set_spread() is the only way to give it a number.
--
-- Applied after 0001_init.sql, which had already been applied to the live
-- project by the time these rules changed. Everything here is idempotent.
--
-- Run ./supabase/test/run.sh after touching this file.
-- ============================================================================

begin;

-- ---------------------------------------------------------------------------
-- 0. Refuse to run against data the new rules cannot describe.
--
--    Failing here is much kinder than failing halfway through: the constraint
--    and index below would abort anyway, but with an error naming a constraint
--    rather than the rows that need attention.
-- ---------------------------------------------------------------------------

do $$
declare
  v_bad_value int;
  v_bad_shape int;
begin
  select count(*) into v_bad_value
    from public.picks where confidence not in (1, 3);

  if v_bad_value > 0 then
    raise exception
      '0002: % pick(s) hold a confidence outside {1, 3}. Decide what each one is',
      v_bad_value
      using hint = 'A 1..5 rank does not map onto 1/3 scoring automatically. '
                   'Rewrite them deliberately, then re-run this migration.';
  end if;

  select count(*) into v_bad_shape from (
    select 1 from public.picks
     where confidence = 3
     group by user_id, week_id having count(*) > 1
  ) s;

  if v_bad_shape > 0 then
    raise exception
      '0002: % member-week(s) already hold more than one 3-point pick',
      v_bad_shape;
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 1. The point value itself.
-- ---------------------------------------------------------------------------

-- The cap-in-disguise. See the header.
alter table public.picks
  drop constraint if exists picks_user_id_week_id_confidence_key;

alter table public.picks drop constraint if exists picks_confidence_check;

-- A POINT VALUE, not a rank: four games at 1 point and one at 3. There is
-- deliberately no 2 -- see "Rules of the pool" in CLAUDE.md. The column keeps
-- its name because it is still what the idea is.
alter table public.picks
  add constraint picks_confidence_check check (confidence in (1, 3));

-- ---------------------------------------------------------------------------
-- 2. What replaces the dropped unique constraint.
-- ---------------------------------------------------------------------------

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
-- 3. A pick needs a line to be picked against.
--
--    The inverse of the visibility rule still holds; this adds one clause to
--    it. Recreated in full rather than altered, because a policy that has been
--    edited in two places is a policy nobody can read in one.
-- ---------------------------------------------------------------------------

drop policy if exists picks_insert_own on public.picks;
create policy picks_insert_own
  on public.picks for insert to authenticated
  with check (
    auth.uid() = user_id
    and not public.pick_locked(game_id)
    and public.game_has_line(game_id)
  );

-- ---------------------------------------------------------------------------
-- 4. save_picks, rewritten for the new sheet shape.
--
--    Replaces the 0001 version wholesale. The two guards that changed:
--    confidence uniqueness became a count of 1s and 3s spanning locked and
--    unlocked rows together, and every picked game must already have a line.
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
-- 5. admin_set_spread(game, raw line)
--
--    The escape hatch for a game the book never posted a line on.
--
--    games.spread is not client-writable by any grant, and
--    games_guard_scoring_columns rejects client writes outright. That trigger
--    exempts roles other than anon and authenticated, so a SECURITY DEFINER
--    function owned by the migration role can do this without widening a
--    single grant. The admin check is this function own.
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
-- 1. The old cap is gone and both replacements are in place. Expect one index
--    row and one trigger row.
--
-- select indexname from pg_indexes
--  where tablename = 'picks' and indexname = 'picks_one_bonus_per_week';
--
-- select tgname from pg_trigger
--  where tgrelid = 'public.picks'::regclass and tgname = 'picks_enforce_sheet_shape';
--
-- 2. No pick can hold a value other than 1 or 3. Expect ZERO rows, always.
--
-- select id, user_id, week_id, confidence from public.picks
--  where confidence not in (1, 3);
--
-- 3. No member-week exceeds the sheet. Expect ZERO rows, always.
--
-- select user_id, week_id,
--        count(*) filter (where confidence = 1) as ones,
--        count(*) filter (where confidence = 3) as bonus
--   from public.picks group by user_id, week_id
--  having count(*) filter (where confidence = 1) > 4
--      or count(*) filter (where confidence = 3) > 1;
--
-- 4. The scoring columns are still nobody's to write. Expect ZERO rows.
--    (Same as 0001 query 1 -- worth re-running, since this file touched
--    policies and grants.)
--
-- select grantee, table_name, column_name, privilege_type
--   from information_schema.column_privileges
--  where grantee in ('anon', 'authenticated')
--    and privilege_type in ('INSERT', 'UPDATE')
--    and table_name = 'picks'
--    and column_name in ('points_earned', 'result');
