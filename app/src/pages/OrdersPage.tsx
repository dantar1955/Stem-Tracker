import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabaseClient'
import { formatCurrency, formatDate } from '../lib/format'
import { OrderEditForm } from '../components/OrderEditForm'
import { LEGEND_ORDER, ORDER_COLORS, orderColorKey } from '../lib/orderColors'
import type { OrderComputed } from '../types/database'

const CURRENT_YEAR = new Date().getFullYear()

export function OrdersPage() {
  const [orders, setOrders] = useState<OrderComputed[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [year, setYear] = useState(CURRENT_YEAR)
  const [search, setSearch] = useState('')
  const [showAll, setShowAll] = useState(false)
  const [selected, setSelected] = useState<OrderComputed | null>(null)

  async function load() {
    setLoading(true)
    let query = supabase
      .from('orders_computed')
      .select('*')
      .eq('production_year', year)
      .order('order_date', { ascending: false })

    if (!showAll) {
      query = query.eq('in_production', true)
    }

    if (search.trim()) {
      const term = search.trim().replace(/[,()]/g, ' ')
      query = query.or(`school.ilike.%${term}%,so_number.ilike.%${term}%`)
    }

    const { data, error } = await query
    if (error) setError(error.message)
    else {
      setOrders((data as OrderComputed[]) ?? [])
      setError(null)
    }
    setLoading(false)
  }

  useEffect(() => {
    load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [year, showAll])

  return (
    <div>
      <div className="flex flex-wrap items-center gap-3">
        <h2 className="text-lg font-semibold text-slate-900">Orders</h2>
        <select
          value={year}
          onChange={(e) => setYear(Number(e.target.value))}
          className="rounded-md border border-slate-300 px-2 py-1 text-sm"
        >
          {[CURRENT_YEAR + 1, CURRENT_YEAR, CURRENT_YEAR - 1, CURRENT_YEAR - 2].map((y) => (
            <option key={y} value={y}>
              {y}
            </option>
          ))}
        </select>
        <input
          placeholder="Search school or S/O #…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && load()}
          className="rounded-md border border-slate-300 px-2 py-1 text-sm"
        />
        <button onClick={load} className="rounded-md border border-slate-300 px-3 py-1 text-sm hover:bg-slate-100">
          Search
        </button>
        <label className="flex items-center gap-2 text-sm text-slate-700">
          <input type="checkbox" checked={showAll} onChange={(e) => setShowAll(e.target.checked)} />
          Show all orders (incl. non-lab, e.g. SnappyXO)
        </label>
        <span className="ml-auto text-sm text-slate-500">{orders.length} orders</span>
      </div>

      <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-xs text-slate-600">
        {LEGEND_ORDER.map((key) => (
          <span key={key} className="flex items-center gap-1.5" title={ORDER_COLORS[key].description}>
            <span className={`inline-block h-3 w-3 rounded-sm border ${ORDER_COLORS[key].swatch}`} />
            {ORDER_COLORS[key].label}
          </span>
        ))}
      </div>

      {error && <p className="mt-3 text-sm text-red-600">{error}</p>}

      <div className="mt-4 overflow-x-auto rounded-lg border border-slate-200 bg-white">
        <table className="min-w-full divide-y divide-slate-200 text-sm">
          <thead className="bg-slate-50 text-xs uppercase text-slate-500">
            <tr>
              <th className="px-3 py-2 text-left">S/O #</th>
              <th className="px-3 py-2 text-left">School</th>
              <th className="px-3 py-2 text-left">PCS Rec</th>
              <th className="px-3 py-2 text-left">Revenue</th>
              <th className="px-3 py-2 text-left">Ship date</th>
              <th className="px-3 py-2 text-left">Billing status</th>
              <th className="px-3 py-2 text-left">Bill month</th>
              <th className="px-3 py-2 text-left">Install date</th>
              <th className="px-3 py-2 text-left">Labs / TS</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {loading ? (
              <tr>
                <td colSpan={9} className="px-3 py-6 text-center text-slate-400">
                  Loading…
                </td>
              </tr>
            ) : orders.length === 0 ? (
              <tr>
                <td colSpan={9} className="px-3 py-6 text-center text-slate-400">
                  No orders found for {year}.
                </td>
              </tr>
            ) : (
              orders.map((order) => (
                <tr
                  key={order.id}
                  onClick={() => setSelected(order)}
                  className={`cursor-pointer ${ORDER_COLORS[orderColorKey(order)].row}`}
                  title={ORDER_COLORS[orderColorKey(order)].label}
                >
                  <td className="whitespace-nowrap px-3 py-2 text-slate-700">{order.so_number ?? '—'}</td>
                  <td className="px-3 py-2 font-medium text-slate-900">
                    {order.school}
                    {!order.in_production && (
                      <span className="ml-2 rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-normal uppercase text-slate-500">
                        Non-lab
                      </span>
                    )}
                  </td>
                  <td className="px-3 py-2">{formatDate(order.pcs_received)}</td>
                  <td className="px-3 py-2">{formatCurrency(order.revenue)}</td>
                  <td className="px-3 py-2">{formatDate(order.ship_date)}</td>
                  <td className="px-3 py-2 capitalize">{order.billing_status.replace(/_/g, ' ')}</td>
                  <td className="px-3 py-2">{formatDate(order.bill_month)}</td>
                  <td className="px-3 py-2">{formatDate(order.install_date)}</td>
                  <td className="px-3 py-2">
                    {order.labs_qty}L / {order.ts_qty}TS
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {selected && (
        <OrderEditForm
          order={selected}
          onClose={() => setSelected(null)}
          onSaved={() => {
            setSelected(null)
            load()
          }}
        />
      )}
    </div>
  )
}
