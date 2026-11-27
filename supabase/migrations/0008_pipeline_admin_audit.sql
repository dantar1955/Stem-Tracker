-- 0008_pipeline_admin_audit.sql
--
-- 1. Pipeline: opportunities entered by hand (or uploaded from the Excel
--    template) on the new Pipeline tab. The dashboard's Pipeline and
--    Awaiting PO figures come from here, and both count toward Total
--    Projected (David's decision, 2026-11-27).
-- 2. Yearly goals (revenue goal, in-our-control target), editable on the
--    Pipeline tab instead of being typed into weekly snapshots.
-- 3. Weekly snapshots are taken automatically (Mondays) so the dashboard
--    can show "vs last week".
-- 4. Suspended users: an admin can suspend a user. Their role stops
--    counting at once, so they can't change anything, and the Admin tools
--    also block them from signing in.
-- 5. Audit trail: every insert / update / delete on the app's tables is
--    recorded with who did it and the old and new values. Sign-ins,
--    sign-outs, user management, backups and imports are logged by the app
--    and the admin functions through log_app_event(). Only admins can read
--    the trail, and nobody can edit or delete it.

-- ---------------------------------------------------------------------------
-- Shared: keep updated_at current on the new tables
-- ---------------------------------------------------------------------------

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- 1. Pipeline
-- ---------------------------------------------------------------------------

do $$
begin
  if not exists (select 1 from pg_type where typname = 'pipeline_stage') then
    create type pipeline_stage as enum ('pipeline', 'awaiting_po', 'po_received', 'lost');
  end if;
end
$$;

create table if not exists public.pipeline_entries (
  id                 uuid primary key default gen_random_uuid(),
  opportunity        text not null,                          -- school or opportunity name
  stage              pipeline_stage not null default 'pipeline',
  likelihood         opportunity_likelihood,                 -- most_likely / possible
  labs_qty           integer not null default 0,
  ts_qty             integer not null default 0,
  estimated_revenue  numeric(14, 2),
  expected_po_date   date,
  production_year    integer not null default extract(year from current_date)::int,
  owner              text,
  notes              text,
  created_by         uuid references auth.users (id),
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);

create index if not exists pipeline_entries_year_stage_idx on public.pipeline_entries (production_year, stage);

drop trigger if exists pipeline_entries_set_updated_at on public.pipeline_entries;
create trigger pipeline_entries_set_updated_at
  before update on public.pipeline_entries
  for each row execute function public.set_updated_at();

alter table public.pipeline_entries enable row level security;

drop policy if exists pipeline_entries_select_all on public.pipeline_entries;
create policy pipeline_entries_select_all on public.pipeline_entries
  for select to authenticated
  using (true);

drop policy if exists pipeline_entries_write_sales_or_admin on public.pipeline_entries;
create policy pipeline_entries_write_sales_or_admin on public.pipeline_entries
  for all to authenticated
  using (public.current_user_role() in ('sales', 'admin'))
  with check (public.current_user_role() in ('sales', 'admin'));

grant select, insert, update, delete on public.pipeline_entries to authenticated;
grant all on public.pipeline_entries to service_role;

create or replace view public.v_pipeline_summary
with (security_invoker = true)
as
select
  production_year,
  sum(estimated_revenue) filter (where stage = 'pipeline')    as pipeline_total,
  count(*)               filter (where stage = 'pipeline')    as pipeline_count,
  sum(estimated_revenue) filter (where stage = 'awaiting_po') as awaiting_po_total,
  count(*)               filter (where stage = 'awaiting_po') as awaiting_po_count
from public.pipeline_entries
group by production_year;

grant select on public.v_pipeline_summary to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 2. Yearly goals
-- ---------------------------------------------------------------------------

create table if not exists public.year_goals (
  production_year        integer primary key,
  revenue_goal           numeric(14, 2),
  in_our_control_target  numeric(14, 2),
  updated_at             timestamptz not null default now()
);

drop trigger if exists year_goals_set_updated_at on public.year_goals;
create trigger year_goals_set_updated_at
  before update on public.year_goals
  for each row execute function public.set_updated_at();

alter table public.year_goals enable row level security;

drop policy if exists year_goals_select_all on public.year_goals;
create policy year_goals_select_all on public.year_goals
  for select to authenticated
  using (true);

drop policy if exists year_goals_write_sales_or_admin on public.year_goals;
create policy year_goals_write_sales_or_admin on public.year_goals
  for all to authenticated
  using (public.current_user_role() in ('sales', 'admin'))
  with check (public.current_user_role() in ('sales', 'admin'));

grant select, insert, update, delete on public.year_goals to authenticated;
grant all on public.year_goals to service_role;

-- Carry over goals already typed into weekly snapshots, if any.
insert into public.year_goals (production_year, revenue_goal, in_our_control_target)
select distinct on (extract(year from snapshot_date)::int)
  extract(year from snapshot_date)::int, revenue_goal, in_our_control_target
from public.weekly_snapshots
where revenue_goal is not null or in_our_control_target is not null
order by extract(year from snapshot_date)::int, snapshot_date desc
on conflict (production_year) do nothing;

-- ---------------------------------------------------------------------------
-- 3. Weekly snapshots of the pipeline
-- ---------------------------------------------------------------------------

-- Saves this week's Pipeline / Awaiting PO totals (dated the Monday of the
-- week). Running it again in the same week just refreshes that week's row.
create or replace function public.record_weekly_snapshot()
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_year   int  := extract(year from current_date)::int;
  v_monday date := date_trunc('week', current_date)::date;
