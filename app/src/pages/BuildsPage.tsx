import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabaseClient'
import { useAuth } from '../contexts/AuthContext'
import { formatDate } from '../lib/format'
import type { BuildComputed, BuildStatus, Order } from '../types/database'

const CURRENT_YEAR = new Date().getFullYear()

export function BuildsPage() {
  const { role } = useAuth()
  const canWrite = role === 'operations' || role === 'admin'

  const [builds, setBuilds] = useState<BuildComputed[]>([])
  const [orders, setOrders] = useState<Pick<Order, 'id' | 'school'>[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const [newOrderId, setNewOrderId] = useState('')
  const [newSerial, setNewSerial] = useState('')
  const [newBuilder, setNewBuilder] = useState('')

  async function load() {
    setLoading(true)
    const [buildsRes, ordersRes] = await Promise.all([
      supabase
        .from('builds_computed')
        .select('*')
        .eq('production_year', CURRENT_YEAR)
        .order('created_at', { ascending: false }),
      supabase.from('orders').select('id, school').eq('production_year', CURRENT_YEAR).order('school'),
    ])
    if (buildsRes.error) setError(buildsRes.error.message)
    else setBuilds((buildsRes.data as BuildComputed[]) ?? [])
    if (!ordersRes.error) setOrders((ordersRes.data as Pick<Order, 'id' | 'school'>[]) ?? [])
    setLoading(false)
  }

  useEffect(() => {
    load()
  }, [])

  async function addBuild() {
    if (!newOrderId || !newSerial) return
    const { error } = await supabase
      .from('builds')
      .insert({ order_id: newOrderId, serial_or_build_id: newSerial, builder_name: newBuilder || null })
    if (error) setError(error.message)
    else {
      setNewSerial('')
      setNewBuilder('')
      load()
    }
  }

  async function updateBuild(id: string, patch: Partial<BuildComputed>) {
    const { error } = await supabase.from('builds').update(patch).eq('id', id)
    if (error) setError(error.message)
    else load()
  }

  const done = builds.filter((b) => b.status === 'complete').length

  return (
    <div>
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold text-slate-900">Build tracker — {CURRENT_YEAR}</h2>
        <span className="text-sm text-slate-500">
          {done} / {builds.length} complete
        </span>
      </div>

      {error && <p className="mt-3 text-sm text-red-600">{error}</p>}

      {canWrite && (
        <div className="mt-4 flex flex-wrap items-end gap-2 rounded-lg border border-slate-200 bg-white p-3">
          <label className="text-sm">
            <span className="block text-xs font-medium text-slate-500">School</span>
            <select
              value={newOrderId}
              onChange={(e) => setNewOrderId(e.target.value)}
              className="mt-1 rounded-md border border-slate-300 px-2 py-1 text-sm"
            >
              <option value="">Select…</option>
              {orders.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.school}
                </option>
              ))}
            </select>
          </label>
          <label className="text-sm">
            <span className="block text-xs font-medium text-slate-500">Serial / build ID</span>
            <input
              value={newSerial}
              onChange={(e) => setNewSerial(e.target.value)}
              className="mt-1 rounded-md border border-slate-300 px-2 py-1 text-sm"
            />
          </label>
          <label className="text-sm">
            <span className="block text-xs font-medium text-slate-500">Builder</span>
            <input
              value={newBuilder}
              onChange={(e) => setNewBuilder(e.target.value)}
              className="mt-1 rounded-md border border-slate-300 px-2 py-1 text-sm"
            />
          </label>
          <button onClick={addBuild} className="rounded-md bg-blue-600 px-3 py-1.5 text-sm font-medium text-white">
            Add build
          </button>
        </div>
      )}

      <div className="mt-4 overflow-x-auto rounded-lg border border-slate-200 bg-white">
        <table className="min-w-full divide-y divide-slate-200 text-sm">
          <thead className="bg-slate-50 text-xs uppercase text-slate-500">
            <tr>
              <th className="px-3 py-2 text-left">School</th>
              <th className="px-3 py-2 text-left">Serial / build ID</th>
              <th className="px-3 py-2 text-left">Type</th>
              <th className="px-3 py-2 text-left">Builder</th>
              <th className="px-3 py-2 text-left">Status</th>
              <th className="px-3 py-2 text-left">Blocked?</th>
              <th className="px-3 py-2 text-left">Devices received</th>
              <th className="px-3 py-2 text-left">Start</th>
              <th className="px-3 py-2 text-left">End</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {loading ? (
              <tr>
                <td colSpan={9} className="px-3 py-6 text-center text-slate-400">
                  Loading…
                </td>
              </tr>
            ) : (
              builds.map((b) => (
                <tr key={b.id}>
                  <td className="px-3 py-2">{b.school}</td>
                  <td className="px-3 py-2 font-mono text-xs">{b.serial_or_build_id}</td>
                  <td className="px-3 py-2">{b.is_teacher_station ? 'TS' : 'Lab'}</td>
                  <td className="px-3 py-2">{b.builder_name ?? '—'}</td>
                  <td className="px-3 py-2">
                    {canWrite ? (
                      <select
                        value={b.status}
                        onChange={(e) => updateBuild(b.id, { status: e.target.value as BuildStatus })}
                        className="rounded-md border border-slate-300 px-2 py-0.5 text-xs"
                      >
                        <option value="in_progress">In progress</option>
                        <option value="complete">Complete</option>
                      </select>
                    ) : (
                      b.status.replace('_', ' ')
                    )}
                  </td>
                  <td className="px-3 py-2">
                    {b.blocked ? <span className="text-red-600">Yes</span> : 'No'}
                  </td>
                  <td className="px-3 py-2">{b.device_received ? 'Yes' : 'No'}</td>
                  <td className="px-3 py-2">{formatDate(b.start_date)}</td>
                  <td className="px-3 py-2">{formatDate(b.end_date)}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}
