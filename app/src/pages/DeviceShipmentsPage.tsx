import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabaseClient'
import { useAuth } from '../contexts/AuthContext'
import { formatDate } from '../lib/format'
import type { DeviceShipment, Order } from '../types/database'

export function DeviceShipmentsPage() {
  const { role } = useAuth()
  const canWrite = role === 'operations' || role === 'admin'

  const [shipments, setShipments] = useState<DeviceShipment[]>([])
  const [orders, setOrders] = useState<Pick<Order, 'id' | 'school'>[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const [form, setForm] = useState({ orderId: '', devicePo: '', carrier: '', devices: '', tracking: '', shipDate: '' })

  async function load() {
    setLoading(true)
    const [shipRes, ordersRes] = await Promise.all([
      supabase.from('device_shipments').select('*').order('ship_date', { ascending: false }),
      supabase.from('orders').select('id, school').order('school'),
    ])
    if (shipRes.error) setError(shipRes.error.message)
    else setShipments((shipRes.data as DeviceShipment[]) ?? [])
    if (!ordersRes.error) setOrders((ordersRes.data as Pick<Order, 'id' | 'school'>[]) ?? [])
    setLoading(false)
  }

  useEffect(() => {
    load()
  }, [])

  async function addShipment() {
    if (!form.devicePo) return
    const { error } = await supabase.from('device_shipments').insert({
      order_id: form.orderId || null,
      device_po: form.devicePo,
      carrier: form.carrier || null,
      devices: form.devices || null,
      ship_date: form.shipDate || null,
      tracking_numbers: form.tracking ? form.tracking.split(/\s+/) : null,
    })
    if (error) setError(error.message)
    else {
      setForm({ orderId: '', devicePo: '', carrier: '', devices: '', tracking: '', shipDate: '' })
      load()
    }
  }

  return (
    <div>
      <h2 className="text-lg font-semibold text-slate-900">Device shipping</h2>

      {error && <p className="mt-3 text-sm text-red-600">{error}</p>}

      {canWrite && (
        <div className="mt-4 grid grid-cols-2 gap-2 rounded-lg border border-slate-200 bg-white p-3 sm:grid-cols-6">
          <select value={form.orderId} onChange={(e) => setForm({ ...form, orderId: e.target.value })} className="rounded-md border border-slate-300 px-2 py-1 text-sm">
            <option value="">School (optional)</option>
            {orders.map((o) => (
              <option key={o.id} value={o.id}>
                {o.school}
              </option>
            ))}
          </select>
          <input placeholder="Device PO *" value={form.devicePo} onChange={(e) => setForm({ ...form, devicePo: e.target.value })} className="rounded-md border border-slate-300 px-2 py-1 text-sm" />
          <input placeholder="Carrier" value={form.carrier} onChange={(e) => setForm({ ...form, carrier: e.target.value })} className="rounded-md border border-slate-300 px-2 py-1 text-sm" />
          <input placeholder="Devices" value={form.devices} onChange={(e) => setForm({ ...form, devices: e.target.value })} className="rounded-md border border-slate-300 px-2 py-1 text-sm" />
          <input type="date" value={form.shipDate} onChange={(e) => setForm({ ...form, shipDate: e.target.value })} className="rounded-md border border-slate-300 px-2 py-1 text-sm" />
          <input placeholder="Tracking #s (space-separated)" value={form.tracking} onChange={(e) => setForm({ ...form, tracking: e.target.value })} className="col-span-2 rounded-md border border-slate-300 px-2 py-1 text-sm sm:col-span-1" />
          <button onClick={addShipment} className="col-span-2 rounded-md bg-blue-600 px-3 py-1.5 text-sm font-medium text-white sm:col-span-1">
            Add shipment
          </button>
        </div>
      )}

      <div className="mt-4 overflow-x-auto rounded-lg border border-slate-200 bg-white">
        <table className="min-w-full divide-y divide-slate-200 text-sm">
          <thead className="bg-slate-50 text-xs uppercase text-slate-500">
            <tr>
              <th className="px-3 py-2 text-left">Device PO</th>
              <th className="px-3 py-2 text-left">Carrier</th>
              <th className="px-3 py-2 text-left">Devices</th>
              <th className="px-3 py-2 text-left">Ship date</th>
              <th className="px-3 py-2 text-left">Received</th>
              <th className="px-3 py-2 text-left">Tracking</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {loading ? (
              <tr>
                <td colSpan={6} className="px-3 py-6 text-center text-slate-400">
                  Loading…
                </td>
              </tr>
            ) : (
              shipments.map((s) => (
                <tr key={s.id}>
                  <td className="px-3 py-2">{s.device_po ?? '—'}</td>
                  <td className="px-3 py-2">{s.carrier ?? '—'}</td>
                  <td className="px-3 py-2">{s.devices ?? '—'}</td>
                  <td className="px-3 py-2">{formatDate(s.ship_date)}</td>
                  <td className="px-3 py-2">{formatDate(s.received_date)}</td>
                  <td className="px-3 py-2 font-mono text-xs">{(s.tracking_numbers ?? []).join(', ') || '—'}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}
