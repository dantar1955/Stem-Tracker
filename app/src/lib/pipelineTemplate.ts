// Excel template for the Pipeline tab: download it (blank, or filled with
// the current entries), edit it in Excel, and upload it again. ExcelJS is
// loaded only when one of these functions runs, so it doesn't slow down
// the rest of the app.

import type { OpportunityLikelihood, PipelineEntry, PipelineStage } from '../types/database'

export const STAGE_LABELS: Record<PipelineStage, string> = {
  pipeline: 'Pipeline',
  awaiting_po: 'Awaiting PO',
  po_received: 'PO received',
  lost: 'Lost',
}

export const LIKELIHOOD_LABELS: Record<OpportunityLikelihood, string> = {
  most_likely: 'Most likely',
  possible: 'Possible',
}

const COLUMNS = [
  { key: 'opportunity', header: 'School / Opportunity *', width: 32 },
  { key: 'stage', header: 'Stage *', width: 15 },
  { key: 'likelihood', header: 'Likelihood', width: 13 },
  { key: 'labs_qty', header: 'Labs', width: 8 },
  { key: 'ts_qty', header: 'Teacher stations', width: 16 },
  { key: 'estimated_revenue', header: 'Estimated revenue', width: 18 },
  { key: 'expected_po_date', header: 'Expected PO date', width: 17 },
  { key: 'production_year', header: 'Year', width: 8 },
  { key: 'owner', header: 'Owner', width: 16 },
  { key: 'notes', header: 'Notes', width: 40 },
  { key: 'id', header: 'ID (leave blank for new rows)', width: 38 },
] as const

type ColumnKey = (typeof COLUMNS)[number]['key']

export interface ParsedPipelineRow {
  rowNumber: number
  id: string | null
  opportunity: string
  stage: PipelineStage
  likelihood: OpportunityLikelihood | null
  labs_qty: number
  ts_qty: number
  estimated_revenue: number | null
  expected_po_date: string | null
  production_year: number
  owner: string | null
  notes: string | null
}

export interface ParseResult {
  rows: ParsedPipelineRow[]
  errors: { rowNumber: number; message: string }[]
}

async function loadExcel() {
  const mod = await import('exceljs')
  return mod.default ?? mod
}

