-- ============================================================================
-- Security tests for the schema: 0001_init.sql plus every migration after it.
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
  ('22222222-2222-2222-2222-222222222222', 'honest@example.com'),
  ('33333333-3333-3333-3333-333333333333', 'boss@example.com'),
  ('44444444-4444-4444-4444-444444444444', 'stranger@example.com'),
  ('55555555-5555-5555-5555-555555555555', 'invited@example.com'),
  ('66666666-6666-6666-6666-666666666666', 'latecomer@example.com');

insert into public.profiles (id, email, name, role) values
  ('11111111-1111-1111-1111-111111111111', 'mallory@example.com', 'Mallory', 'member'),
  ('22222222-2222-2222-2222-222222222222', 'honest@example.com', 'Honest', 'member'),
  ('33333333-3333-3333-3333-333333333333', 'boss@example.com', 'Boss', 'admin');

insert into public.weeks (id) values ('week-2026-03'), ('week-2026-18');

-- One game already kicked off, one comfortably in the future. Time is driven
-- by real start_times rather than by faking now().
insert into public.games (id, week_id, home_team_id, away_team_id, start_time) values
  ('aaaaaaaa-0000-0000-0000-000000000001', 'week-2026-18', 'KC', 'DEN', now() - interval '3 hours'),
  ('aaaaaaaa-0000-0000-0000-000000000002', 'week-2026-18', 'PHI', 'DAL', now() + interval '30 days'),
  ('aaaaaaaa-0000-0000-0000-000000000003', 'week-2026-18', 'BUF', 'MIA', now() + interval '30 days'),
  ('aaaaaaaa-0000-0000-0000-000000000004', 'week-2026-18', 'SF', 'SEA', now() + interval '30 days'),
  ('aaaaaaaa-0000-0000-0000-000000000005', 'week-2026-18', 'GB', 'CHI', now() + interval '30 days'),
  ('aaaaaaaa-0000-0000-0000-000000000006', 'week-2026-18', 'BAL', 'PIT', now() + interval '30 days'),
  ('aaaaaaaa-0000-0000-0000-000000000007', 'week-2026-18', 'NYG', 'WSH', now() + interval '30 days'),
  ('aaaaaaaa-0000-0000-0000-000000000008', 'week-2026-18', 'LAR', 'ARI', now() - interval '3 hours');

update public.games
   set home_score = 27, away_score = 20, status = 'FINAL',
       spread = -3.5, spread_captured_at = now()
 where id = 'aaaaaaaa-0000-0000-0000-000000000001';

-- Every open game carries a line, because activation captures them all
-- together on the Tuesday the week opens. Game 7 is the exception: the book
-- had it OFF, so it has no line and game_has_line() must keep it unpickable
-- until an admin sets one.
update public.games
   set spread = -3.5, spread_captured_at = now()
 where week_id = 'week-2026-18'
   and id <> 'aaaaaaaa-0000-0000-0000-000000000007'
   and spread is null;

-- Mallory holds a locked, already-scored pick on the finished game.
insert into public.picks
  (user_id, week_id, game_id, selected_team_id, confidence, points_earned, result)
values
  ('11111111-1111-1111-1111-111111111111', 'week-2026-18',
   'aaaaaaaa-0000-0000-0000-000000000001', 'KC', 3, 3, 'WIN'),
  ('22222222-2222-2222-2222-222222222222', 'week-2026-18',
   'aaaaaaaa-0000-0000-0000-000000000001', 'DEN', 1, 0, 'LOSS');

-- Honest has an unlocked pick, which Mallory must not be able to see.
insert into public.picks (user_id, week_id, game_id, selected_team_id, confidence)
values ('22222222-2222-2222-2222-222222222222', 'week-2026-18',
        'aaaaaaaa-0000-0000-0000-000000000002', 'DAL', 1);

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
            'aaaaaaaa-0000-0000-0000-000000000002', 'PHI', 1, 1, 'WIN')$$);

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

-- NOTE: this used to name game 002, which kicks off in thirty days. It passed
-- for the wrong reason -- confidence 3 collided with the locked pick -- and so
-- would have kept passing if per-game locking broke entirely.
--
-- Game 008 has kicked off AND Mallory has no pick on it, so unique
-- (user_id, game_id) cannot stand in for the lock either. The only thing that
-- can reject this insert is pick_locked().
select pg_temp.must_fail(
  'cannot pick a game that has kicked off',
  $$insert into public.picks (user_id, week_id, game_id, selected_team_id, confidence)
    values ('11111111-1111-1111-1111-111111111111', 'week-2026-18',
            'aaaaaaaa-0000-0000-0000-000000000008', 'LAR', 1)$$);

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
            'aaaaaaaa-0000-0000-0000-000000000002', 'PHI', 1)$$);

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
                         'selected_team_id', 'PHI', 'confidence', 1)))$$);

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
      and confidence = 1));

