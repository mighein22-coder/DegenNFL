-- ============================================================================
-- Security tests for 0001_init.sql.
--
-- Each case plays the part of a member with nothing but the anon key and a SQL
-- console — the threat model FrozenDegenerates 0001–0008 were written against.
-- Every attack below worked at some point in that app's history. They must all
-- fail here.
--
-- Run via supabase/test/run.sh. Every line should read `ok`. A `FAIL` line is a
-- real hole, not a flaky test.
-- ============================================================================

\set ON_ERROR_STOP on
\set QUIET on
\pset tuples_only on
\pset format unaligned

begin;

-- ---------------------------------------------------------------------------
-- Assertion helpers.
--
-- `must_fail` runs a statement as the CURRENT role (it is deliberately not
-- SECURITY DEFINER) and reports whether it was rejected. The exception handler
-- gives each case its own implicit savepoint, so one blocked statement does not
-- abort the rest of the run.
-- ---------------------------------------------------------------------------
create function pg_temp.must_fail(label text, stmt text) returns text
language plpgsql as $$
begin
  execute stmt;
  return 'FAIL: ' || label || ' — statement was ALLOWED';
exception when others then
  return 'ok: ' || label;
end $$;

create function pg_temp.must_pass(label text, stmt text) returns text
language plpgsql as $$
begin
  execute stmt;
  return 'ok: ' || label;
exception when others then
  return 'FAIL: ' || label || ' — ' || sqlerrm;
end $$;

create function pg_temp.assert(label text, cond boolean) returns text
language sql as $$
  select case when cond then 'ok: ' else 'FAIL: ' end || label;
$$;

-- ---------------------------------------------------------------------------
-- Seed, with RLS bypassed — as sync-week does with the service-role key.
-- ---------------------------------------------------------------------------
insert into auth.users (id, email) values
  ('11111111-1111-1111-1111-111111111111', 'mallory@example.com'),
  ('22222222-2222-2222-2222-222222222222', 'honest@example.com');

insert into public.profiles (id, email, name, role) values
  ('11111111-1111-1111-1111-111111111111', 'mallory@example.com', 'Mallory', 'member'),
  ('22222222-2222-2222-2222-222222222222', 'honest@example.com', 'Honest', 'member');

insert into public.weeks (id) values ('week-2026-03'), ('week-2026-18');

-- One game already kicked off, one comfortably in the future. Time is driven
-- by real start_times rather than by faking now().
insert into public.games (id, week_id, home_team_id, away_team_id, start_time) values
  ('aaaaaaaa-0000-0000-0000-000000000001', 'week-2026-18', 'KC', 'DEN', now() - interval '3 hours'),
  ('aaaaaaaa-0000-0000-0000-000000000002', 'week-2026-18', 'PHI', 'DAL', now() + interval '30 days');

update public.games
   set home_score = 27, away_score = 20, status = 'FINAL',
       spread = -3.5, spread_captured_at = now()
 where id = 'aaaaaaaa-0000-0000-0000-000000000001';

-- Mallory holds a locked, already-scored pick on the finished game.
insert into public.picks
  (user_id, week_id, game_id, selected_team_id, confidence, points_earned, result)
values
  ('11111111-1111-1111-1111-111111111111', 'week-2026-18',
   'aaaaaaaa-0000-0000-0000-000000000001', 'KC', 3, 3, 'WIN'),
  ('22222222-2222-2222-2222-222222222222', 'week-2026-18',
   'aaaaaaaa-0000-0000-0000-000000000001', 'DEN', 2, 0, 'LOSS');

-- Honest has an unlocked pick, which Mallory must not be able to see.
insert into public.picks (user_id, week_id, game_id, selected_team_id, confidence)
values ('22222222-2222-2222-2222-222222222222', 'week-2026-18',
        'aaaaaaaa-0000-0000-0000-000000000002', 'DAL', 4);

-- ---------------------------------------------------------------------------
-- From here on: Mallory, an ordinary authenticated member.
-- ---------------------------------------------------------------------------
set local role authenticated;
set local request.jwt.claim.sub = '11111111-1111-1111-1111-111111111111';

\echo ''
\echo '--- weeks: the deadline must not be movable (FrozenDegenerates 0008) ---'

select pg_temp.must_fail(
  'cannot move final_lock_at',
  $$update public.weeks set final_lock_at = now() + interval '1 year'
     where id = 'week-2026-18'$$);

select pg_temp.must_fail(
  'cannot renumber a week',
  $$update public.weeks set week_number = 1 where id = 'week-2026-18'$$);

-- A non-admin UPDATE is filtered by the policy rather than rejected: zero rows
-- match, so no error is raised. Assert on the effect, not on an exception.
select pg_temp.must_pass(
  'a member''s week-status UPDATE is silently filtered, not an error',
  $$update public.weeks set status = 'COMPLETED' where id = 'week-2026-18'$$);

select pg_temp.assert(
  'the week status did not actually change',
  (select status = 'OPEN' from public.weeks where id = 'week-2026-18'));

select pg_temp.must_fail(
  'NHL-style week id is rejected',
  $$insert into public.weeks (id) values ('week-2026-10-11')$$);

