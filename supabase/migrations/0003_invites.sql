-- ============================================================================
-- 0003_invites.sql
--
-- Self-serve signup, gated by invites.
--
-- THIS IS A SECURITY FIX AS MUCH AS A FEATURE. Before it, the pool was open to
-- anyone who could reach the site:
--
--   * `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` are inlined into the
--     JavaScript every visitor downloads. That is by design and they are not
--     secrets -- but they are enough to call `auth.signUp` directly.
--   * `grant insert (id, email, name, avatar) on public.profiles to
--     authenticated` plus the `profiles_insert_self` policy let any signed-in
--     user create their own profile row.
--   * A profile row IS membership. Standings read every profile, and picks are
--     foreign-keyed to one.
--
-- So with email signups enabled in the Supabase project, a stranger could sign
-- up, insert a profile, and be in the pool. The pool is played for money.
--
-- The fix is to make a profile impossible to create directly. After this
-- migration the ONLY way to get one is `redeem_invite()`, which requires a code
-- an admin generated. Creating an auth user is still open -- that is Supabase's
-- signup, and we cannot gate it from here.
--
-- AN EARLIER VERSION OF THIS FILE CLAIMED such a user "can see nothing and pick
-- nothing, because picks.user_id references profiles(id)". The pick half was
-- true; the rest was not, and an adversarial review demonstrated it. Holding
-- only an auth account, a stranger could:
--
--   * read every member's email, name and role, admin included, because
--     `profiles_select_all` was `using (true)`;
--   * insert rows into `weeks` and `games`, because both insert policies were
--     `with check (true)`.
--
-- The second is the dangerous one. `activateWeek` seeds the schedule with
-- upsert ... ignoreDuplicates on (week_id, espn_event_id), so a row squatted on
-- a real ESPN event id WINS and the genuine fixture is silently skipped. Squat
-- one with home and away reversed and every pick on that game is graded against
-- an inverted line -- with the rollover reporting no errors.
--
-- Section 0 below closes all of it. "Authenticated" and "member" are different
-- things now, and every policy has to say which one it means.
--
-- WHY REDEMPTION IS A SEPARATE STEP FROM SIGNUP
--
-- If the project has email confirmation switched on, `auth.signUp` returns no
-- session, so there is no `auth.uid()` to attach a profile to until the user
-- confirms and logs in. Redemption therefore has to be resumable rather than
-- something bolted onto the signup call: the app asks for the code again for
-- any logged-in user who has no profile yet. That also recovers a signup where
-- the code was mistyped, instead of stranding the account.
--
-- Run ./supabase/test/run.sh after touching this file.
-- ============================================================================

begin;

-- ---------------------------------------------------------------------------
-- 0. "Authenticated" is not "member".
--
--    These mirror what 0001_init.sql now creates directly, and exist as their
--    own statements so that a database which already has the looser 0001 gets
--    tightened too. On a fresh database every one of them is a no-op.
-- ---------------------------------------------------------------------------

create or replace function public.is_member()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (select 1 from public.profiles p where p.id = auth.uid());
$$;

-- The roster is for members. Not for anyone who managed to sign up.
drop policy if exists profiles_select_all on public.profiles;
create policy profiles_select_all
  on public.profiles for select to authenticated
  using (public.is_member());

-- Seeding a week is a member action.
drop policy if exists weeks_insert_authenticated on public.weeks;
create policy weeks_insert_authenticated
  on public.weeks for insert to authenticated with check (public.is_member());

-- Nobody seeds games from a browser any more; the Tuesday rollover does it
-- under the service-role key. Leaving this open let an attacker pre-empt a
-- real fixture by its ESPN event id and invert the line it is graded against.
drop policy if exists games_insert_authenticated on public.games;
revoke insert on public.games from authenticated;

-- ---------------------------------------------------------------------------
-- 1. The invites themselves.
-- ---------------------------------------------------------------------------

create table if not exists public.invites (
  -- Normalised: upper case, no punctuation. See normalise_invite_code().
  code text primary key,

  -- Optional binding. When set, only this address may redeem the code, which
  -- makes an intercepted code useless to anyone else. Stored lower case.
  email text,

  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),

  -- REQUIRED in practice: admin_create_invite defaults it to 14 days out. An
  -- uncapped code that never expires is a door left open, and the whole point
  -- of the shared key is that it closes itself without anyone remembering to
  -- close it.
  expires_at timestamptz,

  -- Set to shut a code early -- the moment everyone is in, say. Separate from
  -- deleting it, so the claims that went through it keep their reference.
  revoked_at timestamptz
);

