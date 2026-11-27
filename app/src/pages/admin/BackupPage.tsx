import { useState } from 'react'
import { callAdminFunction } from '../../lib/adminApi'
import { downloadBlob } from '../../lib/format'

interface Backup {
  format: string
  version: number
  generated_at: string
  generated_by: string
  counts: Record<string, number>
  tables: Record<string, Record<string, unknown>[]>
}

const SHEET_NAMES: Record<string, string> = {
  orders: 'Orders',
  builds: 'Builds',
  shortages: 'Shortages',
  device_shipments: 'Device shipments',
  pipeline_entries: 'Pipeline',
  year_goals: 'Goals',
  weekly_snapshots: 'Weekly snapshots',
  simulation_scenarios: 'Simulation scenarios',
  simulation_items: 'Simulation items',
  user_roles: 'User roles',
  users: 'Users',
  audit_log: 'Audit trail',
}

function stamp(iso: string): string {
  return iso.slice(0, 16).replace('T', '_').replace(':', '')
}

function cellValue(v: unknown): unknown {
  if (v === null || v === undefined) return null
  if (typeof v === 'object') return JSON.stringify(v)
  return v
}

export function BackupPage() {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [last, setLast] = useState<Backup | null>(null)

  async function runBackup() {
    setBusy(true)
    setError(null)
    try {
      const backup = await callAdminFunction<Backup>('admin-backup', {})
      const name = `stem-tracker-backup_${stamp(backup.generated_at)}`

      // 1. Full JSON copy -- complete and exact, for restoring.
      downloadBlob(new Blob([JSON.stringify(backup, null, 2)], { type: 'application/json' }), `${name}.json`)

      // 2. Excel workbook -- one tab per table, for reading.
      const ExcelJS = (await import('exceljs')).default
      const wb = new ExcelJS.Workbook()
      const summary = wb.addWorksheet('Summary')
      summary.columns = [
        { header: 'Table', key: 'table', width: 26 },
        { header: 'Rows', key: 'rows', width: 10 },
      ]
      summary.getRow(1).font = { bold: true }
      summary.addRow({ table: 'Backup taken', rows: new Date(backup.generated_at).toLocaleString() })
      summary.addRow({ table: 'Taken by', rows: backup.generated_by })
      summary.addRow({})
      for (const [table, rows] of Object.entries(backup.tables)) {
        summary.addRow({ table: SHEET_NAMES[table] ?? table, rows: rows.length })
        const ws = wb.addWorksheet((SHEET_NAMES[table] ?? table).slice(0, 31), { views: [{ state: 'frozen', ySplit: 1 }] })
        const keys = Array.from(new Set(rows.flatMap((r) => Object.keys(r))))
        ws.columns = keys.map((k) => ({ header: k, key: k, width: Math.min(40, Math.max(12, k.length + 2)) }))
        ws.getRow(1).font = { bold: true }
        for (const r of rows) {
          ws.addRow(Object.fromEntries(keys.map((k) => [k, cellValue(r[k])])))
        }
      }
      const buf = await wb.xlsx.writeBuffer()
      downloadBlob(new Blob([buf]), `${name}.xlsx`)

      setLast(backup)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
    setBusy(false)
  }

  return (
    <div className="max-w-3xl space-y-4">
      <p className="text-sm text-slate-600">
        Downloads a complete copy of the system's data: every order, build, shortage, device shipment, pipeline entry, goal,
        snapshot, simulation, user (names, emails, roles, status — never passwords) and the full audit trail.
      </p>
      <ul className="list-disc space-y-1 pl-5 text-sm text-slate-600">
        <li>
          <strong>Excel workbook (.xlsx)</strong> — one tab per table, easy to open and read.
        </li>
        <li>
          <strong>JSON file (.json)</strong> — an exact copy, the one to keep for restoring data if it's ever needed.
        </li>
      </ul>
      <p className="text-sm text-slate-600">
        Keep backups somewhere safe (for example a restricted company drive): they contain all of your customer and order data.
        Each backup is recorded in the audit trail.
      </p>

      <button
        onClick={runBackup}
        disabled={busy}
        className="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-60"
      >
        {busy ? 'Preparing backup…' : 'Back up everything now'}
      </button>

      {error && <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}

      {last && (
        <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-900">
          <p className="font-medium">Backup downloaded — {new Date(last.generated_at).toLocaleString()}</p>
          <ul className="mt-2 grid grid-cols-2 gap-x-6 sm:grid-cols-3">
            {Object.entries(last.counts).map(([table, n]) => (
              <li key={table}>
                {SHEET_NAMES[table] ?? table}: {n}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  )
}
