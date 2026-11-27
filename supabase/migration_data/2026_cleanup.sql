-- 2026_cleanup.sql
--
-- One-time cleanup of the 2026 spreadsheet import, run after the first full
-- NetSuite pull. Safe to run more than once: every step only changes rows
-- that still need it. Run it in the Supabase SQL Editor AFTER migrations
-- 0004 and 0005.
--
--   1. Attach three sub-rows ("/", "1st SO", "2nd SO") to their parent orders.
--   2. Flag every spreadsheet order as tracked_in_sheet (production order).
--   3. For orders the sheet listed more than once, make sure NetSuite is
--      linked to the order's main row, not to the extra listing from the
--      "Shipped Labs - Partial" or "2027" sections.
--   4. Clear revenue / labs / teacher stations on those extra listings so
--      each order is counted once (their dates and notes are kept).
--   5. Move the 2027 queue (144353, 144502, 144558 and 144598's 2027 listing)
--      to production year 2027.
--   6. Show how the app's figures now compare with the spreadsheet.

-- 1. Sub-rows -----------------------------------------------------------------
update public.orders set so_number = 'SO144286',
  school = coalesce((select school from public.orders where so_number = 'SO144286' and netsuite_so_id is not null limit 1), school)
where so_number is null and school = '/';

update public.orders set so_number = 'SO144209',
  school = coalesce((select school from public.orders where so_number = 'SO144209' and netsuite_so_id is not null limit 1), school)
where so_number is null and school = '1st SO';

update public.orders set so_number = 'SO144231',
  school = coalesce((select school from public.orders where so_number = 'SO144231' and netsuite_so_id is not null limit 1), school)
where so_number is null and school = '2nd SO';

-- 2. Spreadsheet orders are production orders -----------------------------------
update public.orders set tracked_in_sheet = true
where tracked_in_sheet = false
  and (so_number is null or replace(so_number, 'SO', '') in ('139828','139836','140161','141402','141404','141515','141953','142157','142619','142914','143243','143378','143381','143927','143966','143968','143969','143974','143993','143995','144209','144210','144213','144231','144233','144284','144285','144286','144287','144288','144289','144290','144297','144299','144309','144310','144311','144312','144313','144330','144353','144358','144502','144547','144548','144558','144562','144565','144566','144574','144576','144579','144592','144593','144594','144595','144598'));

-- 3. Link NetSuite to each order's main spreadsheet row ---------------------------
do $$
declare
  m        record;
  r        record;
  v_main   uuid;
  v_linked uuid;
begin
  for m in select * from (values
    ('141402', 'device_po', 'Apple only'),
    ('144299', 'device_po', 'LEN: S202669474'),
    ('144566', 'device_po', 'LEN S202668841'),
    ('144547', 'device_po', 'S202789655'),
    ('144576', 'device_po', 'S202795740'),
    ('144598', 'sn_tag',    '2026-245-24LEN-RP')
  ) as t(so, col, val)
  loop
    v_main := null;
    v_linked := null;
    execute format(
      'select id from public.orders where replace(so_number, ''SO'', '''') = $1 and %I = $2 limit 1', m.col)
      into v_main using m.so, m.val;
    select id into v_linked from public.orders
      where replace(so_number, 'SO', '') = m.so and netsuite_so_id is not null;
    if v_main is null or v_linked is null or v_main = v_linked then
      continue;
    end if;

    select netsuite_so_id, so_number, order_date, school, revenue, labs_qty, ts_qty, doe_po
      into r from public.orders where id = v_linked;
    update public.orders set netsuite_so_id = null where id = v_linked;
    update public.orders set
      netsuite_so_id = r.netsuite_so_id, so_number = r.so_number, order_date = r.order_date,
      school = r.school, revenue = r.revenue, labs_qty = r.labs_qty, ts_qty = r.ts_qty, doe_po = r.doe_po
    where id = v_main;
    raise notice 'SO %: NetSuite now linked to the main spreadsheet row', m.so;
  end loop;
end
$$;

-- 4. Count each order once ----------------------------------------------------------
update public.orders d
set revenue = null, labs_qty = 0, ts_qty = 0,
    so_number = 'SO' || replace(d.so_number, 'SO', '')
where d.netsuite_so_id is null
  and d.so_number is not null
  and exists (
    select 1 from public.orders p
    where p.netsuite_so_id is not null
      and replace(p.so_number, 'SO', '') = replace(d.so_number, 'SO', ''))
  and (d.revenue is not null or d.labs_qty <> 0 or d.ts_qty <> 0 or d.so_number not like 'SO%');

-- 5. 2027 queue -------------------------------------------------------------------
update public.orders set production_year = 2027
where production_year <> 2027
  and (replace(so_number, 'SO', '') in ('144353', '144502', '144558')
       or (replace(so_number, 'SO', '') = '144598' and sn_tag like '2027-%'));

-- 6a. Shipped by month: app (production orders) vs spreadsheet -------------------------
with sheet(month, sheet_shipped) as (values
    ('2026-01', 480385.80),
    ('2026-02', 143270.88),
    ('2026-03', 213436.10),
    ('2026-06', 273971.24),
    ('2026-07', 1062487.04),
    ('2026-08', 1079596.55),
    ('2026-09', 1255840.92),
    ('2026-10', 446481.46),
    ('2026-11', 1228352.91)
), app as (
  select to_char(ship_date, 'YYYY-MM') as month, sum(revenue) as app_shipped
  from public.orders_computed
  where production_year = 2026 and in_production and is_shipped and revenue is not null
  group by 1
)
select coalesce(s.month, a.month) as month,
       s.sheet_shipped,
       round(a.app_shipped, 2) as app_shipped,
       round(coalesce(a.app_shipped, 0) - coalesce(s.sheet_shipped, 0), 2) as difference
from sheet s full join app a on a.month = s.month
order by 1;