/*
 * Who came in on which code.
 *
 * A code is REUSABLE: one key goes to the group email and everybody signs
 * themselves up with it, which is how the pool actually communicates. So a
 * claim is no longer a pair of columns on the invite row -- there are many of
 * them per code, and they need somewhere to live.
 *
 * `unique (user_id)` is the rule that survived from the single-use design and
 * still matters: one person joins once, on one code.
 *
 * Cascading on both sides is deliberate. Delete a member and their claim goes
 * with them, leaving the code itself untouched for everyone else -- which is
 * exactly what the old `claimed_by ... on delete set null` could not express,
 * and why removing a member used to fail outright.
 */
create table if not exists public.invite_claims (
  code text not null references public.invites(code) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  claimed_at timestamptz not null default now(),

  primary key (code, user_id),
  unique (user_id)
);

alter table public.invite_claims enable row level security;

revoke all on public.invite_claims from anon, authenticated;
grant select on public.invite_claims to authenticated;

-- Admins only, same as invites: who joined on which code is roster metadata,
-- not something a member needs.
drop policy if exists invite_claims_select_admin on public.invite_claims;
create policy invite_claims_select_admin
  on public.invite_claims for select to authenticated
  using (public.is_admin());


alter table public.invites enable row level security;

-- No client writes, ever. Both creating and redeeming go through SECURITY
-- DEFINER functions that check who is asking.
revoke all on public.invites from anon, authenticated;
grant select on public.invites to authenticated;

-- Admins can see outstanding invites so the Admin panel can list them. Nobody
-- else sees any row at all -- a member must not be able to read an unclaimed
-- code belonging to someone else.
drop policy if exists invites_select_admin on public.invites;
create policy invites_select_admin
  on public.invites for select to authenticated
  using (public.is_admin());

-- ---------------------------------------------------------------------------
-- 2. Close the hole: a profile is no longer self-insertable.
-- ---------------------------------------------------------------------------

-- FrozenDegenerates 0002 granted this so signup could create its own row. That
-- is exactly what an uninvited stranger would use, so redemption takes it over.
drop policy if exists profiles_insert_self on public.profiles;
revoke insert on public.profiles from authenticated;

-- NOTE FOR THE FIRST ADMIN: this also means you cannot create your own profile
-- from the app. If you do not have one yet, insert it from the SQL editor,
-- which runs as the service role:
--
--   insert into public.profiles (id, email, name, role)
--   select id, email, 'Your Name', 'admin' from auth.users where email = '...';

-- ---------------------------------------------------------------------------
-- 3. Code handling.
-- ---------------------------------------------------------------------------

/*
 * Codes are compared after stripping everything that is not a letter or digit
 * and upper-casing, so a member can type "abcd-efgh-ijkl", paste it with a
 * trailing space, or lower-case the lot, and it still works. Nothing about a
 * code should be fiddly: getting it wrong locks somebody out of a pool their
 * friends are already in.
 */
create or replace function public.normalise_invite_code(p_code text)
returns text
language sql
immutable
as $$
  select upper(regexp_replace(coalesce(p_code, ''), '[^a-zA-Z0-9]', '', 'g'));
$$;

-- The column is documented as normalised and redemption normalises what it is
-- given, but nothing stopped a hand-inserted "ABCD-EFGH-IJKL" -- which is then
-- unredeemable under any spelling. Say it as a constraint instead of a comment.
alter table public.invites drop constraint if exists invites_code_is_normalised;
alter table public.invites add constraint invites_code_is_normalised
  check (code = public.normalise_invite_code(code));

/*
 * A fresh code: 12 hex characters, 48 bits, from gen_random_uuid().
 *
 * v4 UUIDs are generated from a cryptographic source, and the first 12 hex
 * digits are all random (the version and variant bits sit later), so this is
 * not the same mistake as slicing random(). 48 bits is far past guessable for
 * a pool of a dozen people, and every code is single-use besides.
 */
create or replace function public.generate_invite_code()
returns text
language sql
volatile
as $$
  select upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 12));
$$;

-- Both helpers are called only from the SECURITY DEFINER functions below,
-- which run as the owner. Nothing needs to reach them over PostgREST, and the
-- default EXECUTE-to-PUBLIC would have let `anon` POST to /rpc/ for both.
revoke all on function public.normalise_invite_code(text) from public;
revoke all on function public.generate_invite_code() from public;

-- ---------------------------------------------------------------------------
-- 4. admin_create_invite(email?, expires_at?)
-- ---------------------------------------------------------------------------

create or replace function public.admin_create_invite(
  p_email text default null,
  p_expires_at timestamptz default null
)
returns public.invites
language plpgsql
security definer
set search_path = public
as $$
declare
  v_invite     public.invites;
  v_code       text;
  v_expires_at timestamptz;
  v_email      text := nullif(lower(trim(coalesce(p_email, ''))), '');
