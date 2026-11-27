import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabaseClient'
import { Link } from 'react-router-dom'
import { ColorLegend, SectionBanner, StatCard, type Tone } from '../components/StatCard'
import { formatCurrency, formatDate, formatPercent } from '../lib/format'
import type { DashboardSummaryRow, PipelineSummaryRow, WeeklySnapshot, YearGoals } from '../types/database'

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
  'awaiting_payment_revenue',
  'at_risk_revenue',
  'order_count',
  'shipped_count',
  'billed_count',
  'paid_count',
  'scheduled_count',
  'at_risk_count',
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
  const [pipeline, setPipeline] = useState<PipelineSummaryRow | null>(null)
  const [goals, setGoals] = useState<YearGoals | null>(null)
  const [lastWeek, setLastWeek] = useState<WeeklySnapshot | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let mounted = true

    async function load() {
      setLoading(true)
      // "Last week" = the most recent snapshot from before this week.
      const monday = new Date()
      monday.setDate(monday.getDate() - ((monday.getDay() + 6) % 7))
      const thisWeek = `${monday.getFullYear()}-${String(monday.getMonth() + 1).padStart(2, '0')}-${String(monday.getDate()).padStart(2, '0')}`

      const [summaryRes, pipelineRes, goalsRes, snapshotRes] = await Promise.all([
        supabase.from('v_dashboard_summary').select('*').eq('production_year', CURRENT_YEAR),
        supabase.from('v_pipeline_summary').select('*').eq('production_year', CURRENT_YEAR).maybeSingle(),
        supabase.from('year_goals').select('*').eq('production_year', CURRENT_YEAR).maybeSingle(),
        supabase
          .from('weekly_snapshots')
          .select('*')
          .lt('snapshot_date', thisWeek)
          .order('snapshot_date', { ascending: false })
          .limit(1)
          .maybeSingle(),
      ])

      if (!mounted) return

      if (summaryRes.error) setError(summaryRes.error.message)
      else setSummaryRows((summaryRes.data as DashboardSummaryRow[] | null) ?? [])
      if (!pipelineRes.error) setPipeline(pipelineRes.data as PipelineSummaryRow | null)
      if (!goalsRes.error) setGoals(goalsRes.data as YearGoals | null)
      if (!snapshotRes.error) setLastWeek(snapshotRes.data as WeeklySnapshot | null)

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
  const n = (v: number | null | undefined) => Number(v ?? 0)

  const committed = n(summary?.shipped_revenue) + n(summary?.unshipped_revenue)
  const pipelineTotal = n(pipeline?.pipeline_total)
  const awaitingPo = n(pipeline?.awaiting_po_total)
  const totalProjected = committed + pipelineTotal + awaitingPo
  const goal = goals?.revenue_goal ?? null
  const inControl = goals?.in_our_control_target ?? null

  // Amber/red only when there's something to act on; grey when it's zero.
  const actionTone = (v: number | null | undefined, tone: Tone): Tone => (n(v) > 0 ? tone : 'neutral')

  function vsLastWeek(current: number, previous: number | null | undefined): string {
    if (previous == null) return 'no earlier weekly snapshot yet'
    const diff = current - Number(previous)
    if (Math.abs(diff) < 1) return 'no change vs last week'
    return `${diff > 0 ? '▲' : '▼'} ${formatCurrency(Math.abs(diff))} vs last week`
  }

  const goalPct = goal ? Math.min(100, (totalProjected / goal) * 100) : null
  const shippedPct = goal ? Math.min(100, (n(summary?.shipped_revenue) / goal) * 100) : null

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <label className="flex items-center gap-2 text-sm text-slate-700">
          <input type="checkbox" checked={includeAll} onChange={(e) => setIncludeAll(e.target.checked)} />
          Include all orders (non-lab orders such as SnappyXO are left out by default)
        </label>
        <ColorLegend />
      </div>

      <section className="space-y-3">
        <SectionBanner number={1} title={`${CURRENT_YEAR} projections`} subtitle="how the year can land" />
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <StatCard label="Committed" value={formatCurrency(committed)} sublabel="Shipped + on a PO, not yet shipped" tone="progress" />
          <StatCard
            label="Pipeline"
            value={formatCurrency(pipelineTotal)}
            sublabel={`${pipeline?.pipeline_count ?? 0} opportunities · ${vsLastWeek(pipelineTotal, lastWeek?.pipeline_total)}`}
            tone="forecast"
          />
          <StatCard
            label="Awaiting PO"
            value={formatCurrency(awaitingPo)}
            sublabel={`${pipeline?.awaiting_po_count ?? 0} opportunities · ${vsLastWeek(awaitingPo, lastWeek?.awaiting_po_total)}`}
            tone="forecast"
          />
          <StatCard
            label="Total projected"
            value={formatCurrency(totalProjected)}
            sublabel="Committed + Pipeline + Awaiting PO"
            tone="forecast"
            big
          />
        </div>
        {goal != null ? (
          <div className="rounded-lg border border-slate-200 bg-white p-4">
            <div className="flex flex-wrap justify-between gap-2 text-sm">
              <span className="font-medium text-slate-700">
                Goal {formatCurrency(goal)}
                {inControl != null && <span className="text-slate-500"> · {formatCurrency(inControl)} in our control</span>}
              </span>
              <span className="text-slate-600">
                {totalProjected >= goal ? '✅ Projected to reach the goal' : `${formatCurrency(goal - totalProjected)} short of the goal`}
                {inControl != null && (totalProjected >= inControl ? ' · ✅ in-our-control target covered' : ' · ❌ below in-our-control target')}
              </span>
            </div>
            <div className="relative mt-2 h-4 overflow-hidden rounded-full bg-slate-100">
              <div className="absolute inset-y-0 left-0 bg-violet-300" style={{ width: `${goalPct}%` }} />
              <div className="absolute inset-y-0 left-0 bg-emerald-600" style={{ width: `${shippedPct}%` }} />
              {inControl != null && (
                <div className="absolute inset-y-0 w-0.5 bg-slate-800" style={{ left: `${Math.min(100, (inControl / goal) * 100)}%` }} />
              )}
            </div>
            <p className="mt-1 text-xs text-slate-500">
              Green = shipped so far · purple = everything projected · black line = in-our-control target
            </p>
          </div>
        ) : (
          <p className="text-sm text-slate-500">
            No {CURRENT_YEAR} goal set yet — add it on the <Link to="/pipeline" className="text-blue-700 underline">Pipeline</Link> tab.
          </p>
        )}
      </section>

      <section className="space-y-3">
        <SectionBanner number={2} title="Where we are" subtitle="what's shipped and the cash behind it" />
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-5">
          <StatCard
            label="Shipped YTD"
            value={formatCurrency(summary?.shipped_revenue)}
            sublabel={`${summary?.shipped_count ?? 0} orders shipped`}
            tone="done"
          />
          <StatCard
            label="Billed"
            value={formatCurrency(summary?.billed_revenue)}
            sublabel={`${summary?.billed_count ?? 0} orders · fulfilled, paid or submitted`}
            tone="progress"
          />
          <StatCard
            label="Paid"
            value={formatCurrency(summary?.paid_revenue)}
            sublabel={`${summary?.paid_count ?? 0} orders · ${formatCurrency(summary?.awaiting_payment_revenue)} awaiting payment`}
            tone="done"
          />
          <StatCard
            label="Shipped, not billed"
            value={formatCurrency(summary?.shipped_not_billed_revenue)}
            sublabel={n(summary?.shipped_not_billed_revenue) > 0 ? 'invoice these' : '✓ nothing waiting to be invoiced'}
            tone={actionTone(summary?.shipped_not_billed_revenue, 'action')}
          />
          <StatCard
            label="Collected"
            value={formatPercent(summary?.paid_revenue, summary?.shipped_revenue)}
            sublabel="of shipped $ paid"
            tone="done"
          />
        </div>
      </section>

      <section className="space-y-3">
        <SectionBanner
          number={3}
          title="On a PO but not shipped yet"
          subtitle={`${formatCurrency(n(summary?.scheduled_not_shipped_revenue) + n(summary?.not_yet_scheduled_revenue))} committed`}
        />
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <StatCard
            label="Scheduled to ship"
            value={formatCurrency(summary?.scheduled_not_shipped_revenue)}
            sublabel={`${summary?.scheduled_count ?? 0} orders · has a bill month`}
            tone="progress"
          />
          <StatCard
            label="Not yet scheduled"
            value={formatCurrency(summary?.not_yet_scheduled_revenue)}
            sublabel={n(summary?.not_yet_scheduled_revenue) > 0 ? 'no bill month — schedule these' : '✓ everything has a bill month'}
            tone={actionTone(summary?.not_yet_scheduled_revenue, 'action')}
          />
          <StatCard
            label="At risk"
            value={formatCurrency(summary?.at_risk_revenue)}
            sublabel={`${summary?.at_risk_count ?? 0} orders · not counted in the totals`}
            tone={actionTone(summary?.at_risk_revenue, 'risk')}
          />
        </div>
      </section>

      <section className="space-y-3">
        <SectionBanner number={4} title="Delivering without devices" subtitle="shipped, but PCS Received is still empty" />
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <StatCard
            label="Shipped, devices not received"
            value={formatCurrency(summary?.delivering_without_devices_revenue)}
            sublabel={n(summary?.delivering_without_devices_revenue) > 0 ? 'follow up on devices' : '✓ none'}
            tone={actionTone(summary?.delivering_without_devices_revenue, 'action')}
          />
          <StatCard label="Total orders" value={String(summary?.order_count ?? 0)} sublabel={`${CURRENT_YEAR} production orders`} />
          <StatCard
            label="Last weekly snapshot"
            value={lastWeek ? formatDate(lastWeek.snapshot_date) : '—'}
            sublabel="saved automatically every Monday"
          />
        </div>
      </section>
    </div>
  )
}
