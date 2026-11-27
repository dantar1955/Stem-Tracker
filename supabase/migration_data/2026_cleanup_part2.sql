-- 2026_cleanup_part2.sql
--
-- Second one-time cleanup, run after migration 0007. Safe to run more than
-- once. Brings three orders in line with how the sheet's dashboard treats
-- them:
--
--   * 144594 (168X) and 144595 (363K): Bill Month "At Risk" in the sheet ->
--     flagged at_risk, so they're shown as At risk instead of
--     Not yet scheduled.
--   * 144579 (124K): Bill Month "January 2027" -> production year 2027,
--     like the rest of the January queue.
--   * 144330 (15M): billing status "Invoiced/waiting on signoffs". The sheet
--     counts it as shipped but NOT billed ("invoice these"); it was imported
--     as Submitted. Set to Not submitted and keep the original wording in
--     the notes.

update public.orders set at_risk = true
where at_risk = false
  and replace(so_number, 'SO', '') in ('144594', '144595');

update public.orders set production_year = 2027
where production_year <> 2027
  and replace(so_number, 'SO', '') = '144579';

update public.orders
set billing_status = 'not_submitted',
    notes = trim(both ' ' from coalesce(notes, '') || ' [Billing: Invoiced/waiting on signoffs]')
where replace(so_number, 'SO', '') = '144330'
  and netsuite_so_id is not null
  and billing_status = 'submitted';

-- Dashboard figures for 2026 production orders after the cleanup.
select
  round(shipped_revenue) as shipped,
  shipped_count as shipped_orders,
  round(billed_revenue) as billed,
  billed_count as billed_orders,
  round(paid_revenue) as paid,
  paid_count as paid_orders,
  round(awaiting_payment_revenue) as awaiting_payment,
  round(shipped_not_billed_revenue) as shipped_not_billed,
  round(scheduled_not_shipped_revenue) as scheduled,
  scheduled_count as scheduled_orders,
  round(not_yet_scheduled_revenue) as not_yet_scheduled,
  round(at_risk_revenue) as at_risk
from public.v_dashboard_summary
where production_year = 2026 and in_production;
