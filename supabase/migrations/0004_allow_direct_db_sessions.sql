-- 0004_allow_direct_db_sessions.sql
--
-- The column-access trigger on public.orders (0002_rls.sql) let only the
-- service_role and app users with a role through. A direct database session,
-- such as an admin running SQL in the Supabase SQL Editor, carries no app
-- user and no JWT, so auth.role() is NULL there, and the trigger rejected
-- every update with "role <NULL> is not allowed to change column ...".
--
-- Requests that come through the app's API always carry a JWT role
-- ('anon', 'authenticated' or 'service_role'), so a NULL auth.role() can only
-- be a direct database connection. Those already have full table access,
-- so the per-column check now lets them through as well. App users are
-- still checked exactly as before.

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
  -- The NetSuite sync job uses the service_role key; direct database
  -- sessions (SQL Editor, migrations) have no JWT at all. Neither is an
  -- app user, so the per-column rules below don't apply to them.
  if auth.role() = 'service_role' or auth.role() is null then
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
