import type { AppRole, Order } from '../types/database'

// Mirrors supabase/migrations/0002_rls.sql's enforce_orders_column_access().
// This is a UX convenience only (greys out fields a role can't save) -- the
// database is the real enforcement point, so it's fine for this list to
// drift slightly; a blocked save still surfaces the server's error.
const ORDER_FIELD_OWNERS: Record<keyof Order, AppRole[] | 'netsuite' | 'shared'> = {
  id: 'netsuite',
  netsuite_so_id: 'netsuite',
  so_number: 'netsuite',
  order_date: 'netsuite',
  school: ['sales'],
  revenue: ['sales'],
  labs_qty: 'netsuite',
  ts_qty: 'netsuite',
  doe_po: 'netsuite',
  device_po: ['operations'],
  pcs_received: ['operations'],
  pc_serial_number: ['operations'],
  ship_date: ['operations'],
  install_date: ['operations'],
  install_status: ['operations'],
  elevator_steps: ['operations'],
  room_number: ['operations'],
  teacher: ['operations'],
  phone: ['operations'],
  email: ['operations'],
  on_order_notes: ['operations'],
  sn_tag: ['operations'],
  status: ['operations'],
  billing_status: ['accounting'],
  bill_month: ['accounting'],
  notes: 'shared',
  legacy_status_text: 'netsuite',
  production_year: 'netsuite',
  tracked_in_sheet: 'netsuite',
  at_risk: ['operations'],
  created_at: 'netsuite',
  updated_at: 'netsuite',
}

/** Can this role edit this column of `orders` from the UI? Admin can edit everything. */
export function canEditOrderField(role: AppRole | null, field: keyof Order): boolean {
  if (!role) return false
  if (role === 'admin') return true
  const owner = ORDER_FIELD_OWNERS[field]
  if (owner === 'netsuite') return false
  if (owner === 'shared') return true
  return owner.includes(role)
}

export function roleLabel(role: AppRole): string {
  switch (role) {
    case 'admin':
      return 'Admin'
    case 'sales':
      return 'Sales'
    case 'operations':
      return 'Operations'
    case 'accounting':
      return 'Accounting'
  }
}