function isoDate(d: Date): string {
  // Excel dates arrive as UTC midnight; read them back as UTC.
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`
}

/** Builds the template workbook. Pass entries to pre-fill it (export), or none for a blank template. */
export async function buildPipelineWorkbook(entries: PipelineEntry[], year: number): Promise<Blob> {
  const ExcelJS = await loadExcel()
  const wb = new ExcelJS.Workbook()
  wb.creator = 'STEM Production Tracker'

  const ws = wb.addWorksheet('Pipeline', { views: [{ state: 'frozen', ySplit: 1 }] })
  ws.columns = COLUMNS.map((c) => ({ key: c.key, header: c.header, width: c.width }))

  const header = ws.getRow(1)
  header.font = { bold: true, color: { argb: 'FFFFFFFF' } }
  header.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1E3A8A' } }
  header.alignment = { vertical: 'middle' }
  header.height = 22
  ws.getCell('K1').fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF64748B' } }

  for (const e of entries) {
    ws.addRow({
      opportunity: e.opportunity,
      stage: STAGE_LABELS[e.stage],
      likelihood: e.likelihood ? LIKELIHOOD_LABELS[e.likelihood] : null,
      labs_qty: e.labs_qty,
      ts_qty: e.ts_qty,
      estimated_revenue: e.estimated_revenue,
      expected_po_date: e.expected_po_date ? new Date(`${e.expected_po_date}T00:00:00Z`) : null,
      production_year: e.production_year,
      owner: e.owner,
      notes: e.notes,
      id: e.id,
    })
  }

  const lastRow = Math.max(500, entries.length + 200)
  const stageList = `"${Object.values(STAGE_LABELS).join(',')}"`
  const likelihoodList = `"${Object.values(LIKELIHOOD_LABELS).join(',')}"`
  for (let r = 2; r <= lastRow; r++) {
    ws.getCell(`B${r}`).dataValidation = {
      type: 'list',
      allowBlank: false,
      formulae: [stageList],
      showErrorMessage: true,
      errorTitle: 'Stage',
      error: 'Pick Pipeline, Awaiting PO, PO received or Lost.',
    }
    ws.getCell(`C${r}`).dataValidation = { type: 'list', allowBlank: true, formulae: [likelihoodList] }
    ws.getCell(`F${r}`).numFmt = '$#,##0.00'
    ws.getCell(`G${r}`).numFmt = 'm/d/yyyy'
    ws.getCell(`K${r}`).font = { color: { argb: 'FF94A3B8' } }
  }

  const help = wb.addWorksheet('How to use')
  help.getColumn(1).width = 110
  const lines = [
    'Pipeline template — STEM Production Tracker',
    '',
    '1. Fill in one row per opportunity on the "Pipeline" tab. Columns marked * are required.',
    '2. Stage: Pipeline = early opportunity; Awaiting PO = verbal yes, waiting on the PO;',
    '   PO received = won (it will come in from NetSuite as an order); Lost = no longer expected.',
    '   Pipeline and Awaiting PO both count toward the dashboard\'s Total Projected.',
    '3. Likelihood (optional): Most likely or Possible.',
    `4. Year: the production year the revenue belongs to. Blank means ${year}.`,
    '5. ID: leave blank for new rows. Rows exported from the app keep their ID — don\'t change it,',
    '   so uploading the file updates those entries instead of adding duplicates.',
    '6. In the app, open Pipeline → Upload template, check the preview, then click Import.',
    '   Tick "Remove entries that aren\'t in this file" only if this file is your complete list.',
  ]
  lines.forEach((t, i) => {
    const cell = help.getCell(`A${i + 1}`)
    cell.value = t
    if (i === 0) cell.font = { bold: true, size: 14 }
  })

  const buffer = await wb.xlsx.writeBuffer()
  return new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' })
}

function cellText(value: unknown): string {
  if (value == null) return ''
  if (value instanceof Date) return isoDate(value)
  if (typeof value === 'object') {
    const v = value as { text?: unknown; result?: unknown; richText?: { text: string }[]; hyperlink?: string }
    if (v.richText) return v.richText.map((p) => p.text).join('')
    if (v.result !== undefined) return cellText(v.result)
    if (v.text !== undefined) return cellText(v.text)
    return ''
  }
  return String(value).trim()
}

function fromLabel<T extends string>(labels: Record<T, string>, raw: string): T | null {
  const t = raw.trim().toLowerCase().replace(/[_-]/g, ' ')
  for (const [code, label] of Object.entries(labels) as [T, string][]) {
    if (t === label.toLowerCase() || t === code.replace(/_/g, ' ')) return code
  }
  return null
}

function parseDate(value: unknown): string | null | 'invalid' {
  if (value == null || value === '') return null
  if (value instanceof Date) return isoDate(value)
  if (typeof value === 'number') {
    // Excel serial date
    const d = new Date(Date.UTC(1899, 11, 30) + value * 86400000)
    return isoDate(d)
  }
  const t = cellText(value)
  if (!t) return null
  let y: number, mo: number, d: number
  let m = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(t)
  if (m) {
    ;[y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])]
  } else if ((m = /^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/.exec(t))) {
    ;[mo, d, y] = [Number(m[1]), Number(m[2]), Number(m[3].length === 2 ? `20${m[3]}` : m[3])]
  } else {
    return 'invalid'
  }
  // Reject impossible dates such as 13/45/2027 or 2/30/2027.
  const check = new Date(Date.UTC(y, mo - 1, d))
  if (check.getUTCFullYear() !== y || check.getUTCMonth() !== mo - 1 || check.getUTCDate() !== d) return 'invalid'
  return isoDate(check)
}

function parseNumber(raw: string): number | null | 'invalid' {
  if (!raw) return null
  const n = Number(raw.replace(/[$,\s]/g, ''))
  return Number.isFinite(n) ? n : 'invalid'
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** Reads an uploaded template. Header names are matched loosely, so column order doesn't matter. */
export async function parsePipelineWorkbook(file: File, defaultYear: number): Promise<ParseResult> {
  const ExcelJS = await loadExcel()
  const wb = new ExcelJS.Workbook()
  await wb.xlsx.load(await file.arrayBuffer())
  const ws = wb.getWorksheet('Pipeline') ?? wb.worksheets[0]
  if (!ws) return { rows: [], errors: [{ rowNumber: 0, message: 'The file has no worksheets.' }] }

  const colFor = new Map<ColumnKey, number>()
  ws.getRow(1).eachCell((cell, col) => {
    const h = cellText(cell.value).toLowerCase().replace(/\*/g, '').trim()
    const match = COLUMNS.find((c) => {
      const want = c.header.toLowerCase().replace(/\*/g, '').trim()
      return h === want || want.startsWith(h) || (c.key === 'id' && h.startsWith('id'))
    })
    if (match && !colFor.has(match.key)) colFor.set(match.key, col)
  })

  if (!colFor.has('opportunity') || !colFor.has('stage')) {
    return {
      rows: [],
      errors: [{ rowNumber: 1, message: 'Header row must include "School / Opportunity" and "Stage". Use the template from the app.' }],
    }
  }

  const rows: ParsedPipelineRow[] = []
  const errors: ParseResult['errors'] = []

  ws.eachRow({ includeEmpty: false }, (row, rowNumber) => {
    if (rowNumber === 1) return
    const raw = (key: ColumnKey) => {
      const col = colFor.get(key)
      return col ? row.getCell(col).value : null
    }
    const text = (key: ColumnKey) => cellText(raw(key))

    const anything = COLUMNS.some((c) => text(c.key) !== '')
    if (!anything) return

    const problems: string[] = []
    const opportunity = text('opportunity')
    if (!opportunity) problems.push('School / Opportunity is required')

    const stage = fromLabel(STAGE_LABELS, text('stage'))
    if (!stage) problems.push(`Stage "${text('stage')}" isn't one of: ${Object.values(STAGE_LABELS).join(', ')}`)

    const likelihoodText = text('likelihood')
    const likelihood = likelihoodText ? fromLabel(LIKELIHOOD_LABELS, likelihoodText) : null
    if (likelihoodText && !likelihood) problems.push(`Likelihood "${likelihoodText}" should be Most likely or Possible`)

    const labs = parseNumber(text('labs_qty'))
    const ts = parseNumber(text('ts_qty'))
    const revenue = parseNumber(text('estimated_revenue'))
    const year = parseNumber(text('production_year'))
    if (labs === 'invalid') problems.push('Labs must be a number')
    if (ts === 'invalid') problems.push('Teacher stations must be a number')
    if (revenue === 'invalid') problems.push('Estimated revenue must be a number')
    if (year === 'invalid' || (typeof year === 'number' && (year < 2000 || year > 2100))) problems.push('Year must be like 2026')

    const date = parseDate(raw('expected_po_date'))
    if (date === 'invalid') problems.push('Expected PO date must be a date like 1/15/2027')

    const id = text('id') || null
    if (id && !UUID_RE.test(id)) problems.push("ID was changed — leave it as exported, or clear it to add a new entry")

    if (problems.length > 0) {
      errors.push({ rowNumber, message: problems.join('; ') })
      return
    }

    rows.push({
      rowNumber,
      id,
      opportunity,
      stage: stage!,
      likelihood,
      labs_qty: Math.round((labs as number | null) ?? 0),
      ts_qty: Math.round((ts as number | null) ?? 0),
      estimated_revenue: revenue as number | null,
      expected_po_date: date as string | null,
      production_year: (year as number | null) ?? defaultYear,
      owner: text('owner') || null,
      notes: text('notes') || null,
    })
  })

  return { rows, errors }
}
