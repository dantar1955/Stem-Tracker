import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { supabase } from '../lib/supabaseClient'
import { useAuth } from '../contexts/AuthContext'
import { canEditPipeline } from '../lib/permissions'
import { downloadBlob, formatCurrency, formatDate, todayStamp } from '../lib/format'
import { logEvent } from '../lib/audit'
import {
  LIKELIHOOD_LABELS,
  STAGE_LABELS,
  buildPipelineWorkbook,
  parsePipelineWorkbook,
  type ParseResult,
} from '../lib/pipelineTemplate'
import type { OpportunityLikelihood, PipelineEntry, PipelineStage, YearGoals } from '../types/database'

const CURRENT_YEAR = new Date().getFullYear()

const STAGE_STYLES: Record<PipelineStage, string> = {
  pipeline: 'bg-violet-100 text-violet-800',
  awaiting_po: 'bg-sky-100 text-sky-800',
  po_received: 'bg-emerald-100 text-emerald-800',
  lost: 'bg-slate-200 text-slate-600',
}

type StageFilter = 'active' | PipelineStage | 'all'

const FILTERS: { key: StageFilter; label: string }[] = [
  { key: 'active', label: 'Open (Pipeline + Awaiting PO)' },
  { key: 'pipeline', label: 'Pipeline' },
  { key: 'awaiting_po', label: 'Awaiting PO' },
  { key: 'po_received', label: 'PO received' },
  { key: 'lost', label: 'Lost' },
  { key: 'all', label: 'All' },
]

type Draft = Omit<PipelineEntry, 'id' | 'created_by' | 'created_at' | 'updated_at'> & { id?: string }

function emptyDraft(year: number): Draft {
  return {
    opportunity: '',
    stage: 'pipeline',
    likelihood: null,
    labs_qty: 0,
    ts_qty: 0,
    estimated_revenue: null,
    expected_po_date: null,
    production_year: year,
    owner: null,
    notes: null,
  }
}

