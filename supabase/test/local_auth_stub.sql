-- local_auth_stub.sql
-- NOT part of the real migration set. Stubs the pieces of Supabase's `auth`
-- schema our migrations reference (auth.users, auth.uid(), auth.role()) so
-- the real migrations can be validated against a plain local Postgres
-- instance. A real Supabase project already provides all of this -- never
-- run this file there.

do $$
begin
  if not exists (select from pg_roles where rolname = 'authenticated') then
    create role authenticated nologin;
  end if;
  if not exists (select from pg_roles where rolname = 'anon') then
    create role anon nologin;
  end if;
  if not exists (select from pg_roles where rolname = 'service_role') then
    create role service_role nologin;
  end if;
end
$$;

-- Real Supabase grants service_role BYPASSRLS; replicate that here so local
-- tests see the same behavior the NetSuite sync job relies on.
alter role service_role bypassrls;
grant authenticated, service_role to current_user;

create schema if not exists auth;

create table if not exists auth.users (
  id uuid primary key default gen_random_uuid(),
  email text
);

create or replace function auth.uid() returns uuid
language sql stable
as $$ select nullif(current_setting('request.jwt.uid', true), '')::uuid; $$;

create or replace function auth.role() returns text
language sql stable
-- Mirrors real Supabase: NULL when there is no JWT (a direct database
-- session such as the SQL Editor), not 'anon'.
as $$ select nullif(current_setting('request.jwt.role', true), ''); $$;
