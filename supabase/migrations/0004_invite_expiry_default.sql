-- ============================================================================
-- 0004_invite_expiry_default.sql
--
-- Make an invite impossible to create without an expiry.
--
-- WHY THIS EXISTS
--
-- `admin_create_invite()` gates on `is_admin()`, which reads `auth.uid()`. The
-- Supabase SQL editor runs as a superuser with no logged-in user, so there is
-- no `auth.uid()` there, `is_admin()` returns false, and the function refuses:
--
--     ERROR: admin_create_invite: admins only
--
-- That is correct behaviour for the function and a broken instruction in the
-- docs, which told admins to mint codes from the SQL editor. Until the Admin
-- panel exists there is no place where a real admin JWT is available, so the
-- documented procedure becomes a plain INSERT instead -- which the SQL editor
-- can do, being a superuser session.
--
-- The function is deliberately NOT loosened to accept a back-end connection.
-- Detecting the caller's role from inside a SECURITY DEFINER function is a trap:
-- `current_user` there is the function's OWNER, not the caller, so the obvious
-- check `current_user not in ('anon','authenticated')` is TRUE for everybody and
-- would hand invite-minting to the whole internet. A superuser session can
-- already insert directly, so the guard was never protecting anything from it.
--
-- WHAT THAT CHANGES
--
-- The 14-day expiry lived inside the function. Route admins around the function
-- and a hand-written insert that omits `expires_at` produces an uncapped code
-- that never expires -- a permanent open door, which is precisely what the
-- shared-key design depends on not existing. Codes are uncapped on purpose;
-- the expiry is the entire safety mechanism.
--
-- So the default moves onto the column, where it applies to every writer.
--
-- Run ./supabase/test/run.sh after touching this file.
-- ============================================================================

begin;

-- Any code minted before this migration through the direct-insert workaround
-- may have no expiry. Give it the standard window rather than leaving it open.
update public.invites
   set expires_at = now() + interval '14 days'
 where expires_at is null;

alter table public.invites
  alter column expires_at set default (now() + interval '14 days');

-- NOT NULL is the half that matters. The default alone still lets an explicit
-- `expires_at => null` through, and "this one code never expires" is not a
-- decision anybody should be able to make by accident. A genuinely long-lived
-- code is still possible -- pass a far-future date and mean it.
alter table public.invites
  alter column expires_at set not null;

comment on column public.invites.expires_at is
  'When the code stops working. NOT NULL and defaulted: codes are uncapped, so the expiry is the whole safety mechanism.';

commit;

-- ============================================================================
-- Verification. Run after applying.
-- ============================================================================
--
-- 1. No code is open-ended. Expect ZERO rows, always.
--
-- select code, expires_at from public.invites where expires_at is null;
--
-- 2. A hand-written insert now gets an expiry without being asked. Expect one
--    row about 14 days out, then roll it back.
--
-- begin;
-- insert into public.invites (code) values (public.generate_invite_code())
-- returning code, expires_at;
-- rollback;
