import { useCallback, useEffect, useState } from 'react'
import { supabase } from '../../lib/supabaseClient'
import { downloadBlob, formatDateTime, todayStamp } from '../../lib/format'
import type { AuditLogEntry } from '../../types/database'

const PAGE_SIZE = 100

const AREAS: Record<string, string> = {
  orders: 'Orders',
  builds: 'Build tracker',
  shortages: 'Shortages',
  device_shipments: 'Device shipping',
  pipeline_entries: 'Pipeline',
  year_goals: 'Goals',
  weekly_snapshots: 'Weekly snapshots',
  simulation_scenarios: 'Simulation',
  simulation_items: 'Simulation',
  user_roles: 'User roles',
  users: 'Users',
}

const ACTIONS: Record<string, string> = {
  insert: 'Added',
  update: 'Changed',
  delete: 'Deleted',
  sign_in: 'Signed in',
  sign_out: 'Signed out',
  password_changed: 'Changed own password',
  user_created: 'Created user',
  user_updated: 'Edited user',
  password_reset: 'Reset password',
  user_suspended: 'Suspended user',
  user_unsuspended: 'Restored user access',
  backup_created: 'Downloaded a backup',
  pipeline_imported: 'Imported pipeline file',
  pipeline_exported: 'Exported pipeline',
  pipeline_template_downloaded: 'Downloaded pipeline template',
  audit_exported: 'Exported audit trail',
}

const HIDDEN_FIELDS = new Set(['id', 'created_by', 'created_at', 'updated_at'])

function fieldName(key: string): string {
  return key.replace(/_/g, ' ').replace(/\bqty\b/, 'qty').replace(/^./, (c) => c.toUpperCase())
}

function show(v: unknown): string {
  if (v === null || v === undefined || v === '') return '(blank)'
  if (typeof v === 'object') return JSON.stringify(v)
  return String(v)
}

function who(e: AuditLogEntry): string {
  if (e.actor_name || e.actor_email) return e.actor_name ? `${e.actor_name} (${e.actor_email ?? ''})` : (e.actor_email ?? '')
  if (e.source === 'netsuite_sync') return 'NetSuite sync'
  if (e.source === 'database') return 'Database (SQL Editor)'
  return 'System'
}

function describeChanges(e: AuditLogEntry): string[] {
  if (e.action === 'update' && e.changes) {
    return Object.entries(e.changes)
      .filter(([k]) => !HIDDEN_FIELDS.has(k))
      .map(([k, v]) => {
        const c = v as { old?: unknown; new?: unknown }
        return `${fieldName(k)}: ${show(c.old)} → ${show(c.new)}`
      })
  }
  if ((e.action === 'insert' || e.action === 'delete') && e.changes) {
    return Object.entries(e.changes)
      .filter(([k]) => !HIDDEN_FIELDS.has(k))
      .slice(0, 8)
      .map(([k, v]) => `${fieldName(k)}: ${show(v)}`)
  }
  if (e.changes) {
    return Object.entries(e.changes).map(([k, v]) => {
      const c = v as { old?: unknown; new?: unknown }
      return `${fieldName(k)}: ${show(c.old)} → ${show(c.new)}`
    })
  }
  if (e.details) {
    return Object.entries(e.details)
      .filter(([k]) => k !== 'counts')
      .map(([k, v]) => `${fieldName(k)}: ${show(v)}`)
      .concat(e.details.counts ? [`Rows: ${Object.values(e.details.counts as Record<string, number>).reduce((a, b) => a + b, 0)}`] : [])
  }
  return []
}

