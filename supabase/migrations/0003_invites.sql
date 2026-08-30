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
-- signup, and we cannot gate it from here -- but an auth user with no profile
-- can see nothing and pick nothing: `picks.user_id` references `profiles(id)`,
-- so the foreign key refuses.
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

  -- Optional. A code with no expiry is valid until used.
  expires_at timestamptz,

  claimed_by uuid references public.profiles(id) on delete set null,
  claimed_at timestamptz,

  -- Claimed is both columns or neither; half a claim is not a state.
  constraint invites_claim_is_complete
    check ((claimed_by is null) = (claimed_at is null)),

  -- One invite per person. Re-redeeming is refused by redeem_invite anyway,
  -- but this makes a second claim impossible rather than merely rejected.
  unique (claimed_by)
);

create index if not exists invites_unclaimed_idx
  on public.invites (email) where claimed_by is null;

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
  v_invite public.invites;
  v_code   text;
  v_email  text := nullif(lower(trim(coalesce(p_email, ''))), '');
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

  -- Refuse to invite somebody who is already in. Cheap, and it stops a second
  -- code being minted for a member who simply forgot their password.
  if v_email is not null and exists (
    select 1 from public.profiles where lower(email) = v_email
  ) then
    raise exception 'admin_create_invite: % is already a member', v_email;
  end if;

  -- Collisions at 48 bits are vanishing, but a retry costs nothing and a
  -- primary-key error in an admin's face costs a support conversation.
  for i in 1..5 loop
    v_code := public.generate_invite_code();
    begin
      insert into public.invites (code, email, created_by, expires_at)
      values (v_code, v_email, auth.uid(), p_expires_at)
      returning * into v_invite;
      return v_invite;
    exception when unique_violation then
      -- try again
    end;
  end loop;

  raise exception 'admin_create_invite: could not generate a unique code';
end;
$$;

revoke all on function public.admin_create_invite(text, timestamptz) from public;
grant execute on function public.admin_create_invite(text, timestamptz) to authenticated;

comment on function public.admin_create_invite(text, timestamptz) is
  'Admin-only. Mints a single-use invite code, optionally bound to one email address.';

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

  -- Lock the row: two tabs redeeming the same code must not both win.
  select * into v_invite
    from public.invites
   where code = v_code
     for update;

  if v_invite.code is null then
    raise exception 'redeem_invite: that invite code is not valid';
  end if;

  if v_invite.claimed_by is not null then
    raise exception 'redeem_invite: that invite has already been used';
  end if;

  if v_invite.expires_at is not null and v_invite.expires_at <= now() then
    raise exception 'redeem_invite: that invite has expired';
  end if;

  if v_invite.email is not null and v_invite.email <> v_email then
    -- Deliberately does not name the address the code is for; that would turn
    -- a leaked code into a way of harvesting who was invited.
    raise exception 'redeem_invite: that invite was issued to a different email address';
  end if;

  -- `role` is not settable here by anyone. A redeemed invite always produces a
  -- member; promoting somebody is a separate, deliberate act.
  insert into public.profiles (id, email, name)
  values (v_user_id, v_email, v_name)
  returning * into v_profile;

  update public.invites
     set claimed_by = v_user_id,
         claimed_at = now()
   where code = v_invite.code;

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
-- 4. No code was claimed twice. Expect ZERO rows, always.
--
-- select claimed_by, count(*) from public.invites
--  where claimed_by is not null group by claimed_by having count(*) > 1;
