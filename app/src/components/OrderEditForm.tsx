import { useState } from 'react'
import { useAuth } from '../contexts/AuthContext'
import { canEditOrderField } from '../lib/permissions'
import { BILLING_STATUS_LABELS, BILLING_STATUS_ORDER } from '../lib/format'
import { supabase } from '../lib/supabaseClient'
import type { InstallStatus, Order, OrderStatus } from '../types/database'

const INSTALL_STATUSES: InstallStatus[] = ['not_installed', 'installed']
const ORDER_STATUSES: OrderStatus[] = [
  'new',
  'device_ordered',
  'ready_to_ship',
  'shipped',
  'delivered_installed',
  'pending_billing',
]

function TextField({
  label,
  value,
  editable,
  onChange,
  type = 'text',
}: {
  label: string
  value: string
  editable: boolean
  onChange: (v: string) => void
  type?: string
}) {
  return (
    <label className="block text-sm">
      <span className="font-medium text-slate-700">{label}</span>
      <input
        type={type}
        value={value}
        disabled={!editable}
        onChange={(e) => onChange(e.target.value)}
        className="mt-1 w-full rounded-md border border-slate-300 px-2 py-1 text-sm disabled:bg-slate-100 disabled:text-slate-400"
      />
    </label>
  )
}

function SelectField<T extends string>({
  label,
  value,
  options,
  editable,
  onChange,
  labels,
}: {
  label: string
  value: T
  options: T[]
  editable: boolean
  onChange: (v: T) => void
  labels?: Record<T, string>
}) {
  return (
    <label className="block text-sm">
      <span className="font-medium text-slate-700">{label}</span>
      <select
        value={value}
        disabled={!editable}
        onChange={(e) => onChange(e.target.value as T)}
        className="mt-1 w-full rounded-md border border-slate-300 px-2 py-1 text-sm disabled:bg-slate-100 disabled:text-slate-400"
      >
        {options.map((o) => (
          <option key={o} value={o}>
            {labels?.[o] ?? o.replace(/_/g, ' ')}
          </option>
        ))}
      </select>
    </label>
  )
}