select pg_temp.must_fail(
  'cannot rewrite a locked pick through save_picks',
  $$select 1 from public.save_picks('week-2026-18', jsonb_build_array(
      jsonb_build_object('game_id', 'aaaaaaaa-0000-0000-0000-000000000001',
                         'selected_team_id', 'DEN', 'confidence', 1)))$$);

select pg_temp.must_fail(
  'cannot claim the bonus when it is already locked in elsewhere',
  $$select 1 from public.save_picks('week-2026-18', jsonb_build_array(
      jsonb_build_object('game_id', 'aaaaaaaa-0000-0000-0000-000000000002',
                         'selected_team_id', 'PHI', 'confidence', 3)))$$);

select pg_temp.must_fail(
  'cannot put the bonus on two games in one sheet',
  $$select 1 from public.save_picks('week-2026-18', jsonb_build_array(
      jsonb_build_object('game_id', 'aaaaaaaa-0000-0000-0000-000000000002',
                         'selected_team_id', 'PHI', 'confidence', 3),
      jsonb_build_object('game_id', 'aaaaaaaa-0000-0000-0000-000000000003',
                         'selected_team_id', 'BUF', 'confidence', 3)))$$);

select pg_temp.must_fail(
  'cannot attach a game from another week',
  $$select 1 from public.save_picks('week-2026-03', jsonb_build_array(
      jsonb_build_object('game_id', 'aaaaaaaa-0000-0000-0000-000000000002',
                         'selected_team_id', 'PHI', 'confidence', 1)))$$);

select pg_temp.must_fail(
  'cannot pick a game that does not exist',
  $$select 1 from public.save_picks('week-2026-18', jsonb_build_array(
      jsonb_build_object('game_id', 'aaaaaaaa-0000-0000-0000-00000000dead',
                         'selected_team_id', 'PHI', 'confidence', 1)))$$);

select pg_temp.must_fail(
  'cannot use a point value other than 1 or 3',
  $$select 1 from public.save_picks('week-2026-18', jsonb_build_array(
      jsonb_build_object('game_id', 'aaaaaaaa-0000-0000-0000-000000000002',
                         'selected_team_id', 'PHI', 'confidence', 2)))$$);

select pg_temp.must_pass(
  'an empty sheet is accepted',
  $$select 1 from public.save_picks('week-2026-18', '[]'::jsonb)$$);

select pg_temp.assert(
  'the empty sheet cleared the unlocked pick but kept the locked one',
  (select count(*) = 1 from public.picks
    where user_id = '11111111-1111-1111-1111-111111111111'
      and week_id = 'week-2026-18'));

\echo ''
\echo '--- picks: the 4x1 + 1x3 sheet shape ---'

-- Mallory still holds her locked 3-point pick on game 001, so the bonus is
-- spent and four 1s are all the week has left.

select pg_temp.must_fail(
  'cannot put five 1-point picks on the sheet',
  $$select 1 from public.save_picks('week-2026-18', jsonb_build_array(
      jsonb_build_object('game_id', 'aaaaaaaa-0000-0000-0000-000000000002',
                         'selected_team_id', 'PHI', 'confidence', 1),
      jsonb_build_object('game_id', 'aaaaaaaa-0000-0000-0000-000000000003',
                         'selected_team_id', 'BUF', 'confidence', 1),
      jsonb_build_object('game_id', 'aaaaaaaa-0000-0000-0000-000000000004',
                         'selected_team_id', 'SF', 'confidence', 1),
      jsonb_build_object('game_id', 'aaaaaaaa-0000-0000-0000-000000000005',
                         'selected_team_id', 'GB', 'confidence', 1),
      jsonb_build_object('game_id', 'aaaaaaaa-0000-0000-0000-000000000006',
                         'selected_team_id', 'BAL', 'confidence', 1)))$$);

select pg_temp.must_pass(
  'four 1-point picks alongside the locked bonus is a full sheet',
  $$select 1 from public.save_picks('week-2026-18', jsonb_build_array(
      jsonb_build_object('game_id', 'aaaaaaaa-0000-0000-0000-000000000002',
                         'selected_team_id', 'PHI', 'confidence', 1),
      jsonb_build_object('game_id', 'aaaaaaaa-0000-0000-0000-000000000003',
                         'selected_team_id', 'BUF', 'confidence', 1),
      jsonb_build_object('game_id', 'aaaaaaaa-0000-0000-0000-000000000004',
                         'selected_team_id', 'SF', 'confidence', 1),
      jsonb_build_object('game_id', 'aaaaaaaa-0000-0000-0000-000000000005',
                         'selected_team_id', 'GB', 'confidence', 1)))$$);

