-- functional_test.sql
-- Exercises the RLS + column-access trigger against a few fake users.
-- Run as a superuser against a database that already has the stub +
-- the three real migrations applied. ON_ERROR_STOP stays ON for every
-- statement expected to succeed, so a regression stops the script with a
-- visible error instead of a silently-printed "PASS".

\set ON_ERROR_STOP on

-- Fixture users -------------------------------------------------------------

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-000000000001', 'admin@test'),
  ('00000000-0000-0000-0000-000000000002', 'sales@test'),
  ('00000000-0000-0000-0000-000000000003', 'ops@test'),
  ('00000000-0000-0000-0000-000000000004', 'accounting@test')
on conflict do nothing;

insert into public.user_roles (user_id, role) values
  ('00000000-0000-0000-0000-000000000001', 'admin'),
  ('00000000-0000-0000-0000-000000000002', 'sales'),
  ('00000000-0000-0000-0000-000000000003', 'operations'),
  ('00000000-0000-0000-0000-000000000004', 'accounting')
on conflict do nothing;

insert into public.orders (id, school, production_year, revenue, netsuite_so_id)
values ('10000000-0000-0000-0000-000000000001', 'Test School', 2026, 1000, 999001)
on conflict do nothing;

-- 1. service_role bypasses the column trigger entirely -----------------------

set role service_role;
set request.jwt.role = 'service_role';
update public.orders set revenue = 2000 where id = '10000000-0000-0000-0000-000000000001';
select 'TEST 1 (service_role updates netsuite-owned revenue): PASS' as result;
reset role;

-- 2. sales may edit school/revenue/notes, not ship_date ----------------------

set role authenticated;
set request.jwt.role = 'authenticated';
set request.jwt.uid = '00000000-0000-0000-0000-000000000002';

update public.orders set notes = 'sales note' where id = '10000000-0000-0000-0000-000000000001';
select 'TEST 2a (sales updates notes): PASS' as result;

do $$
begin
  update public.orders set ship_date = current_date where id = '10000000-0000-0000-0000-000000000001';
  raise exception 'TEST 2b FAIL -- sales updated ship_date and should not have been able to';
exception when insufficient_privilege then
  raise notice 'TEST 2b (sales blocked from ship_date): PASS';
end
$$;

reset role;

-- 3. operations may edit ship_date, not billing_status -----------------------

set role authenticated;
set request.jwt.uid = '00000000-0000-0000-0000-000000000003';

update public.orders set ship_date = current_date where id = '10000000-0000-0000-0000-000000000001';
select 'TEST 3a (operations updates ship_date): PASS' as result;

do $$
begin
  update public.orders set billing_status = 'paid' where id = '10000000-0000-0000-0000-000000000001';
  raise exception 'TEST 3b FAIL -- operations updated billing_status and should not have been able to';
exception when insufficient_privilege then
  raise notice 'TEST 3b (operations blocked from billing_status): PASS';
end
$$;

reset role;

-- 4. accounting may edit billing_status, not ship_date -----------------------

set role authenticated;
set request.jwt.uid = '00000000-0000-0000-0000-000000000004';

update public.orders set billing_status = 'paid' where id = '10000000-0000-0000-0000-000000000001';
select 'TEST 4a (accounting updates billing_status): PASS' as result;

do $$
begin
  update public.orders set ship_date = current_date - 1 where id = '10000000-0000-0000-0000-000000000001';
  raise exception 'TEST 4b FAIL -- accounting updated ship_date and should not have been able to';
exception when insufficient_privilege then
  raise notice 'TEST 4b (accounting blocked from ship_date): PASS';
end
$$;

reset role;

-- 5. a non-admin authenticated user cannot manually insert an order ----------

set role authenticated;
set request.jwt.uid = '00000000-0000-0000-0000-000000000002'; -- sales

do $$
begin
  insert into public.orders (school, production_year) values ('Sneaky School', 2026);
  raise exception 'TEST 5 FAIL -- sales inserted an order and should not have been able to';
exception when insufficient_privilege then
  raise notice 'TEST 5 (sales blocked from manual insert): PASS';
end
$$;

reset role;

-- 6. admin can insert an order directly --------------------------------------

set role authenticated;
set request.jwt.uid = '00000000-0000-0000-0000-000000000001'; -- admin

insert into public.orders (school, production_year) values ('Admin Added School', 2026);
select 'TEST 6 (admin inserts order): PASS' as result;

reset role;

-- 7. dashboard + reporting views are queryable --------------------------------

set role authenticated;
set request.jwt.uid = '00000000-0000-0000-0000-000000000003';
select * from public.v_dashboard_summary;
select * from public.orders_computed limit 5;
select 'TEST 7 (views query cleanly): PASS' as result;
reset role;

select 'ALL FUNCTIONAL TESTS PASSED' as final_result;
