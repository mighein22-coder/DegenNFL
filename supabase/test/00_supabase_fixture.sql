-- ============================================================================
-- Local test fixture: the parts of a Supabase project that 0001_init.sql
-- depends on but does not create.
--
-- This is NOT applied to the real project — Supabase provides all of it. It
-- exists so `supabase/test/run.sh` can apply the migration to a throwaway
-- Postgres and exercise the policies as `anon` / `authenticated`, rather than
-- shipping a migration whose guards have only ever been read.
-- ============================================================================

create extension if not exists pgcrypto;

-- The three roles Supabase connects as.
do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then
    create role anon nologin;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then
    create role authenticated nologin;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then
    create role service_role nologin bypassrls;
  end if;
end $$;

grant usage on schema public to anon, authenticated, service_role;

-- GoTrue's user table, reduced to the column 0001 references.
create schema if not exists auth;
create table if not exists auth.users (
  id uuid primary key default gen_random_uuid(),
  email text
);
grant usage on schema auth to anon, authenticated, service_role;
grant select on auth.users to authenticated, service_role;

-- auth.uid() reads the request's JWT claims. The tests set that GUC directly.
create or replace function auth.uid()
returns uuid
language sql
stable
as $$
  select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid;
$$;
grant execute on function auth.uid() to anon, authenticated, service_role;
