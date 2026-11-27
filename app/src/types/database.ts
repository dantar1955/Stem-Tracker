// Hand-written types mirroring supabase/migrations/000*.sql.
// Once the project is live, prefer generating these with
// `supabase gen types typescript` and replacing this file.

export type AppRole = 'admin' | 'sales' | 'operations' | 'accounting'

export type BillingStatus = 'not_submitted' | 'submitted' | 'fulfilled' | 'paid' | 'on_hold'
export type InstallStatus = 'not_installed' | 'installed'
export type OrderStatus =
  | 'new'
  | 'device_ordered'
  | 'ready_to_ship'
  | 'shipped'
  | 'delivered_installed'
  | 'pending_billing'
export type BuildStatus = 'in_progress' | 'complete'
export type ShipDecision = 'ship' | 'not_ship'
export type OpportunityLikelihood = 'most_likely' | 'possible'

export interface UserRole {
  user_id: string
  role: AppRole
  full_name: string | null
  created_at: string
  updated_at: string
}

export interface Order {
  id: string
  netsuite_so_id: number | null
  so_number: string | null
  order_date: string | null
  school: string
  revenue: number | null
  labs_qty: number
  ts_qty: number
  doe_po: string | null
  device_po: string | null
  pcs_received: string | null
  pc_serial_number: string | null
  ship_date: string | null
  install_date: string | null
  install_status: InstallStatus
  elevator_steps: string | null
  room_number: string | null
  teacher: string | null
  phone: string | null
  email: string | null
  on_order_notes: string | null
  sn_tag: string | null
  status: OrderStatus
  billing_status: BillingStatus
  bill_month: string | null
  notes: string | null
  legacy_status_text: string | null
  production_year: number
  tracked_in_sheet: boolean
  at_risk: boolean
  created_at: string
  updated_at: string
}

export interface OrderComputed extends Order {
  is_shipped: boolean
  is_unshipped: boolean
  is_billed: boolean
  is_paid: boolean
  is_scheduled: boolean
  // Lab / teacher-station order, or one carried over from the spreadsheet.
  // Non-production orders (SnappyXO, iPad-only, ...) are hidden by default.
  in_production: boolean
}

export interface Build {
  id: string
  order_id: string
  bill_month: string | null
  serial_or_build_id: string
  builder_name: string | null
  status: BuildStatus
  blocked: boolean
  blocked_reason: string | null
  start_date: string | null
  end_date: string | null
  created_at: string
  updated_at: string
}

export interface BuildComputed extends Build {
  school: string
  production_year: number
  is_teacher_station: boolean
  device_received: boolean
}

export interface Shortage {
  id: string
  order_id: string | null
  so_number_text: string | null
  customer: string | null
  item: string
  description: string | null
  qty: number | null
  po_number: string | null
  po_date: string | null
  estimated_ship_date_note: string | null
  resolved: boolean
  created_at: string
  updated_at: string
}

export interface DeviceShipment {
  id: string
  order_id: string | null
  notification_date: string | null
  device_po: string | null
  ship_date: string | null
  destination: string | null
  carrier: string | null
  tracking_numbers: string[] | null
  devices: string | null
  received_date: string | null
  eta: string | null
  created_at: string
  updated_at: string
}

export interface SimulationScenario {
  id: string
  name: string
  created_by: string | null
  created_at: string
}

export interface SimulationItem {
  id: string
  scenario_id: string
  order_id: string | null
  ship_decision: ShipDecision | null
  is_new_po_opportunity: boolean
  opportunity_school: string | null
  likelihood: OpportunityLikelihood | null
  labs_needed: number | null
  ts_needed: number | null
  revenue_override: number | null
  notes: string | null
  created_at: string
}

export interface WeeklySnapshot {
  id: string
  snapshot_date: string
  pipeline_total: number | null
  awaiting_po_total: number | null
  revenue_goal: number | null
  in_our_control_target: number | null
  created_by: string | null
  created_at: string
}

export interface DashboardSummaryRow {
  production_year: number
  in_production: boolean
  shipped_revenue: number | null
  billed_revenue: number | null
  paid_revenue: number | null
  shipped_not_billed_revenue: number | null
  unshipped_revenue: number | null
  scheduled_not_shipped_revenue: number | null
  not_yet_scheduled_revenue: number | null
  delivering_without_devices_revenue: number | null
  awaiting_payment_revenue: number | null
  at_risk_revenue: number | null
  order_count: number
  shipped_count: number
  billed_count: number
  paid_count: number
  scheduled_count: number
  at_risk_count: number
}