select pg_temp.must_fail(
  'out-of-range week number is rejected',
  $$insert into public.weeks (id) values ('week-2026-99')$$);

select pg_temp.must_pass(
  'a member may still seed a new week',
  $$insert into public.weeks (id) values ('week-2026-05')$$);

select pg_temp.assert(
  'the seeded week derived its own lock (Sun 13:00 ET)',
  (select final_lock_at = timestamptz '2026-10-11 13:00:00-04'
     from public.weeks where id = 'week-2026-05'));

\echo ''
\echo '--- games: scores and the line must not be writable (0007) ---'

select pg_temp.must_fail(
  'cannot rewrite a final score',
  $$update public.games set home_score = 99
     where id = 'aaaaaaaa-0000-0000-0000-000000000001'$$);

select pg_temp.must_fail(
  'cannot move the line',
  $$update public.games set spread = -14.5
     where id = 'aaaaaaaa-0000-0000-0000-000000000002'$$);

select pg_temp.must_fail(
  'cannot smuggle a spread in on INSERT',
  $$insert into public.games (week_id, home_team_id, away_team_id, start_time, spread)
    values ('week-2026-18', 'SF', 'SEA', now() + interval '10 days', -1.5)$$);

select pg_temp.must_fail(
  'cannot smuggle a score in on INSERT',
  $$insert into public.games (week_id, home_team_id, away_team_id, start_time, home_score)
    values ('week-2026-18', 'SF', 'SEA', now() + interval '10 days', 40)$$);

select pg_temp.must_pass(
  'a member may still seed a schedule row',
  $$insert into public.games (week_id, home_team_id, away_team_id, start_time)
    values ('week-2026-18', 'SF', 'SEA', now() + interval '10 days')$$);

\echo ''
\echo '--- games: a whole-number spread must be unrepresentable ---'

-- Checked as the table owner, which bypasses RLS and the column grants. The
-- CHECK constraint is the only thing standing here — that is the point.
set local role postgres;

select pg_temp.must_fail(
  'whole-number spread rejected even with RLS bypassed',
  $$update public.games set spread = -3
     where id = 'aaaaaaaa-0000-0000-0000-000000000002'$$);

select pg_temp.must_fail(
  'pick-em (0) spread rejected',
  $$update public.games set spread = 0
     where id = 'aaaaaaaa-0000-0000-0000-000000000002'$$);

select pg_temp.must_pass(
  'hooked spread accepted',
  $$update public.games set spread = -3.5
     where id = 'aaaaaaaa-0000-0000-0000-000000000002'$$);

select pg_temp.must_pass(
  'a hooked positive (away-favourite) spread accepted',
  $$update public.games set spread = 6.5
     where id = 'aaaaaaaa-0000-0000-0000-000000000002'$$);

set local role authenticated;
set local request.jwt.claim.sub = '11111111-1111-1111-1111-111111111111';

\echo ''
\echo '--- picks: points must not be self-awarded (0006) ---'

select pg_temp.must_fail(
  'cannot insert a pre-won pick',
  $$insert into public.picks
      (user_id, week_id, game_id, selected_team_id, confidence, points_earned, result)
    values ('11111111-1111-1111-1111-111111111111', 'week-2026-18',
            'aaaaaaaa-0000-0000-0000-000000000002', 'PHI', 5, 5, 'WIN')$$);

select pg_temp.must_fail(
  'cannot UPDATE a pick at all',
  $$update public.picks set points_earned = 99
     where user_id = '11111111-1111-1111-1111-111111111111'$$);

select pg_temp.must_fail(
  'cannot insert a pick for somebody else',
  $$insert into public.picks (user_id, week_id, game_id, selected_team_id, confidence)
    values ('22222222-2222-2222-2222-222222222222', 'week-2026-18',
            'aaaaaaaa-0000-0000-0000-000000000002', 'PHI', 1)$$);

\echo ''
\echo '--- picks: a locked game must be untouchable (0004, per game) ---'

select pg_temp.must_fail(
  'cannot pick a game that has kicked off',
  $$insert into public.picks (user_id, week_id, game_id, selected_team_id, confidence)
    values ('11111111-1111-1111-1111-111111111111', 'week-2026-18',
            'aaaaaaaa-0000-0000-0000-000000000002', 'PHI', 3)$$);

select pg_temp.must_pass(
  'DELETE of a locked pick is silently ineffective, not an error',
  $$delete from public.picks
     where user_id = '11111111-1111-1111-1111-111111111111'
       and game_id = 'aaaaaaaa-0000-0000-0000-000000000001'$$);

select pg_temp.assert(
  'the locked pick survived that DELETE',
  (select count(*) = 1 from public.picks
    where user_id = '11111111-1111-1111-1111-111111111111'
      and game_id = 'aaaaaaaa-0000-0000-0000-000000000001'));

select pg_temp.must_pass(
  'an open game still accepts a pick',
  $$insert into public.picks (user_id, week_id, game_id, selected_team_id, confidence)
    values ('11111111-1111-1111-1111-111111111111', 'week-2026-18',
            'aaaaaaaa-0000-0000-0000-000000000002', 'PHI', 5)$$);

