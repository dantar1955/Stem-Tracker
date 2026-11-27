export function formatCurrency(value: number | null | undefined): string {
  if (value == null) return '—'
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(
    value,
  )
}

import type { BillingStatus } from '../types/database'

// Billing statuses, matching the STEM STATUS sheet's dashboard:
// billed = Submitted, On hold, Fulfilled or Paid; paid = Fulfilled or Paid.
export const BILLING_STATUS_ORDER: BillingStatus[] = ['not_submitted', 'submitted', 'on_hold', 'fulfilled', 'paid']

export const BILLING_STATUS_LABELS: Record<BillingStatus, string> = {
  not_submitted: 'Not submitted',
  submitted: 'Submitted to DOE portal',
  on_hold: 'Submitted – on hold',
  fulfilled: 'Fulfilled',
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

export function formatDateTime(value: string | null | undefined): string {
  if (!value) return '—'
  return new Date(value).toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  })
}

/** Saves a Blob as a file download in the browser. */
export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

export function todayStamp(): string {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}
