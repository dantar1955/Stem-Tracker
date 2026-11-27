-- 0006_billed_means_submitted_to_portal.sql
--
-- An order counts as billed once it has been submitted to the DOE portal:
-- billing status Submitted, On Hold (submitted, held in the portal) or Paid.
-- Fulfilled means fulfilled and ready to submit -- not billed yet.
-- Previously billed meant Fulfilled or Paid.

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
  (o.billing_status in ('submitted', 'on_hold', 'paid'))            as is_billed,
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
  sum(o.revenue) filter (where o.is_billed)                                as billed_revenue,
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
  sum(o.revenue) filter (where o.is_billed)                                 as billed_revenue,
  sum(o.revenue) filter (where o.billing_status = 'paid')                   as paid_revenue,
  sum(o.revenue) filter (where o.is_shipped and not o.is_billed)            as shipped_not_billed_revenue,
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