begin
  if auth.uid() is not null and public.current_user_role() not in ('sales', 'admin') then
    raise exception 'Only Sales or Admin can save a pipeline snapshot' using errcode = '42501';
  end if;

  insert into public.weekly_snapshots (snapshot_date, pipeline_total, awaiting_po_total,
                                       revenue_goal, in_our_control_target, created_by)
  select v_monday,
         coalesce(s.pipeline_total, 0), coalesce(s.awaiting_po_total, 0),
         g.revenue_goal, g.in_our_control_target, auth.uid()
  from (select 1) one
  left join public.v_pipeline_summary s on s.production_year = v_year
  left join public.year_goals g on g.production_year = v_year
  on conflict (snapshot_date) do update set
    pipeline_total        = excluded.pipeline_total,
    awaiting_po_total     = excluded.awaiting_po_total,
    revenue_goal          = excluded.revenue_goal,
    in_our_control_target = excluded.in_our_control_target;
end;
$$;

grant execute on function public.record_weekly_snapshot() to authenticated, service_role;

-- Every Monday at 6am UTC, if pg_cron is available (it is on Supabase).
do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.unschedule(jobid) from cron.job where jobname = 'weekly-pipeline-snapshot';
    perform cron.schedule('weekly-pipeline-snapshot', '0 6 * * 1', 'select public.record_weekly_snapshot();');
  end if;
end
$$;

-- ---------------------------------------------------------------------------
-- 4. Suspended users
-- ---------------------------------------------------------------------------

alter table public.user_roles
  add column if not exists suspended boolean not null default false;

-- A suspended user has no role, so every write policy and the column
-- trigger refuse them straight away.
create or replace function public.current_user_role()
returns app_role
language sql
stable
security definer
set search_path = public
as $$
  select role from public.user_roles
  where user_id = auth.uid() and not suspended
  limit 1;
$$;

-- ---------------------------------------------------------------------------
-- 5. Audit trail
-- ---------------------------------------------------------------------------

create table if not exists public.audit_log (
  id            bigint generated always as identity primary key,
  occurred_at   timestamptz not null default now(),
  actor_id      uuid,
  actor_email   text,
  actor_name    text,
  source        text not null,      -- app | netsuite_sync | system | database
  action        text not null,      -- insert | update | delete | sign_in | user_created | ...
  table_name    text,
  record_id     text,
  record_label  text,
  changes       jsonb,
  details       jsonb
);

create index if not exists audit_log_occurred_idx on public.audit_log (occurred_at desc);
create index if not exists audit_log_actor_idx on public.audit_log (actor_id, occurred_at desc);
create index if not exists audit_log_table_idx on public.audit_log (table_name, occurred_at desc);

alter table public.audit_log enable row level security;

drop policy if exists audit_log_select_admin on public.audit_log;
create policy audit_log_select_admin on public.audit_log
  for select to authenticated
  using (public.is_admin());

-- Read-only for everyone: rows are only written by the functions below
-- (and by the admin Edge Functions, which use the service role).
revoke insert, update, delete, truncate on public.audit_log from authenticated, anon;
grant select on public.audit_log to authenticated;
grant select, insert on public.audit_log to service_role;

create or replace function public.audit_actor_label(p_user uuid, out email text, out full_name text)
language sql
stable
security definer
set search_path = public
as $$
  select (select u.email::text from auth.users u where u.id = p_user),
         (select r.full_name from public.user_roles r where r.user_id = p_user);
$$;

