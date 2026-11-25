-- 0002_rls.sql
-- Row-level security + column-level write checks, enforcing the role table
-- from the application plan: Admin (everything), Sales (sales-side order
-- fields + simulation), Operations (device/build/install/shortage/shipping
-- fields), Accounting (billing/payment fields).
--
-- The NetSuite sync job connects with the Supabase service_role key, which
-- bypasses RLS and the column-access trigger entirely (see the "service_role
-- bypass" checks below) -- it is the only writer of NetSuite-owned columns.

-- ---------------------------------------------------------------------------
-- Base grants. RLS policies narrow row access further, but Postgres also
-- requires the base table privilege -- without this, `authenticated` gets
-- "permission denied for relation" before any policy is even evaluated.
-- ---------------------------------------------------------------------------

grant usage on schema public to authenticated, service_role;

grant select, insert, update, delete
  on public.user_roles, public.orders, public.builds, public.shortages,
     public.device_shipments, public.simulation_scenarios,
     public.simulation_items, public.weekly_snapshots
  to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Helper: current user's app role
-- ---------------------------------------------------------------------------

create or replace function public.current_user_role()
returns app_role
language sql
stable
security definer
set search_path = public
as $$
  select role from public.user_roles where user_id = auth.uid() limit 1;
$$;

create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.current_user_role() = 'admin';
$$;

-- ---------------------------------------------------------------------------
-- user_roles
-- ---------------------------------------------------------------------------

alter table public.user_roles enable row level security;

create policy user_roles_select_own_or_admin on public.user_roles
  for select to authenticated
  using (user_id = auth.uid() or public.is_admin());

create policy user_roles_write_admin_only on public.user_roles
  for all to authenticated
  using (public.is_admin())
  with check (public.is_admin());

-- ---------------------------------------------------------------------------
-- orders
-- ---------------------------------------------------------------------------

alter table public.orders enable row level security;

create policy orders_select_all on public.orders
  for select to authenticated
  using (true);

-- Manual inserts (as opposed to the NetSuite sync, which uses service_role
-- and bypasses this entirely) are an admin-only escape hatch.
create policy orders_insert_admin on public.orders
  for insert to authenticated
  with check (public.is_admin());

create policy orders_delete_admin on public.orders
  for delete to authenticated
  using (public.is_admin());

-- Every role may attempt an update; which *columns* they may actually change
-- is enforced by the trigger below, not by this row policy.
create policy orders_update_all_roles on public.orders
  for update to authenticated
  using (true)
  with check (true);

create or replace function public.enforce_orders_column_access()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_role    app_role;
  v_allowed text[];
  v_col     text;
begin
  -- The NetSuite sync job and migrations use the service_role key, which
  -- bypasses RLS already; make the column check a no-op for it too so it
  -- stays the only writer of netsuite_so_id/order_date/school/revenue/etc.
  if auth.role() = 'service_role' then
    return new;
  end if;

  v_role := public.current_user_role();

  if v_role = 'admin' then
    return new;
  end if;

  v_allowed := case v_role
    when 'sales' then array['school', 'revenue', 'notes']
    when 'operations' then array[
      'device_po', 'pcs_received', 'pc_serial_number', 'ship_date',
      'install_date', 'install_status', 'elevator_steps', 'room_number',
      'teacher', 'phone', 'email', 'on_order_notes', 'sn_tag', 'status',
      'notes'
    ]
    when 'accounting' then array['billing_status', 'bill_month', 'notes']
    else array[]::text[]
  end;

  for v_col in select key from jsonb_each(to_jsonb(new)) loop
    if (to_jsonb(new) -> v_col) is distinct from (to_jsonb(old) -> v_col) then
      if not (v_col = any (v_allowed)) then
        raise exception 'role % is not allowed to change column %', v_role, v_col
          using errcode = '42501';
      end if;
    end if;
  end loop;

  return new;
end;
$$;

create trigger orders_enforce_column_access
  before update on public.orders
  for each row
  execute function public.enforce_orders_column_access();

-- ---------------------------------------------------------------------------
-- builds  (operations + admin write; everyone reads)
-- ---------------------------------------------------------------------------

alter table public.builds enable row level security;

create policy builds_select_all on public.builds
  for select to authenticated
  using (true);

create policy builds_write_ops_or_admin on public.builds
  for all to authenticated
  using (public.current_user_role() in ('operations', 'admin'))
  with check (public.current_user_role() in ('operations', 'admin'));

-- ---------------------------------------------------------------------------
-- shortages  (operations + admin write; everyone reads)
-- ---------------------------------------------------------------------------

alter table public.shortages enable row level security;

create policy shortages_select_all on public.shortages
  for select to authenticated
  using (true);

create policy shortages_write_ops_or_admin on public.shortages
  for all to authenticated
  using (public.current_user_role() in ('operations', 'admin'))
  with check (public.current_user_role() in ('operations', 'admin'));

-- ---------------------------------------------------------------------------
-- device_shipments  (operations + admin write; everyone reads)
-- ---------------------------------------------------------------------------

alter table public.device_shipments enable row level security;

create policy device_shipments_select_all on public.device_shipments
  for select to authenticated
  using (true);

create policy device_shipments_write_ops_or_admin on public.device_shipments
  for all to authenticated
  using (public.current_user_role() in ('operations', 'admin'))
  with check (public.current_user_role() in ('operations', 'admin'));

-- ---------------------------------------------------------------------------
-- simulation_scenarios / simulation_items  (sales + admin write; everyone reads)
-- ---------------------------------------------------------------------------

alter table public.simulation_scenarios enable row level security;

create policy simulation_scenarios_select_all on public.simulation_scenarios
  for select to authenticated
  using (true);

create policy simulation_scenarios_write_sales_or_admin on public.simulation_scenarios
  for all to authenticated
  using (public.current_user_role() in ('sales', 'admin'))
  with check (public.current_user_role() in ('sales', 'admin'));

alter table public.simulation_items enable row level security;

create policy simulation_items_select_all on public.simulation_items
  for select to authenticated
  using (true);

create policy simulation_items_write_sales_or_admin on public.simulation_items
  for all to authenticated
  using (public.current_user_role() in ('sales', 'admin'))
  with check (public.current_user_role() in ('sales', 'admin'));

-- ---------------------------------------------------------------------------
-- weekly_snapshots  (sales + admin write; everyone reads)
-- ---------------------------------------------------------------------------

alter table public.weekly_snapshots enable row level security;

create policy weekly_snapshots_select_all on public.weekly_snapshots
  for select to authenticated
  using (true);

create policy weekly_snapshots_write_sales_or_admin on public.weekly_snapshots
  for all to authenticated
  using (public.current_user_role() in ('sales', 'admin'))
  with check (public.current_user_role() in ('sales', 'admin'));