select pg_temp.assert(
  'the sheet is five picks worth seven points',
  (select count(*) = 5 and sum(confidence) = 7 from public.picks
    where user_id = '11111111-1111-1111-1111-111111111111'
      and week_id = 'week-2026-18'));

-- THE ONE THAT MATTERS. INSERT on picks is granted to authenticated, so a
-- member can POST straight at PostgREST and never call save_picks. Under the
-- old schema the cap fell out of unique (user_id, week_id, confidence); with
-- four identical 1s that constraint is gone, and only
-- picks_enforce_sheet_shape stands between a member and a forty-pick week.
select pg_temp.must_fail(
  'cannot exceed the sheet by inserting directly, bypassing save_picks',
  $$insert into public.picks (user_id, week_id, game_id, selected_team_id, confidence)
    values ('11111111-1111-1111-1111-111111111111', 'week-2026-18',
            'aaaaaaaa-0000-0000-0000-000000000006', 'BAL', 1)$$);

\echo ''
\echo '--- games: a game with no line must not be pickable ---'

-- Back to just the locked bonus first. With a full sheet in place the inserts
-- below would be rejected for running out of room, and would keep passing even
-- if game_has_line() were deleted outright.
select pg_temp.must_pass(
  'clearing the sheet back to the locked pick',
  $$select 1 from public.save_picks('week-2026-18', '[]'::jsonb)$$);

select pg_temp.must_fail(
  'cannot pick a game whose line was never set',
  $$select 1 from public.save_picks('week-2026-18', jsonb_build_array(
      jsonb_build_object('game_id', 'aaaaaaaa-0000-0000-0000-000000000007',
                         'selected_team_id', 'NYG', 'confidence', 1)))$$);

select pg_temp.must_fail(
  'cannot insert a pick on a game with no line either',
  $$insert into public.picks (user_id, week_id, game_id, selected_team_id, confidence)
    values ('11111111-1111-1111-1111-111111111111', 'week-2026-18',
            'aaaaaaaa-0000-0000-0000-000000000007', 'NYG', 1)$$);

select pg_temp.must_fail(
  'a member cannot set a line with admin_set_spread',
  $$select 1 from public.admin_set_spread(
      'aaaaaaaa-0000-0000-0000-000000000007', -3)$$);

\echo ''
\echo '--- admin_set_spread: the escape hatch, admin only ---'

set local request.jwt.claim.sub = '33333333-3333-3333-3333-333333333333';

select pg_temp.must_pass(
  'an admin can set a missing line',
  $$select 1 from public.admin_set_spread(
      'aaaaaaaa-0000-0000-0000-000000000007', -3)$$);

select pg_temp.assert(
  'the line was hooked against the favourite: -3 stored as -3.5',
  (select spread = -3.5 from public.games
    where id = 'aaaaaaaa-0000-0000-0000-000000000007'));

select pg_temp.must_fail(
  'even an admin cannot move a line that is already frozen',
  $$select 1 from public.admin_set_spread(
      'aaaaaaaa-0000-0000-0000-000000000007', -7)$$);

select pg_temp.must_fail(
  'admin_set_spread refuses a quarter point',
  $$select 1 from public.admin_set_spread(
      'aaaaaaaa-0000-0000-0000-000000000006', -3.25)$$);

\echo ''
\echo '--- invites: a profile is the membership, so it must not be self-made ---'

-- Mallory is a member. She must not be able to mint herself an invite, nor
-- read anyone else's.
set local request.jwt.claim.sub = '11111111-1111-1111-1111-111111111111';

select pg_temp.must_fail(
  'a member cannot create an invite',
  $$select 1 from public.admin_create_invite('friend@example.com')$$);

select pg_temp.assert(
  'a member cannot see any invite',
  (select count(*) = 0 from public.invites));

-- THE ONE THAT MATTERS. Before 0003 this insert succeeded, and a profile row
-- IS membership -- so anyone who could reach the public anon key could sign
-- up and join a pool played for money.
set local request.jwt.claim.sub = '44444444-4444-4444-4444-444444444444';

select pg_temp.must_fail(
  'a signed-up stranger cannot insert their own profile',
  $$insert into public.profiles (id, email, name)
    values ('44444444-4444-4444-4444-444444444444', 'stranger@example.com', 'Stranger')$$);

