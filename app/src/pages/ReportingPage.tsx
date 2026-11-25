import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabaseClient'
import { formatCurrency, formatDate } from '../lib/format'

interface BuildsRollupRow {
  production_year: number
  build_month: string
  build_type: 'lab' | 'ts'
  builds_complete: number
  builds_total: number
}

interface RevenueRollupRow {
  production_year: number
  bill_month: string
  shipped_revenue: number | null
  billed_revenue: number | null
  paid_revenue: number | null
  total_revenue: number | null
}

export function ReportingPage() {
  const [builds, setBuilds] = useState<BuildsRollupRow[]>([])
  const [revenue, setRevenue] = useState<RevenueRollupRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let mounted = true
    async function load() {
      const [buildsRes, revenueRes] = await Promise.all([
        supabase.from('v_builds_monthly_rollup').select('*').order('production_year').order('build_month'),
        supabase.from('v_revenue_by_bill_month').select('*').order('production_year').order('bill_month'),
      ])
      if (!mounted) return
      if (buildsRes.error) setError(buildsRes.error.message)
      else setBuilds((buildsRes.data as BuildsRollupRow[]) ?? [])
      if (!revenueRes.error) setRevenue((revenueRes.data as RevenueRollupRow[]) ?? [])
      setLoading(false)
    }
    load()
    return () => {
      mounted = false
    }
  }, [])

  if (loading) return <div className="text-slate-500">Loading reports…</div>

  return (
    <div className="space-y-8">
      <h2 className="text-lg font-semibold text-slate-900">Reporting — all years</h2>
      {error && <p className="text-sm text-red-600">{error}</p>}

      <section>
        <h3 className="text-sm font-semibold uppercase tracking-wide text-slate-500">
          Labs &amp; teacher stations built per month
        </h3>
        <div className="mt-2 overflow-x-auto rounded-lg border border-slate-200 bg-white">
          <table className="min-w-full divide-y divide-slate-200 text-sm">
            <thead className="bg-slate-50 text-xs uppercase text-slate-500">
              <tr>
                <th className="px-3 py-2 text-left">Year</th>
                <th className="px-3 py-2 text-left">Month</th>
                <th className="px-3 py-2 text-left">Type</th>
                <th className="px-3 py-2 text-left">Complete</th>
                <th className="px-3 py-2 text-left">Total</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {builds.length === 0 ? (
                <tr>
                  <td colSpan={5} className="px-3 py-6 text-center text-slate-400">
                    No completed builds yet.
                  </td>
                </tr>
              ) : (
                builds.map((row, i) => (
                  <tr key={i}>
                    <td className="px-3 py-2">{row.production_year}</td>
                    <td className="px-3 py-2">{formatDate(row.build_month)}</td>
                    <td className="px-3 py-2 uppercase">{row.build_type}</td>
                    <td className="px-3 py-2">{row.builds_complete}</td>
                    <td className="px-3 py-2">{row.builds_total}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </section>

      <section>
        <h3 className="text-sm font-semibold uppercase tracking-wide text-slate-500">Revenue by bill month</h3>
        <div className="mt-2 overflow-x-auto rounded-lg border border-slate-200 bg-white">
          <table className="min-w-full divide-y divide-slate-200 text-sm">
            <thead className="bg-slate-50 text-xs uppercase text-slate-500">
              <tr>
                <th className="px-3 py-2 text-left">Year</th>
                <th className="px-3 py-2 text-left">Bill month</th>
                <th className="px-3 py-2 text-left">Shipped</th>
                <th className="px-3 py-2 text-left">Billed</th>
                <th className="px-3 py-2 text-left">Paid</th>
                <th className="px-3 py-2 text-left">Total</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {revenue.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-3 py-6 text-center text-slate-400">
                    No scheduled orders yet.
                  </td>
                </tr>
              ) : (
                revenue.map((row, i) => (
                  <tr key={i}>
                    <td className="px-3 py-2">{row.production_year}</td>
                    <td className="px-3 py-2">{formatDate(row.bill_month)}</td>
                    <td className="px-3 py-2">{formatCurrency(row.shipped_revenue)}</td>
                    <td className="px-3 py-2">{formatCurrency(row.billed_revenue)}</td>
                    <td className="px-3 py-2">{formatCurrency(row.paid_revenue)}</td>
                    <td className="px-3 py-2">{formatCurrency(row.total_revenue)}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  )
}