\echo ''
\echo '--- picks: other members stay hidden until their game locks (0003) ---'

select pg_temp.assert(
  'cannot see another member''s pick on an unlocked game',
  (select count(*) = 0 from public.picks
    where user_id = '22222222-2222-2222-2222-222222222222'
      and game_id = 'aaaaaaaa-0000-0000-0000-000000000002'));

select pg_temp.assert(
  'can see another member''s pick once that game locked',
  (select count(*) = 1 from public.picks
    where user_id = '22222222-2222-2222-2222-222222222222'
      and game_id = 'aaaaaaaa-0000-0000-0000-000000000001'));

\echo ''
\echo '--- profiles: role must not be self-granted (0001) ---'

select pg_temp.must_fail(
  'cannot self-promote to admin',
  $$update public.profiles set role = 'admin'
     where id = '11111111-1111-1111-1111-111111111111'$$);

select pg_temp.assert('is_admin() is false for a member', not public.is_admin());

select pg_temp.must_pass(
  'a member may still rename themselves',
  $$update public.profiles set name = 'Mal'
     where id = '11111111-1111-1111-1111-111111111111'$$);

\echo ''
\echo '--- save_picks (0005, rewritten for per-game locking) ---'

-- Clear the ad-hoc pick inserted above so the sheet below is the only writer.
delete from public.picks
 where user_id = '11111111-1111-1111-1111-111111111111'
   and game_id = 'aaaaaaaa-0000-0000-0000-000000000002';

select pg_temp.must_pass(
  'a partial sheet is accepted — fewer than five picks is normal here',
  $$select 1 from public.save_picks('week-2026-18', jsonb_build_array(
      jsonb_build_object('game_id', 'aaaaaaaa-0000-0000-0000-000000000002',
                         'selected_team_id', 'PHI', 'confidence', 5)))$$);

select pg_temp.assert(
  'the locked pick survived save_picks that omitted it',
  (select count(*) = 1 from public.picks
    where user_id = '11111111-1111-1111-1111-111111111111'
      and game_id = 'aaaaaaaa-0000-0000-0000-000000000001'));

select pg_temp.assert(
  'the unlocked pick was written',
  (select count(*) = 1 from public.picks
    where user_id = '11111111-1111-1111-1111-111111111111'
      and game_id = 'aaaaaaaa-0000-0000-0000-000000000002'
      and confidence = 5));

select pg_temp.must_fail(
  'cannot rewrite a locked pick through save_picks',
  $$select 1 from public.save_picks('week-2026-18', jsonb_build_array(
      jsonb_build_object('game_id', 'aaaaaaaa-0000-0000-0000-000000000001',
                         'selected_team_id', 'DEN', 'confidence', 5)))$$);

select pg_temp.must_fail(
  'cannot reuse a confidence value already locked in elsewhere',
  $$select 1 from public.save_picks('week-2026-18', jsonb_build_array(
      jsonb_build_object('game_id', 'aaaaaaaa-0000-0000-0000-000000000002',
                         'selected_team_id', 'PHI', 'confidence', 3)))$$);

select pg_temp.must_fail(
  'cannot use one confidence value twice in one sheet',
  $$select 1 from public.save_picks('week-2026-18', jsonb_build_array(
      jsonb_build_object('game_id', 'aaaaaaaa-0000-0000-0000-000000000002',
                         'selected_team_id', 'PHI', 'confidence', 5),
      jsonb_build_object('game_id', 'aaaaaaaa-0000-0000-0000-000000000003',
                         'selected_team_id', 'DAL', 'confidence', 5)))$$);

select pg_temp.must_fail(
  'cannot attach a game from another week',
  $$select 1 from public.save_picks('week-2026-03', jsonb_build_array(
      jsonb_build_object('game_id', 'aaaaaaaa-0000-0000-0000-000000000002',
                         'selected_team_id', 'PHI', 'confidence', 5)))$$);

select pg_temp.must_fail(
  'cannot pick a game that does not exist',
  $$select 1 from public.save_picks('week-2026-18', jsonb_build_array(
      jsonb_build_object('game_id', 'aaaaaaaa-0000-0000-0000-00000000dead',
                         'selected_team_id', 'PHI', 'confidence', 5)))$$);

select pg_temp.must_fail(
  'cannot use a confidence outside 1..5',
  $$select 1 from public.save_picks('week-2026-18', jsonb_build_array(
      jsonb_build_object('game_id', 'aaaaaaaa-0000-0000-0000-000000000002',
                         'selected_team_id', 'PHI', 'confidence', 9)))$$);

select pg_temp.must_pass(
  'an empty sheet is accepted',
  $$select 1 from public.save_picks('week-2026-18', '[]'::jsonb)$$);

select pg_temp.assert(
  'the empty sheet cleared the unlocked pick but kept the locked one',
  (select count(*) = 1 from public.picks
    where user_id = '11111111-1111-1111-1111-111111111111'
      and week_id = 'week-2026-18'));

\echo ''
rollback;
