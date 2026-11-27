import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabaseClient'
import { StatCard } from '../components/StatCard'
import { formatCurrency, formatPercent } from '../lib/format'
import type { DashboardSummaryRow, WeeklySnapshot } from '../types/database'

const CURRENT_YEAR = new Date().getFullYear()

const SUM_FIELDS = [
  'shipped_revenue',
  'billed_revenue',
  'paid_revenue',
  'shipped_not_billed_revenue',
  'unshipped_revenue',
  'scheduled_not_shipped_revenue',
  'not_yet_scheduled_revenue',
  'delivering_without_devices_revenue',
  'order_count',
] as const

// The summary view has one row for production orders and one for the rest.
// Add up the rows that are in scope.
function combine(rows: DashboardSummaryRow[], includeAll: boolean): DashboardSummaryRow | null {
  const inScope = rows.filter((r) => includeAll || r.in_production)
  if (inScope.length === 0) return null
  const total = { ...inScope[0] }
  for (const field of SUM_FIELDS) {
    const values = inScope.map((r) => r[field]).filter((v): v is number => v != null)
    ;(total as Record<string, unknown>)[field] = values.length ? values.reduce((a, b) => a + Number(b), 0) : null
  }
  return total
}

export function DashboardPage() {
  const [summaryRows, setSummaryRows] = useState<DashboardSummaryRow[]>([])
  const [includeAll, setIncludeAll] = useState(false)
  const [snapshot, setSnapshot] = useState<WeeklySnapshot | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let mounted = true

    async function load() {
      setLoading(true)
      const [summaryRes, snapshotRes] = await Promise.all([
        supabase.from('v_dashboard_summary').select('*').eq('production_year', CURRENT_YEAR),
        supabase.from('weekly_snapshots').select('*').order('snapshot_date', { ascending: false }).limit(1).maybeSingle(),
      ])

      if (!mounted) return

      if (summaryRes.error) setError(summaryRes.error.message)
      else setSummaryRows((summaryRes.data as DashboardSummaryRow[] | null) ?? [])

      if (!snapshotRes.error) setSnapshot(snapshotRes.data as WeeklySnapshot | null)

      setLoading(false)
    }

    load()
    return () => {
      mounted = false
    }
  }, [])

  if (loading) return <div className="text-slate-500">Loading dashboard…</div>
  if (error) return <div className="text-red-600">Failed to load dashboard: {error}</div>

  const summary = combine(summaryRows, includeAll)
  const goal = snapshot?.revenue_goal ?? null
  const inControl = snapshot?.in_our_control_target ?? null
  const committed = (summary?.shipped_revenue ?? 0) + (summary?.unshipped_revenue ?? 0)
  const totalProjected = committed + (snapshot?.pipeline_total ?? 0)

  return (
    <div className="space-y-8">
      <label className="flex items-center gap-2 text-sm text-slate-700">
        <input type="checkbox" checked={includeAll} onChange={(e) => setIncludeAll(e.target.checked)} />
        Include all orders (non-lab orders such as SnappyXO are left out by default)
      </label>

      <section>
        <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500">
          {CURRENT_YEAR} story — projections
        </h2>
        <div className="mt-2 grid grid-cols-1 gap-3 sm:grid-cols-3">
          <StatCard label="Committed" value={formatCurrency(committed)} sublabel="Shipped + unshipped" />
          <StatCard label="Pipeline (last snapshot)" value={formatCurrency(snapshot?.pipeline_total)} />
          <StatCard label="Total projected" value={formatCurrency(totalProjected)} accent />
        </div>
        {goal != null && (
          <p className="mt-2 text-sm text-slate-500">
            Goal: {formatCurrency(goal)}
            {inControl != null && <> · In our control: {formatCurrency(inControl)}</>}
          </p>
        )}
      </section>

      <section>
        <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500">Where we are</h2>
        <div className="mt-2 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <StatCard label="Shipped" value={formatCurrency(summary?.shipped_revenue)} />
          <StatCard
            label="Billed"
            value={formatCurrency(summary?.billed_revenue)}
            sublabel="Submitted to DOE portal (incl. on hold) or paid"
          />
          <StatCard label="Paid" value={formatCurrency(summary?.paid_revenue)} />
          <StatCard
            label="Collected %"
            value={formatPercent(summary?.paid_revenue, summary?.billed_revenue)}
            sublabel="Paid ÷ billed"
          />
          <StatCard label="Shipped, not billed" value={formatCurrency(summary?.shipped_not_billed_revenue)} />
          <StatCard label="Unshipped" value={formatCurrency(summary?.unshipped_revenue)} />
        </div>
      </section>

      <section>
        <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500">
          On a PO, not yet shipped
        </h2>
        <div className="mt-2 grid grid-cols-1 gap-3 sm:grid-cols-3">
          <StatCard label="Scheduled" value={formatCurrency(summary?.scheduled_not_shipped_revenue)} />
          <StatCard label="Not yet scheduled" value={formatCurrency(summary?.not_yet_scheduled_revenue)} />
          <StatCard
            label="Awaiting PO (last snapshot)"
            value={formatCurrency(snapshot?.awaiting_po_total)}
          />
        </div>
      </section>

      <section>
        <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500">Delivering without devices</h2>
        <div className="mt-2 grid grid-cols-1 gap-3 sm:grid-cols-3">
          <StatCard
            label="Shipped, devices not received"
            value={formatCurrency(summary?.delivering_without_devices_revenue)}
          />
          <StatCard label="Total orders" value={String(summary?.order_count ?? 0)} />
        </div>
      </section>

      {!snapshot && (
        <p className="text-sm text-slate-500">
          No weekly snapshot recorded yet — pipeline and awaiting-PO figures will show once Sales or Admin
          records one.
        </p>
      )}
    </div>
  )
}