begin
  if not public.is_admin() then
    raise exception 'admin_create_invite: admins only';
  end if;

  if v_email is not null and v_email !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$' then
    raise exception 'admin_create_invite: % is not an email address', v_email;
  end if;

  if p_expires_at is not null and p_expires_at <= now() then
    raise exception 'admin_create_invite: expiry is already in the past';
  end if;

  -- Codes are UNCAPPED: any number of people can redeem one until it expires
  -- or is revoked. That is the point -- one key to the group email beats
  -- twelve codes and twelve messages, and it is what makes signup genuinely
  -- self-serve rather than making the admin the bottleneck.
  --
  -- Which is exactly why it must not be open-ended. An expiry is defaulted
  -- rather than demanded, so a hurried admin cannot mint a permanent door by
  -- omission. Pass one explicitly to override; pass a far-future date if you
  -- genuinely want a long-lived code.
  v_expires_at := coalesce(p_expires_at, now() + interval '14 days');

  -- Binding to an address is what makes a code PERSONAL rather than shared:
  -- uncapped means nothing when only one person may use it. So the two shapes
  -- are the same mechanism -- leave the email off for the group key, set it for
  -- a single named late joiner.
  --
  -- Refuse to invite somebody who is already in. Cheap, and it stops a second
  -- code being minted for a member who simply forgot their password.
  if v_email is not null and exists (
    select 1 from public.profiles where lower(email) = v_email
  ) then
    raise exception 'admin_create_invite: % is already a member', v_email;
  end if;

  -- No retry loop. At 48 bits the first collision is expected somewhere around
  -- sixteen million codes and this pool will mint dozens, so catching
  -- unique_violation only created a guard that cannot fire -- and one that
  -- catches by error CLASS, so adding an obvious constraint later (say, one
  -- unclaimed invite per address) would have made it loop and then report
  -- "could not generate a unique code", which would be a lie.
  v_code := public.generate_invite_code();

  insert into public.invites (code, email, created_by, expires_at)
  values (v_code, v_email, auth.uid(), v_expires_at)
  returning * into v_invite;

  return v_invite;
end;
$$;

revoke all on function public.admin_create_invite(text, timestamptz) from public;
grant execute on function public.admin_create_invite(text, timestamptz) to authenticated;

comment on function public.admin_create_invite(text, timestamptz) is
  'Admin-only. Mints a reusable invite code, expiring in 14 days unless told otherwise. Bind it to an email address to make it personal instead.';

-- ---------------------------------------------------------------------------
-- admin_revoke_invite(code)
--
--    Shut a code before its expiry. The counterpart to uncapped codes: the
--    expiry is the safety net, this is the deliberate act -- everybody is in,
--    close the door now rather than leaving it ajar for another ten days.
--
--    Claims already made are untouched. Revoking is not un-inviting.
-- ---------------------------------------------------------------------------

create or replace function public.admin_revoke_invite(p_code text)
returns public.invites
language plpgsql
security definer
set search_path = public
as $$
declare
  v_invite public.invites;
begin
  if not public.is_admin() then
    raise exception 'admin_revoke_invite: admins only';
  end if;

  update public.invites
     set revoked_at = now()
   where code = public.normalise_invite_code(p_code)
     and revoked_at is null
  returning * into v_invite;

  if v_invite.code is null then
    raise exception 'admin_revoke_invite: no such code, or it is already revoked';
  end if;

  return v_invite;
end;
$$;

revoke all on function public.admin_revoke_invite(text) from public;
grant execute on function public.admin_revoke_invite(text) to authenticated;

comment on function public.admin_revoke_invite(text) is
  'Admin-only. Closes a code early. Claims already made are unaffected.';

-- ---------------------------------------------------------------------------
-- 5. redeem_invite(code, name)
--
--    The only way a profile is created. Runs as the freshly signed-up user.
-- ---------------------------------------------------------------------------

create or replace function public.redeem_invite(
  p_code text,
  p_name text
)
returns public.profiles
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_email   text;
  v_name    text := nullif(trim(coalesce(p_name, '')), '');
  v_code    text := public.normalise_invite_code(p_code);
  v_invite  public.invites;
  v_profile public.profiles;
