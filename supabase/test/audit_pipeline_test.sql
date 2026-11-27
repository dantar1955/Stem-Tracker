-- audit_pipeline_test.sql
-- Checks migration 0008: audit trail, pipeline permissions, weekly
-- snapshots and suspended users. Run after functional_test.sql (it reuses
-- that file's fixture users and test order).

\set ON_ERROR_STOP on

-- 1. An app user's change is logged with who did it and old/new values ----
truncate public.audit_log restart identity;

set role authenticated;
set request.jwt.role = 'authenticated';
set request.jwt.uid = '00000000-0000-0000-0000-000000000002';   -- sales
update public.orders set notes = 'audit check' where id = '10000000-0000-0000-0000-000000000001';
reset role;

do $$
declare r record;
begin
  select * into r from public.audit_log where table_name = 'orders' order by id desc limit 1;
  if r.actor_email is distinct from 'sales@test' or r.source <> 'app' or r.action <> 'update'
     or r.changes -> 'notes' ->> 'new' <> 'audit check' then
    raise exception 'TEST A1 FAIL -- %', row_to_json(r);
  end if;
  raise notice 'TEST A1 (app change logged with actor and old/new): PASS';
end $$;

-- 2. Saving the same value again is not logged ------------------------------
set role authenticated;
set request.jwt.role = 'authenticated';
set request.jwt.uid = '00000000-0000-0000-0000-000000000002';
update public.orders set notes = 'audit check' where id = '10000000-0000-0000-0000-000000000001';
reset role;
do $$
begin
  if (select count(*) from public.audit_log where table_name = 'orders') <> 1 then
    raise exception 'TEST A2 FAIL -- a no-op update was logged';
  end if;
  raise notice 'TEST A2 (no-op update not logged): PASS';
end $$;

-- 3. NetSuite sync (service role) and SQL Editor changes are labelled -------
set role service_role;
set request.jwt.role = 'service_role';
reset request.jwt.uid;
update public.orders set revenue = 2500 where id = '10000000-0000-0000-0000-000000000001';
reset role;
reset request.jwt.role;
update public.orders set revenue = 2600 where id = '10000000-0000-0000-0000-000000000001';
do $$
begin
  if not exists (select 1 from public.audit_log where source = 'netsuite_sync' and (changes -> 'revenue' ->> 'new')::numeric = 2500)
     or not exists (select 1 from public.audit_log where source = 'database' and (changes -> 'revenue' ->> 'new')::numeric = 2600) then
    raise exception 'TEST A3 FAIL -- sources: %', (select json_agg(source) from public.audit_log);
  end if;
  raise notice 'TEST A3 (sync and SQL Editor changes labelled): PASS';
end $$;

-- 4. Only admins can read the trail; nobody can write to it directly ---------
set role authenticated;
set request.jwt.role = 'authenticated';
set request.jwt.uid = '00000000-0000-0000-0000-000000000002';   -- sales
do $$
begin
  if (select count(*) from public.audit_log) <> 0 then
    raise exception 'TEST A4a FAIL -- sales can read the audit trail';
  end if;
  raise notice 'TEST A4a (sales cannot read audit trail): PASS';
end $$;
do $$
begin
  insert into public.audit_log (source, action) values ('app', 'forged');
  raise exception 'TEST A4b FAIL -- sales wrote to the audit trail directly';
exception when insufficient_privilege then
  raise notice 'TEST A4b (no direct writes to audit trail): PASS';
end $$;
select public.log_app_event('sign_in', '{"test": true}'::jsonb);
set request.jwt.uid = '00000000-0000-0000-0000-000000000001';   -- admin
do $$
begin
  if not exists (select 1 from public.audit_log where action = 'sign_in' and actor_email = 'sales@test') then
    raise exception 'TEST A4c FAIL -- admin cannot see the logged sign-in';
  end if;
  raise notice 'TEST A4c (log_app_event recorded, admin can read it): PASS';
end $$;
do $$
begin
  delete from public.audit_log;
  raise exception 'TEST A4d FAIL -- admin deleted audit rows';
exception when insufficient_privilege then
  raise notice 'TEST A4d (audit trail cannot be deleted): PASS';
end $$;
reset role;

-- 5. Pipeline: sales can add, operations cannot ------------------------------
set role authenticated;
set request.jwt.role = 'authenticated';
set request.jwt.uid = '00000000-0000-0000-0000-000000000002';   -- sales
insert into public.pipeline_entries (opportunity, stage, likelihood, estimated_revenue, production_year)
values ('Q950', 'awaiting_po', 'possible', 429645, extract(year from current_date)::int),
       ('31R046', 'pipeline', 'most_likely', 145426.72, extract(year from current_date)::int);
select public.record_weekly_snapshot();
set request.jwt.uid = '00000000-0000-0000-0000-000000000003';   -- operations
do $$
begin
  insert into public.pipeline_entries (opportunity) values ('should fail');
  raise exception 'TEST P1 FAIL -- operations added a pipeline entry';
exception when insufficient_privilege then
  raise notice 'TEST P1 (only sales/admin edit the pipeline): PASS';
end $$;
reset role;
do $$
declare s record;
begin
  select * into s from public.weekly_snapshots where snapshot_date = date_trunc('week', current_date)::date;
  if s.pipeline_total <> 145426.72 or s.awaiting_po_total <> 429645 then
    raise exception 'TEST P2 FAIL -- snapshot %', row_to_json(s);
  end if;
  if not exists (select 1 from public.audit_log where table_name = 'pipeline_entries' and actor_email = 'sales@test') then
    raise exception 'TEST P2 FAIL -- pipeline insert not audited';
  end if;
  raise notice 'TEST P2 (weekly snapshot totals, pipeline audited): PASS';
end $$;

-- 6. A suspended user can no longer change anything ---------------------------
update public.user_roles set suspended = true where user_id = '00000000-0000-0000-0000-000000000002';
set role authenticated;
set request.jwt.role = 'authenticated';
set request.jwt.uid = '00000000-0000-0000-0000-000000000002';
do $$
begin
  update public.orders set notes = 'suspended edit' where id = '10000000-0000-0000-0000-000000000001';
  raise exception 'TEST S1 FAIL -- suspended user edited an order';
exception when insufficient_privilege then
  raise notice 'TEST S1 (suspended user blocked): PASS';
end $$;
reset role;
update public.user_roles set suspended = false where user_id = '00000000-0000-0000-0000-000000000002';

select 'ALL AUDIT / PIPELINE TESTS PASSED' as final_result;
