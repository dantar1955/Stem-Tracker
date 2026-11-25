export function formatCurrency(value: number | null | undefined): string {
  if (value == null) return '—'
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(
    value,
  )
}

export function formatDate(value: string | null | undefined): string {
  if (!value) return '—'
  return new Date(value).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

export function formatPercent(numerator: number | null | undefined, denominator: number | null | undefined): string {
  if (!numerator || !denominator) return '—'
  return `${Math.round((numerator / denominator) * 100)}%`
}