begin
  if v_user_id is null then
    raise exception 'redeem_invite: not authenticated';
  end if;

  if v_name is null then
    raise exception 'redeem_invite: a name is required';
  end if;

  if exists (select 1 from public.profiles where id = v_user_id) then
    raise exception 'redeem_invite: you are already a member';
  end if;

  -- The address comes from auth.users, never from the client. An email-bound
  -- invite is only worth something if the binding cannot be asserted by the
  -- person redeeming it.
  select lower(email) into v_email from auth.users where id = v_user_id;

  -- auth.users.email is nullable -- phone signup, some OAuth providers. Without
  -- this, `v_invite.email <> NULL` below evaluates to NULL rather than true,
  -- the binding check does not fire, and a bound code is redeemable by the
  -- wrong person. The only thing that stopped it was profiles.email being NOT
  -- NULL and failing one statement later, which is luck, not a rule.
  if v_email is null then
    raise exception 'redeem_invite: your account has no email address';
  end if;

  -- Still locked, though nothing about the code changes now. Two people
  -- redeeming the same group key at the same instant is the ordinary case, and
  -- both should succeed; the lock is what serialises the expiry and revocation
  -- checks against an admin revoking mid-redemption.
  select * into v_invite
    from public.invites
   where code = v_code
     for update;

  if v_invite.code is null then
    raise exception 'redeem_invite: that invite code is not valid';
  end if;

  -- No "already used" check: a code is reusable by design. What stops one
  -- PERSON using it twice is the profile check above and unique (user_id) on
  -- invite_claims, not the state of the code.
  if v_invite.revoked_at is not null then
    raise exception 'redeem_invite: that invite is no longer open';
  end if;

  if v_invite.expires_at is not null and v_invite.expires_at <= now() then
    raise exception 'redeem_invite: that invite has expired';
  end if;

  -- `is distinct from` rather than `<>`, so a NULL on either side cannot
  -- silently skip the check.
  if v_invite.email is not null and v_invite.email is distinct from v_email then
    -- Deliberately does not name the address the code is for; that would turn
    -- a leaked code into a way of harvesting who was invited.
    raise exception 'redeem_invite: that invite was issued to a different email address';
  end if;

  -- `role` is not settable here by anyone. A redeemed invite always produces a
  -- member; promoting somebody is a separate, deliberate act.
  insert into public.profiles (id, email, name)
  values (v_user_id, v_email, v_name)
  returning * into v_profile;

  insert into public.invite_claims (code, user_id)
  values (v_invite.code, v_user_id);

  return v_profile;
end;
$$;

revoke all on function public.redeem_invite(text, text) from public;
grant execute on function public.redeem_invite(text, text) to authenticated;

comment on function public.redeem_invite(text, text) is
  'Turns a valid unclaimed invite into this user''s profile. The only way a profile is created.';

commit;

-- ============================================================================
-- Verification queries. Run these after applying, before letting anyone in.
-- ============================================================================
--
-- 1. No client role can insert a profile any more. Expect ZERO rows.
--
-- select grantee, table_name, column_name, privilege_type
--   from information_schema.column_privileges
--  where grantee in ('anon', 'authenticated')
--    and table_name = 'profiles'
--    and privilege_type = 'INSERT';
--
-- 2. No INSERT policy survives on profiles under another name. Expect ZERO.
--
-- select policyname, cmd from pg_policies
--  where schemaname = 'public' and tablename = 'profiles' and cmd = 'INSERT';
--
-- 3. Every member arrived through an invite, once the pool is running. Any row
--    here is somebody whose profile predates this migration -- which should be
--    exactly the founding admin, and nobody else.
--
-- select p.id, p.email, p.role
--   from public.profiles p
--   left join public.invites i on i.claimed_by = p.id
--  where i.code is null;
--
-- 4. The permissive policies are gone. Expect ZERO rows. Re-run this one after
--    ANY migration work: applying 0001 by itself puts them back.
--
--    Note what is NOT flagged. `weeks_select_all` and `games_select_all` are
--    `using (true)` on purpose -- they are the NFL schedule, and there is
--    nothing in a fixture list worth hiding from a signed-in user. An earlier
--    draft of this query flagged them, which made it noisy AND weaker: it
--    keyed on `with_check = 'true'`, so it missed profiles_insert_self, whose
--    predicate is `auth.uid() = id`. That reads as restrictive and is exactly
--    the hole -- it lets every signed-in user make themselves a member. So the
--    rule for profiles is ANY insert policy, not a permissive one.
--
--    This matches what supabase/test/run.sh checks after re-applying 0001.
--    Keep the two in step.
--
-- select tablename, policyname, cmd, qual, with_check from pg_policies
--  where schemaname = 'public'
--    and (
--      (cmd = 'INSERT' and tablename = 'profiles')
--   or (cmd = 'INSERT' and with_check = 'true' and tablename in ('weeks', 'games'))
--   or (cmd = 'SELECT' and qual = 'true' and tablename = 'profiles')
--    );
--
-- 5. No code was claimed twice. Expect ZERO rows, always.
--
-- select claimed_by, count(*) from public.invites
--  where claimed_by is not null group by claimed_by having count(*) > 1;
