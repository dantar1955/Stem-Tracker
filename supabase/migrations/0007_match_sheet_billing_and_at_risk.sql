-- 0007_match_sheet_billing_and_at_risk.sql
--
-- Make the dashboard use the same definitions as the STEM STATUS sheet's
-- "2026 Story" dashboard (David's decision, 2026-11-27):
--
--   Billed            = Fulfilled, Paid, Submitted or Submitted - on hold
--   Paid              = Fulfilled or Paid
--   Awaiting payment  = Submitted or Submitted - on hold
--   Shipped, not billed = shipped and not billed
--   Collected %       = Paid / Shipped (computed in the app)
--   Order counts only include rows with revenue, as in the sheet, so the
--   extra listings of an order (no revenue of their own) aren't counted.
--
-- This replaces 0006, where billed meant submitted / on hold / paid only.
--
-- Also adds at_risk: orders flagged "At Risk" (in the sheet, Bill Month =
-- "At Risk"). Like the sheet, the dashboard leaves them out of the
-- shipped / billed / scheduled figures and shows them as their own total.
-- Operations and admins can set or clear the flag.

alter table public.orders
  add column if not exists at_risk boolean not null default false;

comment on column public.orders.at_risk is
  'Order is at risk of not shipping this year (the sheet''s Bill Month = "At Risk"). Left out of the dashboard''s committed figures and shown separately.';

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
      'at_risk', 'notes'
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

drop view if exists public.v_dashboard_summary;
drop view if exists public.v_revenue_by_bill_month;
drop view if exists public.orders_computed;

create view public.orders_computed
with (security_invoker = true)
as
select
  o.*,
  (o.ship_date is not null and o.ship_date <= current_date)               as is_shipped,
  (o.ship_date is null or o.ship_date > current_date)                     as is_unshipped,
  (o.billing_status in ('fulfilled', 'paid', 'submitted', 'on_hold'))     as is_billed,
  (o.billing_status in ('fulfilled', 'paid'))                             as is_paid,
  (o.bill_month is not null)                                              as is_scheduled,
  (o.labs_qty > 0 or o.ts_qty > 0 or o.tracked_in_sheet)                  as in_production
from public.orders o;

create view public.v_revenue_by_bill_month
with (security_invoker = true)
as
select
  o.production_year,
  date_trunc('month', o.bill_month)::date as bill_month,
  sum(o.revenue) filter (where o.is_shipped) as shipped_revenue,
  sum(o.revenue) filter (where o.is_billed)  as billed_revenue,
  sum(o.revenue) filter (where o.is_paid)    as paid_revenue,
  sum(o.revenue)                             as total_revenue
from public.orders_computed o
where o.bill_month is not null and not o.at_risk
group by o.production_year, date_trunc('month', o.bill_month);

create view public.v_dashboard_summary
with (security_invoker = true)
as
select
  o.production_year,
  o.in_production,
  sum(o.revenue) filter (where not o.at_risk and o.is_shipped)                         as shipped_revenue,
  sum(o.revenue) filter (where not o.at_risk and o.is_billed)                          as billed_revenue,
  sum(o.revenue) filter (where not o.at_risk and o.is_paid)                            as paid_revenue,
  sum(o.revenue) filter (where not o.at_risk
    and o.billing_status in ('submitted', 'on_hold'))                                  as awaiting_payment_revenue,
  sum(o.revenue) filter (where not o.at_risk and o.is_shipped and not o.is_billed)     as shipped_not_billed_revenue,
  sum(o.revenue) filter (where not o.at_risk and o.is_unshipped)                       as unshipped_revenue,
  sum(o.revenue) filter (where not o.at_risk and o.is_unshipped
    and o.bill_month is not null)                                                      as scheduled_not_shipped_revenue,
  sum(o.revenue) filter (where not o.at_risk and o.is_unshipped
    and o.bill_month is null)                                                          as not_yet_scheduled_revenue,
  sum(o.revenue) filter (where o.at_risk and o.is_unshipped)                           as at_risk_revenue,
  sum(o.revenue) filter (where not o.at_risk and o.is_shipped
    and o.pcs_received is null)                                                        as delivering_without_devices_revenue,
  count(*) filter (where o.revenue is not null and not o.at_risk) as order_count,
  count(*) filter (where o.revenue is not null and not o.at_risk and o.is_shipped)                               as shipped_count,
  count(*) filter (where o.revenue is not null and not o.at_risk and o.is_billed)                                as billed_count,
  count(*) filter (where o.revenue is not null and not o.at_risk and o.is_paid)                                  as paid_count,
  count(*) filter (where o.revenue is not null and not o.at_risk and o.is_unshipped and o.bill_month is not null) as scheduled_count,
  count(*) filter (where o.revenue is not null and o.at_risk and o.is_unshipped)                                 as at_risk_count
from public.orders_computed o
group by o.production_year, o.in_production;

grant select on
  public.orders_computed, public.v_revenue_by_bill_month, public.v_dashboard_summary
  to authenticated, service_role;
