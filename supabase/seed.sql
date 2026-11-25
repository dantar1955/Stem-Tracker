-- seed.sql
-- Sample data for local development only. Never run this against the real
-- production project -- it creates fake schools and a fake admin role
-- assignment.
--
-- Usage (local Supabase dev stack): `supabase db reset` runs migrations
-- then this file automatically. Manually: `psql $DATABASE_URL -f supabase/seed.sql`
--
-- To see data as a real role, sign up a user through Supabase Auth locally,
-- then run:
--   insert into public.user_roles (user_id, role, full_name)
--   values ('<the auth.users id>', 'admin', 'Your Name');

insert into public.orders (netsuite_so_id, so_number, order_date, school, revenue, labs_qty, ts_qty, doe_po, ship_date, billing_status, bill_month, production_year)
values
  (900001, 'SO144501', '2026-09-01', '153M', 59278.27, 1, 0, 'DOE-1', '2026-11-20', 'fulfilled', '2026-12-01', 2026),
  (900002, 'SO144502', '2026-09-05', '479X', 202834.81, 3, 0, 'DOE-2', null, 'not_submitted', '2027-01-01', 2026),
  (900003, 'SO144503', '2026-08-15', '495X Univ Hts', 127295.00, 0, 1, 'DOE-3', '2026-10-01', 'paid', '2026-10-01', 2026)
on conflict do nothing;

insert into public.builds (order_id, bill_month, serial_or_build_id, builder_name, status, start_date, end_date)
select id, '2026-12-01', '2026-013-25LEN-LEGO-FLR-MERGE', 'Alec', 'complete', '2026-11-01', '2026-11-10'
from public.orders where so_number = 'SO144501'
on conflict do nothing;

insert into public.shortages (order_id, so_number_text, customer, item, qty, po_number, po_date, estimated_ship_date_note)
select id, 'SO144502', '479X', 'Material Station', 1, 'PO140253', '2026-11-06', 'Early December'
from public.orders where so_number = 'SO144502'
on conflict do nothing;