export function PipelinePage() {
  const { role, user } = useAuth()
  const editable = canEditPipeline(role)
  const [year, setYear] = useState(CURRENT_YEAR)
  const [entries, setEntries] = useState<PipelineEntry[]>([])
  const [goals, setGoals] = useState<YearGoals | null>(null)
  const [goalDraft, setGoalDraft] = useState({ revenue_goal: '', in_our_control_target: '' })
  const [filter, setFilter] = useState<StageFilter>('active')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [message, setMessage] = useState<string | null>(null)
  const [draft, setDraft] = useState<Draft | null>(null)
  const [saving, setSaving] = useState(false)
  const [upload, setUpload] = useState<{ fileName: string; result: ParseResult; knownIds: Set<string> } | null>(null)
  const [removeMissing, setRemoveMissing] = useState(false)
  const fileInput = useRef<HTMLInputElement>(null)

  const load = useCallback(async () => {
    setLoading(true)
    const [entriesRes, goalsRes] = await Promise.all([
      supabase.from('pipeline_entries').select('*').eq('production_year', year).order('stage').order('estimated_revenue', { ascending: false }),
      supabase.from('year_goals').select('*').eq('production_year', year).maybeSingle(),
    ])
    if (entriesRes.error) setError(entriesRes.error.message)
    else {
      setEntries((entriesRes.data as PipelineEntry[]) ?? [])
      setError(null)
    }
    const g = (goalsRes.data as YearGoals | null) ?? null
    setGoals(g)
    setGoalDraft({
      revenue_goal: g?.revenue_goal != null ? String(g.revenue_goal) : '',
      in_our_control_target: g?.in_our_control_target != null ? String(g.in_our_control_target) : '',
    })
    setLoading(false)
  }, [year])

  useEffect(() => {
    load()
  }, [load])

  const totals = useMemo(() => {
    const sum = (stage: PipelineStage) =>
      entries.filter((e) => e.stage === stage).reduce((a, e) => a + Number(e.estimated_revenue ?? 0), 0)
    const count = (stage: PipelineStage) => entries.filter((e) => e.stage === stage).length
    return {
      pipeline: sum('pipeline'),
      pipelineCount: count('pipeline'),
      awaiting: sum('awaiting_po'),
      awaitingCount: count('awaiting_po'),
    }
  }, [entries])

  const visible = entries.filter((e) =>
    filter === 'all' ? true : filter === 'active' ? e.stage === 'pipeline' || e.stage === 'awaiting_po' : e.stage === filter,
  )

  function flash(text: string) {
    setMessage(text)
    setTimeout(() => setMessage(null), 5000)
  }

  async function saveDraft() {
    if (!draft) return
    if (!draft.opportunity.trim()) {
      setError('School / Opportunity is required')
      return
    }
    setSaving(true)
    const { id, ...fields } = draft
    const payload = { ...fields, opportunity: fields.opportunity.trim() }
    const res = id
      ? await supabase.from('pipeline_entries').update(payload).eq('id', id)
      : await supabase.from('pipeline_entries').insert({ ...payload, created_by: user?.id ?? null })
    setSaving(false)
    if (res.error) {
      setError(res.error.message)
      return
    }
    setDraft(null)
    setError(null)
    flash(id ? 'Opportunity updated.' : 'Opportunity added.')
    load()
  }

  async function remove(entry: PipelineEntry) {
    if (!window.confirm(`Delete "${entry.opportunity}" from the pipeline?`)) return
    const { error } = await supabase.from('pipeline_entries').delete().eq('id', entry.id)
    if (error) setError(error.message)
    else {
      flash('Opportunity deleted.')
      load()
    }
  }

  async function saveGoals() {
    const toNum = (v: string) => (v.trim() === '' ? null : Number(v.replace(/[$,]/g, '')))
    const revenue_goal = toNum(goalDraft.revenue_goal)
    const in_our_control_target = toNum(goalDraft.in_our_control_target)
    if ([revenue_goal, in_our_control_target].some((v) => v !== null && !Number.isFinite(v))) {
      setError('Goals must be numbers')
      return
    }
    const { error } = await supabase
      .from('year_goals')
      .upsert({ production_year: year, revenue_goal, in_our_control_target }, { onConflict: 'production_year' })
    if (error) setError(error.message)
    else {
      flash('Goals saved.')
      load()
    }
  }

  async function saveSnapshot() {
    const { error } = await supabase.rpc('record_weekly_snapshot')
    if (error) setError(error.message)
    else flash("This week's Pipeline and Awaiting PO totals were saved. The dashboard compares against them.")
  }

  async function downloadTemplate(withEntries: boolean) {
    const blob = await buildPipelineWorkbook(withEntries ? entries : [], year)
    downloadBlob(blob, withEntries ? `pipeline-${year}-${todayStamp()}.xlsx` : 'pipeline-template.xlsx')
    logEvent(withEntries ? 'pipeline_exported' : 'pipeline_template_downloaded', { year, rows: withEntries ? entries.length : 0 }, 'pipeline_entries')
  }

  async function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    try {
      const result = await parsePipelineWorkbook(file, year)
      // IDs from every year, so a row exported from another year updates
      // that entry instead of being added again.
      const { data, error } = await supabase.from('pipeline_entries').select('id')
      if (error) throw new Error(error.message)
      setRemoveMissing(false)
      setUpload({ fileName: file.name, result, knownIds: new Set((data ?? []).map((r) => r.id as string)) })
    } catch (err) {
      setError(`Couldn't read that file. Make sure it's an .xlsx file made from the template. (${String(err)})`)
    }
  }

  const uploadPlan = useMemo(() => {
    if (!upload) return null
    const existing = upload.knownIds
    const updates = upload.result.rows.filter((r) => r.id && existing.has(r.id))
    const inserts = upload.result.rows.filter((r) => !r.id || !existing.has(r.id))
    const inFile = new Set(updates.map((r) => r.id))
    const deletions = entries.filter((e) => !inFile.has(e.id))
    return { updates, inserts, deletions }
  }, [upload, entries])

  async function applyUpload() {
    if (!upload || !uploadPlan) return
    setSaving(true)
    const strip = ({ rowNumber: _rowNumber, id: _id, ...rest }: (typeof upload.result.rows)[number]) => rest
    try {
      for (const r of uploadPlan.updates) {
        const { error } = await supabase.from('pipeline_entries').update(strip(r)).eq('id', r.id!)
        if (error) throw new Error(`Row ${r.rowNumber}: ${error.message}`)
      }
      if (uploadPlan.inserts.length > 0) {
        const { error } = await supabase
          .from('pipeline_entries')
          .insert(uploadPlan.inserts.map((r) => ({ ...strip(r), created_by: user?.id ?? null })))
        if (error) throw new Error(error.message)
      }
      if (removeMissing && uploadPlan.deletions.length > 0) {
        const { error } = await supabase
          .from('pipeline_entries')
          .delete()
          .in('id', uploadPlan.deletions.map((d) => d.id))
        if (error) throw new Error(error.message)
      }
      await logEvent(
        'pipeline_imported',
        {
          file: upload.fileName,
          year,
          added: uploadPlan.inserts.length,
          updated: uploadPlan.updates.length,
          removed: removeMissing ? uploadPlan.deletions.length : 0,
          skipped_rows_with_errors: upload.result.errors.length,
        },
        'pipeline_entries',
      )
      flash(
        `Imported: ${uploadPlan.inserts.length} added, ${uploadPlan.updates.length} updated` +
          (removeMissing ? `, ${uploadPlan.deletions.length} removed` : '') +
          '.',
      )
      setUpload(null)
      load()
    } catch (err) {
      setError(`Import stopped: ${err instanceof Error ? err.message : String(err)}. Rows before this one were saved.`)
      load()
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center gap-3">
        <h2 className="text-lg font-semibold text-slate-900">Pipeline</h2>
        <select
          value={year}
          onChange={(e) => setYear(Number(e.target.value))}
          className="rounded-md border border-slate-300 px-2 py-1 text-sm"
        >
          {[CURRENT_YEAR + 1, CURRENT_YEAR, CURRENT_YEAR - 1].map((y) => (
            <option key={y} value={y}>
              {y}
            </option>
          ))}
        </select>
        <div className="ml-auto flex flex-wrap gap-2">
          {editable && (
            <button
              onClick={() => setDraft(emptyDraft(year))}
              className="rounded-md bg-blue-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-blue-700"
            >
              + Add opportunity
            </button>
          )}
          <button onClick={() => downloadTemplate(false)} className="rounded-md border border-slate-300 px-3 py-1.5 text-sm hover:bg-slate-100">
            Download blank template
          </button>
          <button onClick={() => downloadTemplate(true)} className="rounded-md border border-slate-300 px-3 py-1.5 text-sm hover:bg-slate-100">
            Export to Excel
          </button>
          {editable && (
            <>
              <button
                onClick={() => fileInput.current?.click()}
                className="rounded-md border border-slate-300 px-3 py-1.5 text-sm hover:bg-slate-100"
              >
                Upload template
              </button>
              <input ref={fileInput} type="file" accept=".xlsx" className="hidden" onChange={onFile} />
              <button onClick={saveSnapshot} className="rounded-md border border-slate-300 px-3 py-1.5 text-sm hover:bg-slate-100">
                Save this week's totals
              </button>
            </>
          )}
        </div>
      </div>

      {message && <p className="rounded-md bg-emerald-50 px-3 py-2 text-sm text-emerald-800">{message}</p>}
      {error && (
        <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">
          {error}{' '}
          <button className="underline" onClick={() => setError(null)}>
            Dismiss
          </button>
        </p>
      )}

      <div className="grid grid-cols-1 gap-3 md:grid-cols-4">
        <div className="rounded-lg border border-violet-200 bg-violet-50 p-4">
          <p className="text-xs font-semibold uppercase tracking-wide text-violet-700">Pipeline</p>
          <p className="mt-1 text-2xl font-semibold text-violet-900">{formatCurrency(totals.pipeline)}</p>
          <p className="text-xs text-violet-700">{totals.pipelineCount} opportunities</p>
        </div>
        <div className="rounded-lg border border-sky-200 bg-sky-50 p-4">
          <p className="text-xs font-semibold uppercase tracking-wide text-sky-700">Awaiting PO</p>
          <p className="mt-1 text-2xl font-semibold text-sky-900">{formatCurrency(totals.awaiting)}</p>
          <p className="text-xs text-sky-700">{totals.awaitingCount} opportunities</p>
        </div>
        <div className="rounded-lg border border-slate-200 bg-white p-4 md:col-span-2">
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">{year} goals</p>
          <div className="mt-2 grid grid-cols-2 gap-3">
            <label className="text-sm">
              <span className="text-slate-600">Revenue goal</span>
              <input
                value={goalDraft.revenue_goal}
                disabled={!editable}
                onChange={(e) => setGoalDraft((g) => ({ ...g, revenue_goal: e.target.value }))}
                placeholder="e.g. 9000000"
                className="mt-1 w-full rounded-md border border-slate-300 px-2 py-1 disabled:bg-slate-100"
              />
            </label>
            <label className="text-sm">
              <span className="text-slate-600">In-our-control target</span>
              <input
                value={goalDraft.in_our_control_target}
                disabled={!editable}
                onChange={(e) => setGoalDraft((g) => ({ ...g, in_our_control_target: e.target.value }))}
                placeholder="e.g. 8000000"
                className="mt-1 w-full rounded-md border border-slate-300 px-2 py-1 disabled:bg-slate-100"
              />
            </label>
          </div>
          {editable && (
            <div className="mt-2 flex items-center gap-3">
              <button onClick={saveGoals} className="rounded-md border border-slate-300 px-3 py-1 text-sm hover:bg-slate-100">
                Save goals
              </button>
              {goals && (
                <span className="text-xs text-slate-500">
                  Saved: {formatCurrency(goals.revenue_goal)} goal · {formatCurrency(goals.in_our_control_target)} in our control
                </span>
              )}
            </div>
          )}
        </div>
      </div>

      <div className="flex flex-wrap gap-1">
        {FILTERS.map((f) => (
          <button
            key={f.key}
            onClick={() => setFilter(f.key)}
            className={`rounded-full px-3 py-1 text-xs font-medium ${
              filter === f.key ? 'bg-slate-800 text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
            }`}
          >
            {f.label}
          </button>
        ))}
      </div>

      <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
        <table className="min-w-full divide-y divide-slate-200 text-sm">
          <thead className="bg-slate-50 text-xs uppercase text-slate-500">
            <tr>
              <th className="px-3 py-2 text-left">School / Opportunity</th>
              <th className="px-3 py-2 text-left">Stage</th>
              <th className="px-3 py-2 text-left">Likelihood</th>
              <th className="px-3 py-2 text-right">Labs</th>
              <th className="px-3 py-2 text-right">TS</th>
              <th className="px-3 py-2 text-right">Est. revenue</th>
              <th className="px-3 py-2 text-left">Expected PO</th>
              <th className="px-3 py-2 text-left">Owner</th>
              <th className="px-3 py-2 text-left">Notes</th>
              {editable && <th className="px-3 py-2" />}
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {loading ? (
              <tr>
                <td colSpan={10} className="px-3 py-6 text-center text-slate-400">
                  Loading…
                </td>
              </tr>
            ) : visible.length === 0 ? (
              <tr>
                <td colSpan={10} className="px-3 py-6 text-center text-slate-400">
                  No opportunities here yet.{editable && ' Add one, or upload the Excel template.'}
                </td>
              </tr>
            ) : (
              visible.map((e) => (
                <tr key={e.id} className="hover:bg-slate-50">
                  <td className="px-3 py-2 font-medium text-slate-900">{e.opportunity}</td>
                  <td className="px-3 py-2">
                    <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${STAGE_STYLES[e.stage]}`}>
                      {STAGE_LABELS[e.stage]}
                    </span>
                  </td>
                  <td className="px-3 py-2">{e.likelihood ? LIKELIHOOD_LABELS[e.likelihood] : '—'}</td>
                  <td className="px-3 py-2 text-right">{e.labs_qty || '—'}</td>
                  <td className="px-3 py-2 text-right">{e.ts_qty || '—'}</td>
                  <td className="px-3 py-2 text-right">{formatCurrency(e.estimated_revenue)}</td>
                  <td className="px-3 py-2">{formatDate(e.expected_po_date)}</td>
                  <td className="px-3 py-2">{e.owner ?? '—'}</td>
                  <td className="max-w-xs truncate px-3 py-2 text-slate-600" title={e.notes ?? ''}>
                    {e.notes ?? ''}
                  </td>
                  {editable && (
                    <td className="whitespace-nowrap px-3 py-2 text-right">
                      <button
                        onClick={() => setDraft({ ...e })}
                        className="text-blue-700 hover:underline"
                      >
                        Edit
                      </button>
                      <button onClick={() => remove(e)} className="ml-3 text-red-700 hover:underline">
                        Delete
                      </button>
                    </td>
                  )}
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {draft && (
        <div className="fixed inset-0 z-20 flex items-start justify-center bg-black/30 p-4" onClick={() => setDraft(null)}>
          <div className="mt-12 w-full max-w-lg rounded-lg bg-white p-5 shadow-xl" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-base font-semibold text-slate-900">{draft.id ? 'Edit opportunity' : 'Add opportunity'}</h3>
            <div className="mt-4 grid grid-cols-2 gap-3 text-sm">
              <label className="col-span-2">
                <span className="text-slate-600">School / Opportunity *</span>
                <input
                  autoFocus
                  value={draft.opportunity}
                  onChange={(e) => setDraft({ ...draft, opportunity: e.target.value })}
                  className="mt-1 w-full rounded-md border border-slate-300 px-2 py-1"
                />
              </label>
              <label>
                <span className="text-slate-600">Stage *</span>
                <select
                  value={draft.stage}
                  onChange={(e) => setDraft({ ...draft, stage: e.target.value as PipelineStage })}
                  className="mt-1 w-full rounded-md border border-slate-300 px-2 py-1"
                >
                  {(Object.keys(STAGE_LABELS) as PipelineStage[]).map((s) => (
                    <option key={s} value={s}>
                      {STAGE_LABELS[s]}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                <span className="text-slate-600">Likelihood</span>
                <select
                  value={draft.likelihood ?? ''}
                  onChange={(e) =>
                    setDraft({ ...draft, likelihood: (e.target.value || null) as OpportunityLikelihood | null })
                  }
                  className="mt-1 w-full rounded-md border border-slate-300 px-2 py-1"
                >
                  <option value="">—</option>
                  {(Object.keys(LIKELIHOOD_LABELS) as OpportunityLikelihood[]).map((l) => (
                    <option key={l} value={l}>
                      {LIKELIHOOD_LABELS[l]}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                <span className="text-slate-600">Labs</span>
                <input
                  type="number"
                  min={0}
                  value={draft.labs_qty}
                  onChange={(e) => setDraft({ ...draft, labs_qty: Number(e.target.value) || 0 })}
                  className="mt-1 w-full rounded-md border border-slate-300 px-2 py-1"
                />
              </label>
              <label>
                <span className="text-slate-600">Teacher stations</span>
                <input
                  type="number"
                  min={0}
                  value={draft.ts_qty}
                  onChange={(e) => setDraft({ ...draft, ts_qty: Number(e.target.value) || 0 })}
                  className="mt-1 w-full rounded-md border border-slate-300 px-2 py-1"
                />
              </label>
              <label>
                <span className="text-slate-600">Estimated revenue</span>
                <input
                  type="number"
                  min={0}
                  step="0.01"
                  value={draft.estimated_revenue ?? ''}
                  onChange={(e) =>
                    setDraft({ ...draft, estimated_revenue: e.target.value === '' ? null : Number(e.target.value) })
                  }
                  className="mt-1 w-full rounded-md border border-slate-300 px-2 py-1"
                />
              </label>
              <label>
                <span className="text-slate-600">Expected PO date</span>
                <input
                  type="date"
                  value={draft.expected_po_date ?? ''}
                  onChange={(e) => setDraft({ ...draft, expected_po_date: e.target.value || null })}
                  className="mt-1 w-full rounded-md border border-slate-300 px-2 py-1"
                />
              </label>
              <label>
                <span className="text-slate-600">Year</span>
                <input
                  type="number"
                  value={draft.production_year}
                  onChange={(e) => setDraft({ ...draft, production_year: Number(e.target.value) || year })}
                  className="mt-1 w-full rounded-md border border-slate-300 px-2 py-1"
                />
              </label>
              <label>
                <span className="text-slate-600">Owner</span>
                <input
                  value={draft.owner ?? ''}
                  onChange={(e) => setDraft({ ...draft, owner: e.target.value || null })}
                  className="mt-1 w-full rounded-md border border-slate-300 px-2 py-1"
                />
              </label>
              <label className="col-span-2">
                <span className="text-slate-600">Notes</span>
                <textarea
                  rows={3}
                  value={draft.notes ?? ''}
                  onChange={(e) => setDraft({ ...draft, notes: e.target.value || null })}
                  className="mt-1 w-full rounded-md border border-slate-300 px-2 py-1"
                />
              </label>
            </div>
            <div className="mt-4 flex justify-end gap-2">
              <button onClick={() => setDraft(null)} className="rounded-md border border-slate-300 px-3 py-1.5 text-sm">
                Cancel
              </button>
              <button
                onClick={saveDraft}
                disabled={saving}
                className="rounded-md bg-blue-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-60"
              >
                {saving ? 'Saving…' : 'Save'}
              </button>
            </div>
          </div>
        </div>
      )}

      {upload && uploadPlan && (
        <div className="fixed inset-0 z-20 flex items-start justify-center bg-black/30 p-4" onClick={() => setUpload(null)}>
          <div className="mt-12 w-full max-w-2xl rounded-lg bg-white p-5 shadow-xl" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-base font-semibold text-slate-900">Upload preview · {upload.fileName}</h3>
            <ul className="mt-3 space-y-1 text-sm text-slate-700">
              <li>
                <strong>{uploadPlan.inserts.length}</strong> new opportunities will be added
              </li>
              <li>
                <strong>{uploadPlan.updates.length}</strong> existing opportunities will be updated
              </li>
              {upload.result.errors.length > 0 && (
                <li className="text-red-700">
                  <strong>{upload.result.errors.length}</strong> rows have problems and will be skipped:
                </li>
              )}
            </ul>
            {upload.result.errors.length > 0 && (
              <ul className="mt-2 max-h-40 overflow-y-auto rounded-md bg-red-50 p-2 text-xs text-red-800">
                {upload.result.errors.map((e) => (
                  <li key={e.rowNumber}>
                    Row {e.rowNumber}: {e.message}
                  </li>
                ))}
              </ul>
            )}
            <label className="mt-4 flex items-start gap-2 text-sm text-slate-700">
              <input type="checkbox" checked={removeMissing} onChange={(e) => setRemoveMissing(e.target.checked)} className="mt-1" />
              <span>
                Remove {year} entries that aren't in this file ({uploadPlan.deletions.length}). Only tick this if the file is your
                complete {year} list.
              </span>
            </label>
            <div className="mt-4 flex justify-end gap-2">
              <button onClick={() => setUpload(null)} className="rounded-md border border-slate-300 px-3 py-1.5 text-sm">
                Cancel
              </button>
              <button
                onClick={applyUpload}
                disabled={saving || uploadPlan.inserts.length + uploadPlan.updates.length + (removeMissing ? uploadPlan.deletions.length : 0) === 0}
                className="rounded-md bg-blue-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-60"
              >
                {saving ? 'Importing…' : 'Import'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
