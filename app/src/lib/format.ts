export function formatCurrency(value: number | null | undefined): string {
  if (value == null) return '—'
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(
    value,
  )
}

import type { BillingStatus } from '../types/database'

// Billing steps in the order they happen. An order counts as billed once it
// has been submitted to the DOE portal (Submitted, On hold or Paid).
export const BILLING_STATUS_ORDER: BillingStatus[] = ['not_submitted', 'fulfilled', 'submitted', 'on_hold', 'paid']

export const BILLING_STATUS_LABELS: Record<BillingStatus, string> = {
  not_submitted: 'Not submitted',
  fulfilled: 'Fulfilled – ready to submit',
  submitted: 'Submitted to DOE portal',
  on_hold: 'Submitted – on hold',
  paid: 'Paid',
}

export function formatDate(value: string | null | undefined): string {
  if (!value) return '—'
  // Plain dates ("2026-11-25") are calendar days, not moments in time.
  // new Date("2026-11-25") would read them as midnight UTC, which shows as
  // the previous day anywhere west of London -- so build them as local dates.
  const plain = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value)
  const date = plain ? new Date(Number(plain[1]), Number(plain[2]) - 1, Number(plain[3])) : new Date(value)
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

export function formatPercent(numerator: number | null | undefined, denominator: number | null | undefined): string {
  if (!numerator || !denominator) return '—'
  return `${Math.round((numerator / denominator) * 100)}%`
}