create or replace function public.audit_row_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_old     jsonb;
  v_new     jsonb;
  v_row     jsonb;
  v_changes jsonb := '{}'::jsonb;
  v_key     text;
  v_role    text := auth.role();
  v_actor   uuid := auth.uid();
  v_source  text;
  v_label   text;
  v_who     record;
begin
  if tg_op in ('UPDATE', 'DELETE') then v_old := to_jsonb(old); end if;
  if tg_op in ('UPDATE', 'INSERT') then v_new := to_jsonb(new); end if;
  v_row := coalesce(v_new, v_old);

  v_source := case
    when v_role = 'service_role' and tg_table_name = 'orders' then 'netsuite_sync'
    when v_role = 'service_role' then 'system'
    when v_role is null then 'database'
    else 'app'
  end;

  -- The admin Edge Functions write their own, more descriptive entries for
  -- user changes.
  if tg_table_name = 'user_roles' and v_role = 'service_role' then
    return coalesce(new, old);
  end if;

  if tg_op = 'UPDATE' then
    for v_key in select jsonb_object_keys(v_new) loop
      continue when v_key in ('updated_at', 'created_at');
      if (v_new -> v_key) is distinct from (v_old -> v_key) then
        v_changes := v_changes || jsonb_build_object(v_key, jsonb_build_object('old', v_old -> v_key, 'new', v_new -> v_key));
      end if;
    end loop;
    if v_changes = '{}'::jsonb then
      return new;               -- nothing really changed: don't log
    end if;
  elsif tg_op = 'INSERT' then
    v_changes := jsonb_strip_nulls(v_new - 'created_at' - 'updated_at');
  else
    v_changes := jsonb_strip_nulls(v_old - 'created_at' - 'updated_at');
  end if;

  v_label := case tg_table_name
    when 'orders'           then concat_ws(' · ', v_row ->> 'so_number', v_row ->> 'school')
    when 'pipeline_entries' then v_row ->> 'opportunity'
    when 'builds'           then v_row ->> 'serial_or_build_id'
    when 'shortages'        then concat_ws(' · ', v_row ->> 'so_number_text', v_row ->> 'item')
    when 'user_roles'       then coalesce(v_row ->> 'full_name', v_row ->> 'user_id')
    when 'year_goals'       then v_row ->> 'production_year'
    when 'weekly_snapshots' then v_row ->> 'snapshot_date'
    else coalesce(v_row ->> 'name', v_row ->> 'school', v_row ->> 'id')
  end;

  select * into v_who from public.audit_actor_label(v_actor);

  insert into public.audit_log (actor_id, actor_email, actor_name, source, action,
                                table_name, record_id, record_label, changes)
  values (v_actor, v_who.email, v_who.full_name, v_source, lower(tg_op),
          tg_table_name, coalesce(v_row ->> 'id', v_row ->> 'user_id', v_row ->> 'production_year'),
          nullif(v_label, ''), v_changes);

  return coalesce(new, old);
end;
$$;

do $$
declare
  t text;
begin
  foreach t in array array[
    'orders', 'builds', 'shortages', 'device_shipments', 'simulation_scenarios',
    'simulation_items', 'weekly_snapshots', 'user_roles', 'pipeline_entries', 'year_goals'
  ] loop
    execute format('drop trigger if exists %I on public.%I', t || '_audit', t);
    execute format(
      'create trigger %I after insert or update or delete on public.%I
         for each row execute function public.audit_row_change()', t || '_audit', t);
  end loop;
end
$$;

-- App events that aren't table changes: sign-in, sign-out, backup
-- downloaded, pipeline import, template downloaded, ...
create or replace function public.log_app_event(
  p_action       text,
  p_details      jsonb default '{}'::jsonb,
  p_table        text default null,
  p_record_label text default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_who record;
begin
  if auth.uid() is null then
    raise exception 'Not signed in' using errcode = '42501';
  end if;
  if p_action is null or length(p_action) > 64 then
    raise exception 'Invalid action';
  end if;

  select * into v_who from public.audit_actor_label(auth.uid());

  insert into public.audit_log (actor_id, actor_email, actor_name, source, action,
                                table_name, record_label, details)
  values (auth.uid(), v_who.email, v_who.full_name, 'app', p_action,
          p_table, p_record_label, coalesce(p_details, '{}'::jsonb));
end;
$$;

grant execute on function public.log_app_event(text, jsonb, text, text) to authenticated;
revoke execute on function public.audit_actor_label(uuid) from public, anon, authenticated;