select pg_temp.must_fail(
  'a stranger cannot redeem a code that does not exist',
  $$select 1 from public.redeem_invite('NOSUCHCODE12', 'Stranger')$$);

select pg_temp.assert(
  'and so the stranger is still not a member',
  (select count(*) = 0 from public.profiles
    where id = '44444444-4444-4444-4444-444444444444'));

\echo ''
\echo '--- invites: the admin path, and redeeming one ---'

set local request.jwt.claim.sub = '33333333-3333-3333-3333-333333333333';

create temp table pg_temp_open as
  select (public.admin_create_invite()).code as open_code;

select pg_temp.assert(
  'an admin can mint an open invite',
  (select open_code is not null from pg_temp_open));

select pg_temp.must_fail(
  'an admin cannot invite somebody who is already a member',
  $$select 1 from public.admin_create_invite('mallory@example.com')$$);

select pg_temp.must_fail(
  'an admin cannot mint an invite that has already expired',
  $$select 1 from public.admin_create_invite(null, now() - interval '1 day')$$);

-- Bind one to an address, and stash its code where the tests below can find
-- it. (A temp table, because a psql variable cannot cross a function call.)
create temp table pg_temp_codes as
  select (public.admin_create_invite('invited@example.com')).code as bound_code;

select pg_temp.assert(
  'an admin can see outstanding invites',
  (select count(*) >= 2 from public.invites));

-- The wrong person must not be able to spend an email-bound code, even
-- holding it. This is the whole point of binding.
set local request.jwt.claim.sub = '44444444-4444-4444-4444-444444444444';

select pg_temp.must_fail(
  'a bound invite cannot be redeemed by a different address',
  format($$select 1 from public.redeem_invite(%L, 'Stranger')$$,
         (select bound_code from pg_temp_codes)));

-- The right person can.
set local request.jwt.claim.sub = '55555555-5555-5555-5555-555555555555';

select pg_temp.must_fail(
  'redeeming without a name is refused',
  format($$select 1 from public.redeem_invite(%L, '   ')$$,
         (select bound_code from pg_temp_codes)));

-- Sloppy typing must still work: lower case, spaces and dashes all survive.
select pg_temp.must_pass(
  'the invited address can redeem it, typed sloppily',
  format($$select 1 from public.redeem_invite(%L, 'Invited')$$,
         lower(substr((select bound_code from pg_temp_codes), 1, 4)) || ' - ' ||
         lower(substr((select bound_code from pg_temp_codes), 5))));

select pg_temp.assert(
  'redeeming created a member, not an admin',
  (select role = 'member' and email = 'invited@example.com' from public.profiles
    where id = '55555555-5555-5555-5555-555555555555'));

-- A member cannot read `invites` at all -- that is the point of the policy --
-- so the claim has to be confirmed as the admin.
set local request.jwt.claim.sub = '33333333-3333-3333-3333-333333333333';

select pg_temp.assert(
  'the invite is now claimed',
  (select claimed_by = '55555555-5555-5555-5555-555555555555'
     and claimed_at is not null
     from public.invites
    where code = (select bound_code from pg_temp_codes)));

-- Already a member, so this is refused before the code is even looked at.
-- Passing a literal keeps that unambiguous: redeem_invite checks membership
-- first, so a valid code here would be refused for the same reason.
set local request.jwt.claim.sub = '55555555-5555-5555-5555-555555555555';

select pg_temp.must_fail(
  'an existing member cannot redeem a second invite',
  $$select 1 from public.redeem_invite('ANYCODE12345', 'Greedy')$$);

-- Now the single-use rule, tested by somebody who is neither a member nor
-- excluded by an email binding: the open code, and a brand new account. The
-- ONLY thing that can refuse this is the code already being spent.
set local request.jwt.claim.sub = '44444444-4444-4444-4444-444444444444';

select pg_temp.must_pass(
  'an open invite can be redeemed by anyone holding it',
  format($$select 1 from public.redeem_invite(%L, 'Stranger')$$,
         (select open_code from pg_temp_open)));

set local request.jwt.claim.sub = '66666666-6666-6666-6666-666666666666';

select pg_temp.must_fail(
  'the same code cannot be redeemed twice',
  format($$select 1 from public.redeem_invite(%L, 'Latecomer')$$,
         (select open_code from pg_temp_open)));

select pg_temp.assert(
  'the second claimant did not get a profile',
  (select count(*) = 0 from public.profiles
    where id = '66666666-6666-6666-6666-666666666666'));

\echo ''
rollback;
