import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabaseClient'
import { useAuth } from '../contexts/AuthContext'
import { formatDate } from '../lib/format'
import type { Shortage } from '../types/database'

export function ShortagesPage() {
  const { role } = useAuth()
  const canWrite = role === 'operations' || role === 'admin'

  const [shortages, setShortages] = useState<Shortage[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [showResolved, setShowResolved] = useState(false)

  const [form, setForm] = useState({ so: '', customer: '', item: '', qty: '', po: '', eta: '' })

  async function load() {
    setLoading(true)
    let query = supabase.from('shortages').select('*').order('created_at', { ascending: false })
    if (!showResolved) query = query.eq('resolved', false)
    const { data, error } = await query
    if (error) setError(error.message)
    else setShortages((data as Shortage[]) ?? [])
    setLoading(false)
  }

  useEffect(() => {
    load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showResolved])

  async function addShortage() {
    if (!form.item) return
    const { error } = await supabase.from('shortages').insert({
      so_number_text: form.so || null,
      customer: form.customer || null,
      item: form.item,
      qty: form.qty ? Number(form.qty) : null,
      po_number: form.po || null,
      estimated_ship_date_note: form.eta || null,
    })
    if (error) setError(error.message)
    else {
      setForm({ so: '', customer: '', item: '', qty: '', po: '', eta: '' })
      load()
    }
  }

  async function toggleResolved(s: Shortage) {
    const { error } = await supabase.from('shortages').update({ resolved: !s.resolved }).eq('id', s.id)
    if (error) setError(error.message)
    else load()
  }

  return (
    <div>
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold text-slate-900">Shortages</h2>
        <label className="flex items-center gap-2 text-sm text-slate-600">
          <input type="checkbox" checked={showResolved} onChange={(e) => setShowResolved(e.target.checked)} />
          Show resolved
        </label>
      </div>

      {error && <p className="mt-3 text-sm text-red-600">{error}</p>}

      {canWrite && (
        <div className="mt-4 grid grid-cols-2 gap-2 rounded-lg border border-slate-200 bg-white p-3 sm:grid-cols-6">
          <input placeholder="SO#" value={form.so} onChange={(e) => setForm({ ...form, so: e.target.value })} className="rounded-md border border-slate-300 px-2 py-1 text-sm" />
          <input placeholder="Customer" value={form.customer} onChange={(e) => setForm({ ...form, customer: e.target.value })} className="rounded-md border border-slate-300 px-2 py-1 text-sm" />
          <input placeholder="Item *" value={form.item} onChange={(e) => setForm({ ...form, item: e.target.value })} className="rounded-md border border-slate-300 px-2 py-1 text-sm" />
          <input placeholder="Qty" type="number" value={form.qty} onChange={(e) => setForm({ ...form, qty: e.target.value })} className="rounded-md border border-slate-300 px-2 py-1 text-sm" />
          <input placeholder="PO#" value={form.po} onChange={(e) => setForm({ ...form, po: e.target.value })} className="rounded-md border border-slate-300 px-2 py-1 text-sm" />
          <input placeholder="ESD note" value={form.eta} onChange={(e) => setForm({ ...form, eta: e.target.value })} className="rounded-md border border-slate-300 px-2 py-1 text-sm" />
          <button onClick={addShortage} className="col-span-2 rounded-md bg-blue-600 px-3 py-1.5 text-sm font-medium text-white sm:col-span-1">
            Add
          </button>
        </div>
      )}

      <div className="mt-4 overflow-x-auto rounded-lg border border-slate-200 bg-white">
        <table className="min-w-full divide-y divide-slate-200 text-sm">
          <thead className="bg-slate-50 text-xs uppercase text-slate-500">
            <tr>
              <th className="px-3 py-2 text-left">SO#</th>
              <th className="px-3 py-2 text-left">Customer</th>
              <th className="px-3 py-2 text-left">Item</th>
              <th className="px-3 py-2 text-left">Qty</th>
              <th className="px-3 py-2 text-left">PO#</th>
              <th className="px-3 py-2 text-left">PO date</th>
              <th className="px-3 py-2 text-left">ESD from vendor</th>
              <th className="px-3 py-2 text-left">Resolved</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {loading ? (
              <tr>
                <td colSpan={8} className="px-3 py-6 text-center text-slate-400">
                  Loading…
                </td>
              </tr>
            ) : shortages.length === 0 ? (
              <tr>
                <td colSpan={8} className="px-3 py-6 text-center text-slate-400">
                  No open shortages.
                </td>
              </tr>
            ) : (
              shortages.map((s) => (
                <tr key={s.id}>
                  <td className="px-3 py-2">{s.so_number_text ?? '—'}</td>
                  <td className="px-3 py-2">{s.customer ?? '—'}</td>
                  <td className="px-3 py-2">{s.item}</td>
                  <td className="px-3 py-2">{s.qty ?? '—'}</td>
                  <td className="px-3 py-2">{s.po_number ?? '—'}</td>
                  <td className="px-3 py-2">{formatDate(s.po_date)}</td>
                  <td className="px-3 py-2">{s.estimated_ship_date_note ?? '—'}</td>
                  <td className="px-3 py-2">
                    {canWrite ? (
                      <input type="checkbox" checked={s.resolved} onChange={() => toggleResolved(s)} />
                    ) : s.resolved ? (
                      'Yes'
                    ) : (
                      'No'
                    )}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}
