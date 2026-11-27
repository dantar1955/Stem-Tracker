import type { OrderComputed } from '../types/database'

// Row colours on the Orders page, matching the colours the team used in the
// STEM STATUS spreadsheet. They are worked out from each order's data, so
// nobody has to paint rows by hand. First matching rule wins.

export type OrderColorKey = 'next_year' | 'no_so' | 'shipped_devices_out' | 'shipped' | 'scheduled' | 'unscheduled'

export const ORDER_COLORS: Record<OrderColorKey, { label: string; description: string; row: string; swatch: string }> = {
  shipped: {
    label: 'Shipped',
    description: 'Ship date is today or earlier',
    row: 'bg-green-100 hover:bg-green-200',
    swatch: 'bg-green-100 border-green-300',
  },
  shipped_devices_out: {
    label: 'Shipped – devices outstanding',
    description: 'Shipped, but PCS Received is still empty',
    row: 'bg-sky-100 hover:bg-sky-200',
    swatch: 'bg-sky-100 border-sky-300',
  },
  scheduled: {
    label: 'Scheduled / in build',
    description: 'Future ship date, or a build S/N has been assigned',
    row: 'bg-yellow-100 hover:bg-yellow-200',
    swatch: 'bg-yellow-100 border-yellow-300',
  },
  next_year: {
    label: "Next year's queue",
    description: 'Production year is after this year',
    row: 'bg-slate-200 hover:bg-slate-300',
    swatch: 'bg-slate-200 border-slate-400',
  },
  no_so: {
    label: 'No sales order yet',
    description: 'Devices or notes tracked without an S/O number',
    row: 'bg-pink-100 hover:bg-pink-200',
    swatch: 'bg-pink-100 border-pink-300',
  },
  unscheduled: {
    label: 'Not yet scheduled',
    description: 'No ship date and no build assigned',
    row: 'bg-white hover:bg-slate-50',
    swatch: 'bg-white border-slate-300',
  },
}

export const LEGEND_ORDER: OrderColorKey[] = [
  'shipped',
  'shipped_devices_out',
  'scheduled',
  'unscheduled',
  'next_year',
  'no_so',
]

function todayIso(): string {
  const d = new Date()
  const mm = String(d.getMonth() + 1).padStart(2, '0')
  const dd = String(d.getDate()).padStart(2, '0')
  return `${d.getFullYear()}-${mm}-${dd}`
}

export function orderColorKey(order: OrderComputed, currentYear = new Date().getFullYear()): OrderColorKey {
  if (order.production_year > currentYear) return 'next_year'
  if (!order.so_number) return 'no_so'
  if (order.is_shipped) return order.pcs_received ? 'shipped' : 'shipped_devices_out'
  if ((order.ship_date && order.ship_date > todayIso()) || order.sn_tag) return 'scheduled'
  return 'unscheduled'
}