export function OrderEditForm({ order, onSaved, onClose }: { order: Order; onSaved: () => void; onClose: () => void }) {
  const { role } = useAuth()
  const [draft, setDraft] = useState<Order>(order)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  function set<K extends keyof Order>(key: K, value: Order[K]) {
    setDraft((d) => ({ ...d, [key]: value }))
  }

  function editable(field: keyof Order) {
    return canEditOrderField(role, field)
  }

  async function handleSave() {
    setSaving(true)
    setError(null)

    // Only send columns this role is actually allowed to change -- the
    // database would reject the rest anyway (see 0002_rls.sql), but sending
    // a minimal diff keeps the error message meaningful if something's off.
    const patch: Partial<Order> = {}
    ;(Object.keys(draft) as (keyof Order)[]).forEach((key) => {
      if (draft[key] !== order[key] && editable(key)) {
        // @ts-expect-error -- heterogeneous assignment across a keyof union
        patch[key] = draft[key]
      }
    })

    if (Object.keys(patch).length === 0) {
      onClose()
      return
    }

    const { error } = await supabase.from('orders').update(patch).eq('id', order.id)
    setSaving(false)
    if (error) {
      setError(error.message)
      return
    }
    onSaved()
  }

  return (
    <div className="fixed inset-0 z-20 flex items-start justify-end bg-black/20" onClick={onClose}>
      <div
        className="h-full w-full max-w-md overflow-y-auto bg-white p-5 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between">
          <div>
            <h2 className="text-base font-semibold text-slate-900">{order.school}</h2>
            <p className="text-xs text-slate-500">S/O {order.so_number ?? '—'}</p>
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-700">
            ✕
          </button>
        </div>

        <div className="mt-4 space-y-4">
          <div className="rounded-md border border-slate-200 p-3">
            <p className="mb-2 text-xs font-semibold uppercase text-slate-400">From NetSuite</p>
            <div className="grid grid-cols-2 gap-2">
              <TextField label="Revenue" value={String(draft.revenue ?? '')} editable={editable('revenue')} onChange={(v) => set('revenue', v === '' ? null : Number(v))} type="number" />
              <TextField label="School" value={draft.school} editable={editable('school')} onChange={(v) => set('school', v)} />
              <TextField label="Labs" value={String(draft.labs_qty)} editable={false} onChange={() => {}} />
              <TextField label="TS" value={String(draft.ts_qty)} editable={false} onChange={() => {}} />
              <TextField label="DOE P.O." value={draft.doe_po ?? ''} editable={false} onChange={() => {}} />
            </div>
          </div>

          <div className="rounded-md border border-slate-200 p-3">
            <p className="mb-2 text-xs font-semibold uppercase text-slate-400">Operations</p>
            <div className="grid grid-cols-2 gap-2">
              <TextField label="Device PO" value={draft.device_po ?? ''} editable={editable('device_po')} onChange={(v) => set('device_po', v)} />
              <TextField label="PCS received" value={draft.pcs_received ?? ''} editable={editable('pcs_received')} onChange={(v) => set('pcs_received', v)} type="date" />
              <TextField label="PC serial #" value={draft.pc_serial_number ?? ''} editable={editable('pc_serial_number')} onChange={(v) => set('pc_serial_number', v)} />
              <TextField label="Ship date" value={draft.ship_date ?? ''} editable={editable('ship_date')} onChange={(v) => set('ship_date', v)} type="date" />
              <TextField label="Install date" value={draft.install_date ?? ''} editable={editable('install_date')} onChange={(v) => set('install_date', v)} type="date" />
              <SelectField label="Install status" value={draft.install_status} options={INSTALL_STATUSES} editable={editable('install_status')} onChange={(v) => set('install_status', v)} />
              <SelectField label="Status" value={draft.status} options={ORDER_STATUSES} editable={editable('status')} onChange={(v) => set('status', v)} />
              <TextField label="Room #" value={draft.room_number ?? ''} editable={editable('room_number')} onChange={(v) => set('room_number', v)} />
              <TextField label="Teacher" value={draft.teacher ?? ''} editable={editable('teacher')} onChange={(v) => set('teacher', v)} />
              <TextField label="Phone" value={draft.phone ?? ''} editable={editable('phone')} onChange={(v) => set('phone', v)} />
              <TextField label="Email" value={draft.email ?? ''} editable={editable('email')} onChange={(v) => set('email', v)} />
              <TextField label="Elevator/Steps" value={draft.elevator_steps ?? ''} editable={editable('elevator_steps')} onChange={(v) => set('elevator_steps', v)} />
              <TextField label="On order" value={draft.on_order_notes ?? ''} editable={editable('on_order_notes')} onChange={(v) => set('on_order_notes', v)} />
            </div>
          </div>

          <div className="rounded-md border border-slate-200 p-3">
            <p className="mb-2 text-xs font-semibold uppercase text-slate-400">Accounting</p>
            <div className="grid grid-cols-2 gap-2">
              <SelectField label="Billing status" value={draft.billing_status} options={BILLING_STATUS_ORDER} labels={BILLING_STATUS_LABELS} editable={editable('billing_status')} onChange={(v) => set('billing_status', v)} />
              <TextField label="Bill month" value={draft.bill_month ?? ''} editable={editable('bill_month')} onChange={(v) => set('bill_month', v)} type="date" />
            </div>
          </div>

          <div className="rounded-md border border-slate-200 p-3">
            <p className="mb-2 text-xs font-semibold uppercase text-slate-400">Notes (shared)</p>
            <textarea
              value={draft.notes ?? ''}
              disabled={!editable('notes')}
              onChange={(e) => set('notes', e.target.value)}
              rows={3}
              className="w-full rounded-md border border-slate-300 px-2 py-1 text-sm disabled:bg-slate-100"
            />
          </div>
        </div>

        {error && <p className="mt-3 text-sm text-red-600">{error}</p>}

        <div className="mt-4 flex justify-end gap-2">
          <button onClick={onClose} className="rounded-md border border-slate-300 px-3 py-1.5 text-sm">
            Cancel
          </button>
          <button
            onClick={handleSave}
            disabled={saving}
            className="rounded-md bg-blue-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-60"
          >
            {saving ? 'Saving…' : 'Save changes'}
          </button>
        </div>
      </div>
    </div>
  )
}
