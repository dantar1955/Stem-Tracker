-- 0001_schema.sql
-- Core schema for the STEM Production Tracker.
-- Replaces: STEM STATUS 2024-2026.xlsx (2026 Production / Simple View / STEM Build /
-- Shortages / Device Shipping / Simulation / Overview's weekly snapshot inputs).

create extension if not exists "pgcrypto";

-- ---------------------------------------------------------------------------
-- Roles
-- ---------------------------------------------------------------------------

create type app_role as enum ('admin', 'sales', 'operations', 'accounting');

-- One row per application user, linking to Supabase Auth's auth.users.
create table public.user_roles (
  user_id    uuid primary key references auth.users (id) on delete cascade,
  role       app_role not null,
  full_name  text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.user_roles is
  'Maps an authenticated user to exactly one app role (admin/sales/operations/accounting).';

-- ---------------------------------------------------------------------------
-- Orders  (replaces: 2026 Production / Simple View; one row per school sales order)
-- ---------------------------------------------------------------------------

create type billing_status as enum ('not_submitted', 'submitted', 'fulfilled', 'paid', 'on_hold');
create type install_status as enum ('not_installed', 'installed');
create type order_status as enum (
  'new',                 -- order just synced from NetSuite, nothing entered yet
  'device_ordered',
  'ready_to_ship',
  'shipped',
  'delivered_installed',
  'pending_billing'
);

create table public.orders (
  id                 uuid primary key default gen_random_uuid(),

  -- NetSuite-owned fields (written only by the scheduled sync job / service_role).
  netsuite_so_id     bigint unique,              -- NetSuite internal id of the sales order
  so_number          text,                        -- human-readable S/O # (e.g. "SO144548")
                                                   -- NOT unique: real historical data has a
                                                   -- handful of sales orders split across more
                                                   -- than one tracked row (e.g. separate device
                                                   -- shipments under one SO), so this is
                                                   -- intentionally many-to-one, not 1:1.
  order_date         date,
  school             text not null,
  revenue            numeric(12, 2),
  labs_qty           integer not null default 0,
  ts_qty             integer not null default 0,
  doe_po             text,

  -- Manually entered as the order progresses (owners noted per column group below).

  -- Sales-owned (corrections when NetSuite is wrong):
  -- school, revenue above; sales may also edit `notes`.

  -- Operations-owned:
  device_po          text,
  pcs_received       date,                       -- date devices were received ("PCS Rec")
  pc_serial_number   text,
  ship_date          date,
  install_date       date,
  install_status     install_status not null default 'not_installed',
  elevator_steps     text,
  room_number        text,
  teacher            text,
  phone              text,
  email              text,
  on_order_notes     text,                       -- free-text "ON ORDER" column from the sheet
  sn_tag             text,                       -- the sheet's separate "S/N " column
  status             order_status not null default 'new',

  -- Accounting-owned:
  billing_status     billing_status not null default 'not_submitted',
  bill_month         date,                       -- first-of-month; null = not yet scheduled

  -- Shared:
  notes              text,                       -- the sheet's "COMMENTS" column
  legacy_status_text text,                       -- verbatim original Status/Billing Status
                                                  -- free text, preserved during migration
                                                  -- (e.g. "Submitted on 11/11 'On Hold'")

  -- Which production year this order belongs to, for historical reporting.
  -- Independent of order_date so migrated rows land in the year their own
  -- workbook tab said, even if NetSuite's order_date disagrees.
  production_year    integer not null,

  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);

comment on column public.orders.legacy_status_text is
  'Verbatim free text from the old Status/Billing Status/ON ORDER/Bill Month columns, kept during migration instead of discarded. Not shown as a status anywhere in the UI.';

create index orders_so_number_idx on public.orders (so_number);
create index orders_school_idx on public.orders (school);
create index orders_production_year_idx on public.orders (production_year);
create index orders_bill_month_idx on public.orders (bill_month);
create index orders_billing_status_idx on public.orders (billing_status);

-- ---------------------------------------------------------------------------
-- Builds  (replaces: STEM Build; one row per lab or teacher-station build)
-- ---------------------------------------------------------------------------

create type build_status as enum ('in_progress', 'complete');

create table public.builds (
  id                  uuid primary key default gen_random_uuid(),
  order_id            uuid not null references public.orders (id) on delete cascade,
  bill_month          date,
  serial_or_build_id  text not null,
  builder_name        text,
  status              build_status not null default 'in_progress',
  blocked             boolean not null default false,
  blocked_reason      text,
  start_date          date,
  end_date            date,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);

create index builds_order_id_idx on public.builds (order_id);
create index builds_status_idx on public.builds (status);

-- ---------------------------------------------------------------------------
-- Shortages  (replaces: Shortages; open parts shortages holding up an order)
-- ---------------------------------------------------------------------------

create table public.shortages (
  id                       uuid primary key default gen_random_uuid(),
  order_id                 uuid references public.orders (id) on delete set null,
  so_number_text           text,              -- kept verbatim in case order_id can't be matched yet
  customer                 text,
  item                     text not null,
  description              text,
  qty                      integer,
  po_number                text,
  po_date                  date,
  estimated_ship_date_note text,              -- free text in the sheet ("Early December", "Early Q1 2027")
  resolved                 boolean not null default false,
  created_at               timestamptz not null default now(),
  updated_at               timestamptz not null default now()
);

create index shortages_order_id_idx on public.shortages (order_id);

-- ---------------------------------------------------------------------------
-- Device shipments  (replaces: Device Shipping; not in the design doc, but a
-- real sheet in the workbook with carrier/tracking detail per shipment)
-- ---------------------------------------------------------------------------

create table public.device_shipments (
  id                uuid primary key default gen_random_uuid(),
  order_id          uuid references public.orders (id) on delete set null,
  notification_date date,
  device_po         text,
  ship_date         date,
  destination       text,
  carrier           text,
  tracking_numbers  text[],
  devices           text,       -- free-text device description ("MACBookPro x 1, IMAC x 4")
  received_date     date,
  eta               date,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

create index device_shipments_order_id_idx on public.device_shipments (order_id);

-- ---------------------------------------------------------------------------
-- Simulation  (replaces: Simulation; named, saved what-if scenarios)
-- ---------------------------------------------------------------------------

create type ship_decision as enum ('ship', 'not_ship');
create type opportunity_likelihood as enum ('most_likely', 'possible');

create table public.simulation_scenarios (
  id         uuid primary key default gen_random_uuid(),
  name       text not null,
  created_by uuid references auth.users (id),
  created_at timestamptz not null default now()
);

create table public.simulation_items (
  id                    uuid primary key default gen_random_uuid(),
  scenario_id           uuid not null references public.simulation_scenarios (id) on delete cascade,
  order_id              uuid references public.orders (id) on delete cascade,
  -- Existing-order items set ship_decision; new-PO opportunities (no order yet) leave
  -- order_id null and describe themselves instead.
  ship_decision         ship_decision,
  is_new_po_opportunity boolean not null default false,
  opportunity_school    text,                 -- only used when is_new_po_opportunity
  likelihood            opportunity_likelihood,
  labs_needed           integer,
  ts_needed             integer,
  revenue_override      numeric(12, 2),       -- overrides orders.revenue for this scenario, if set
  notes                 text,
  created_at            timestamptz not null default now()
);

create index simulation_items_scenario_id_idx on public.simulation_items (scenario_id);
create index simulation_items_order_id_idx on public.simulation_items (order_id);

-- ---------------------------------------------------------------------------
-- Weekly snapshots  (replaces: Overview's hand-entered weekly figures)
-- ---------------------------------------------------------------------------

create table public.weekly_snapshots (
  id                     uuid primary key default gen_random_uuid(),
  snapshot_date          date not null unique,
  pipeline_total         numeric(14, 2),
  awaiting_po_total      numeric(14, 2),
  revenue_goal           numeric(14, 2),
  in_our_control_target  numeric(14, 2),
  created_by             uuid references auth.users (id),
  created_at             timestamptz not null default now()
);