export function AuditTrailPage() {
  const [entries, setEntries] = useState<AuditLogEntry[]>([])
  const [actors, setActors] = useState<string[]>([])
  const [loading, setLoading] = useState(true)
  const [hasMore, setHasMore] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [filters, setFilters] = useState({ actor: '', area: '', action: '', from: '', to: '', search: '' })

  const buildQuery = useCallback(() => {
    let q = supabase.from('audit_log').select('*').order('occurred_at', { ascending: false }).order('id', { ascending: false })
    if (filters.actor === '__sync') q = q.eq('source', 'netsuite_sync')
    else if (filters.actor === '__system') q = q.in('source', ['system', 'database'])
    else if (filters.actor) q = q.eq('actor_email', filters.actor)
    if (filters.area) q = q.eq('table_name', filters.area)
    if (filters.action === 'changes') q = q.in('action', ['insert', 'update', 'delete'])
    else if (filters.action === 'access') q = q.in('action', ['sign_in', 'sign_out', 'password_changed'])
    else if (filters.action === 'admin') q = q.in('action', ['user_created', 'user_updated', 'password_reset', 'user_suspended', 'user_unsuspended', 'backup_created'])
    if (filters.from) q = q.gte('occurred_at', `${filters.from}T00:00:00`)
    if (filters.to) q = q.lte('occurred_at', `${filters.to}T23:59:59.999`)
    if (filters.search.trim()) q = q.ilike('record_label', `%${filters.search.trim()}%`)
    return q
  }, [filters])

  const load = useCallback(
    async (append = false) => {
      setLoading(true)
      const offset = append ? entries.length : 0
      const { data, error } = await buildQuery().range(offset, offset + PAGE_SIZE - 1)
      if (error) setError(error.message)
      else {
        const rows = (data as AuditLogEntry[]) ?? []
        setEntries((prev) => (append ? [...prev, ...rows] : rows))
        setHasMore(rows.length === PAGE_SIZE)
        setError(null)
      }
      setLoading(false)
    },
    // entries.length is only read for "Load more"
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [buildQuery],
  )

  useEffect(() => {
    load(false)
  }, [load])

  useEffect(() => {
    supabase
      .from('audit_log')
      .select('actor_email')
      .not('actor_email', 'is', null)
      .order('actor_email')
      .limit(1000)
      .then(({ data }) => setActors(Array.from(new Set((data ?? []).map((r) => r.actor_email as string)))))
  }, [])

  async function exportExcel() {
    const { data, error } = await buildQuery().limit(10000)
    if (error) {
      setError(error.message)
      return
    }
    const ExcelJS = (await import('exceljs')).default
    const wb = new ExcelJS.Workbook()
    const ws = wb.addWorksheet('Audit trail', { views: [{ state: 'frozen', ySplit: 1 }] })
    ws.columns = [
      { header: 'When', key: 'when', width: 22 },
      { header: 'Who', key: 'who', width: 34 },
      { header: 'Action', key: 'action', width: 22 },
      { header: 'Area', key: 'area', width: 16 },
      { header: 'Record', key: 'record', width: 34 },
      { header: 'Details', key: 'details', width: 90 },
    ]
    ws.getRow(1).font = { bold: true }
    for (const e of (data as AuditLogEntry[]) ?? []) {
      ws.addRow({
        when: new Date(e.occurred_at),
        who: who(e),
        action: ACTIONS[e.action] ?? e.action,
        area: e.table_name ? (AREAS[e.table_name] ?? e.table_name) : '',
        record: e.record_label ?? '',
        details: describeChanges(e).join('\n'),
      })
    }
    ws.getColumn('when').numFmt = 'm/d/yyyy h:mm AM/PM'
    const buf = await wb.xlsx.writeBuffer()
    downloadBlob(new Blob([buf]), `audit-trail-${todayStamp()}.xlsx`)
    await supabase.rpc('log_app_event', { p_action: 'audit_exported', p_details: { rows: data?.length ?? 0, filters } })
  }

  const set = (k: keyof typeof filters) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
    setFilters((f) => ({ ...f, [k]: e.target.value }))

  return (
    <div className="space-y-4">
      <p className="text-sm text-slate-600">
        Every change in the system, who made it and what it was before and after — plus sign-ins, user management and backups.
        Entries can't be edited or deleted.
      </p>

      <div className="flex flex-wrap items-end gap-3 rounded-lg border border-slate-200 bg-white p-3 text-sm">
        <label>
          <span className="block text-xs text-slate-500">User</span>
          <select value={filters.actor} onChange={set('actor')} className="rounded-md border border-slate-300 px-2 py-1">
            <option value="">Everyone</option>
            <option value="__sync">NetSuite sync</option>
            <option value="__system">System / SQL Editor</option>
            {actors.map((a) => (
              <option key={a} value={a}>
                {a}
              </option>
            ))}
          </select>
        </label>
        <label>
          <span className="block text-xs text-slate-500">Area</span>
          <select value={filters.area} onChange={set('area')} className="rounded-md border border-slate-300 px-2 py-1">
            <option value="">All areas</option>
            {Object.entries(AREAS)
              .filter(([k]) => k !== 'simulation_items')
              .map(([k, v]) => (
                <option key={k} value={k}>
                  {v}
                </option>
              ))}
          </select>
        </label>
        <label>
          <span className="block text-xs text-slate-500">Type</span>
          <select value={filters.action} onChange={set('action')} className="rounded-md border border-slate-300 px-2 py-1">
            <option value="">Everything</option>
            <option value="changes">Data changes</option>
            <option value="access">Sign-ins and sign-outs</option>
            <option value="admin">User management and backups</option>
          </select>
        </label>
        <label>
          <span className="block text-xs text-slate-500">From</span>
          <input type="date" value={filters.from} onChange={set('from')} className="rounded-md border border-slate-300 px-2 py-1" />
        </label>
        <label>
          <span className="block text-xs text-slate-500">To</span>
          <input type="date" value={filters.to} onChange={set('to')} className="rounded-md border border-slate-300 px-2 py-1" />
        </label>
        <label>
          <span className="block text-xs text-slate-500">Record contains</span>
          <input value={filters.search} onChange={set('search')} placeholder="e.g. SO144592 or 160K" className="rounded-md border border-slate-300 px-2 py-1" />
        </label>
        <button onClick={exportExcel} className="ml-auto rounded-md border border-slate-300 px-3 py-1.5 hover:bg-slate-100">
          Export to Excel
        </button>
      </div>

      {error && <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}

      <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
        <table className="min-w-full divide-y divide-slate-200 text-sm">
          <thead className="bg-slate-50 text-xs uppercase text-slate-500">
            <tr>
              <th className="px-3 py-2 text-left">When</th>
              <th className="px-3 py-2 text-left">Who</th>
              <th className="px-3 py-2 text-left">Action</th>
              <th className="px-3 py-2 text-left">Area</th>
              <th className="px-3 py-2 text-left">Record</th>
              <th className="px-3 py-2 text-left">What changed</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100 align-top">
            {entries.map((e) => (
              <tr key={e.id}>
                <td className="whitespace-nowrap px-3 py-2 text-slate-600">{formatDateTime(e.occurred_at)}</td>
                <td className="px-3 py-2">{who(e)}</td>
                <td className="whitespace-nowrap px-3 py-2 font-medium">{ACTIONS[e.action] ?? e.action}</td>
                <td className="px-3 py-2">{e.table_name ? (AREAS[e.table_name] ?? e.table_name) : '—'}</td>
                <td className="px-3 py-2">{e.record_label ?? '—'}</td>
                <td className="px-3 py-2 text-xs text-slate-700">
                  {describeChanges(e).map((line, i) => (
                    <div key={i}>{line}</div>
                  ))}
                </td>
              </tr>
            ))}
            {!loading && entries.length === 0 && (
              <tr>
                <td colSpan={6} className="px-3 py-6 text-center text-slate-400">
                  Nothing matches these filters.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      <div className="flex justify-center">
        {loading ? (
          <span className="text-sm text-slate-500">Loading…</span>
        ) : (
          hasMore && (
            <button onClick={() => load(true)} className="rounded-md border border-slate-300 px-3 py-1.5 text-sm hover:bg-slate-100">
              Load more
            </button>
          )
        )}
      </div>
    </div>
  )
}
