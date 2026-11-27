-- 0005_production_scope_and_shipped_rule.sql
--
-- 1. tracked_in_sheet: marks orders carried over from the STEM STATUS
--    spreadsheet. Together with lab / teacher-station quantities it decides
--    which orders count as "production" orders -- the default view on the
--    Orders page and Dashboard. Every NetSuite sales order is still stored;
--    non-production orders (SnappyXO, iPad-only deals, ...) appear when
--    "Show all orders" is switched on.
--
-- 2. "Shipped" now means the ship date is today or earlier. The dashboard
--    previously counted any order with a ship date as shipped, including
--    orders scheduled to ship in the future.
--
-- 3. The dashboard summary is split by in_production so the app can show
--    production-only or all-order totals.

alter table public.orders
  add column if not exists tracked_in_sheet boolean not null default false;

comment on column public.orders.tracked_in_sheet is
  'True for orders imported from the STEM STATUS spreadsheet. Counts as a production order even if NetSuite shows no lab or teacher-station items.';

drop view if exists public.v_dashboard_summary;
drop view if exists public.v_revenue_by_bill_month;
drop view if exists public.orders_computed;

create view public.orders_computed
with (security_invoker = true)
as
select
  o.*,
  (o.ship_date is not null and o.ship_date <= current_date)          as is_shipped,
  (o.ship_date is null or o.ship_date > current_date)                as is_unshipped,
  (o.billing_status in ('fulfilled', 'paid'))                        as is_billed,
  (o.billing_status = 'paid')                                        as is_paid,
  (o.bill_month is not null)                                         as is_scheduled,
  (o.labs_qty > 0 or o.ts_qty > 0 or o.tracked_in_sheet)             as in_production
from public.orders o;

create view public.v_revenue_by_bill_month
with (security_invoker = true)
as
select
  o.production_year,
  date_trunc('month', o.bill_month)::date as bill_month,
  sum(o.revenue) filter (where o.is_shipped)                                as shipped_revenue,
  sum(o.revenue) filter (where o.billing_status in ('fulfilled', 'paid'))   as billed_revenue,
  sum(o.revenue) filter (where o.billing_status = 'paid')                  as paid_revenue,
  sum(o.revenue)                                                            as total_revenue
from public.orders_computed o
where o.bill_month is not null
group by o.production_year, date_trunc('month', o.bill_month);

create view public.v_dashboard_summary
with (security_invoker = true)
as
select
  o.production_year,
  o.in_production,
  sum(o.revenue) filter (where o.is_shipped)                                 as shipped_revenue,
  sum(o.revenue) filter (where o.billing_status in ('fulfilled', 'paid'))    as billed_revenue,
  sum(o.revenue) filter (where o.billing_status = 'paid')                   as paid_revenue,
  sum(o.revenue) filter (where o.is_shipped
    and o.billing_status not in ('fulfilled', 'paid'))                      as shipped_not_billed_revenue,
  sum(o.revenue) filter (where o.is_unshipped)                              as unshipped_revenue,
  sum(o.revenue) filter (where o.is_unshipped and o.bill_month is not null) as scheduled_not_shipped_revenue,
  sum(o.revenue) filter (where o.is_unshipped and o.bill_month is null)     as not_yet_scheduled_revenue,
  sum(o.revenue) filter (where o.is_shipped and o.pcs_received is null)     as delivering_without_devices_revenue,
  count(*)                                                                  as order_count
from public.orders_computed o
group by o.production_year, o.in_production;

grant select on
  public.orders_computed, public.v_revenue_by_bill_month, public.v_dashboard_summary
  to authenticated, service_role;
