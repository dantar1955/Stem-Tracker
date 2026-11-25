-- 0003_views.sql
-- Computed views replacing the spreadsheet's formula columns and the
-- cross-sheet rollups (STEM Analytics, 2026 Billing, Overview's "Where We
-- Are" section). Views inherit RLS from their underlying tables via
-- security_invoker, so they're safe to query directly from the frontend.

-- ---------------------------------------------------------------------------
-- orders_computed: the sheet's calculated columns (Shipped, Billed, Paid,
-- Unshipped, Scheduled), computed the same way every time.
-- ---------------------------------------------------------------------------

create view public.orders_computed
with (security_invoker = true)
as
select
  o.*,
  (o.ship_date is not null and o.ship_date <= current_date) as is_shipped,
  (o.ship_date is null)                                     as is_unshipped,
  (o.billing_status in ('fulfilled', 'paid'))                as is_billed,
  (o.billing_status = 'paid')                                 as is_paid,
  (o.bill_month is not null)                                  as is_scheduled
from public.orders o;

-- ---------------------------------------------------------------------------
-- builds_computed: Lab vs TS (from the build id), and the device-received
-- flag -- a direct join on order_id instead of the sheet's
-- COUNTIFS(school, bill_month, "yes*") text match.
-- ---------------------------------------------------------------------------

create view public.builds_computed
with (security_invoker = true)
as
select
  b.*,
  o.school,
  o.production_year,
  (b.serial_or_build_id ilike '%-mts%')   as is_teacher_station,
  (o.pcs_received is not null)            as device_received
from public.builds b
join public.orders o on o.id = b.order_id;

-- ---------------------------------------------------------------------------
-- v_builds_monthly_rollup: replaces STEM Analytics' "Labs Built & Build
-- Capacity" rollup, across every production year at once.
-- ---------------------------------------------------------------------------

create view public.v_builds_monthly_rollup
with (security_invoker = true)
as
select
  o.production_year,
  date_trunc('month', b.end_date)::date as build_month,
  (case when b.serial_or_build_id ilike '%-mts%' then 'ts' else 'lab' end) as build_type,
  count(*) filter (where b.status = 'complete') as builds_complete,
  count(*) as builds_total
from public.builds b
join public.orders o on o.id = b.order_id
where b.end_date is not null
group by o.production_year, date_trunc('month', b.end_date),
  (case when b.serial_or_build_id ilike '%-mts%' then 'ts' else 'lab' end);

-- ---------------------------------------------------------------------------
-- v_revenue_by_bill_month: replaces 2026 Billing's YTD rollups, across years.
-- ---------------------------------------------------------------------------

create view public.v_revenue_by_bill_month
with (security_invoker = true)
as
select
  o.production_year,
  date_trunc('month', o.bill_month)::date as bill_month,
  sum(o.revenue) filter (where o.ship_date is not null)                     as shipped_revenue,
  sum(o.revenue) filter (where o.billing_status in ('fulfilled', 'paid'))   as billed_revenue,
  sum(o.revenue) filter (where o.billing_status = 'paid')                  as paid_revenue,
  sum(o.revenue)                                                            as total_revenue
from public.orders o
where o.bill_month is not null
group by o.production_year, date_trunc('month', o.bill_month);

-- ---------------------------------------------------------------------------
-- v_dashboard_summary: the Overview dashboard's live figures (everything
-- except the hand-entered weekly snapshot, which comes from weekly_snapshots).
-- ---------------------------------------------------------------------------

create view public.v_dashboard_summary
with (security_invoker = true)
as
select
  o.production_year,
  sum(o.revenue) filter (where o.ship_date is not null)                   as shipped_revenue,
  sum(o.revenue) filter (where o.billing_status in ('fulfilled', 'paid')) as billed_revenue,
  sum(o.revenue) filter (where o.billing_status = 'paid')                as paid_revenue,
  sum(o.revenue) filter (where o.ship_date is not null
    and o.billing_status not in ('fulfilled', 'paid'))                   as shipped_not_billed_revenue,
  sum(o.revenue) filter (where o.ship_date is null)                      as unshipped_revenue,
  sum(o.revenue) filter (where o.ship_date is null
    and o.bill_month is not null)                                        as scheduled_not_shipped_revenue,
  sum(o.revenue) filter (where o.ship_date is null
    and o.bill_month is null)                                            as not_yet_scheduled_revenue,
  sum(o.revenue) filter (where o.ship_date is not null
    and o.pcs_received is null)                                          as delivering_without_devices_revenue,
  count(*) as order_count
from public.orders o
group by o.production_year;

-- Views run with security_invoker, so the querying role still needs SELECT.
grant select on
  public.orders_computed, public.builds_computed,
  public.v_builds_monthly_rollup, public.v_revenue_by_bill_month,
  public.v_dashboard_summary
  to authenticated, service_role;
