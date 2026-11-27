// Dashboard tiles. Unlike the spreadsheet, every colour means one thing,
// explained by the legend at the top of the dashboard (see TONES).

export type Tone = 'done' | 'progress' | 'action' | 'risk' | 'forecast' | 'neutral'

export const TONES: Record<Tone, { label: string; meaning: string; bar: string; body: string; value: string; swatch: string }> = {
  done: {
    label: 'Green',
    meaning: 'Done / money in',
    bar: 'bg-emerald-600',
    body: 'bg-emerald-50 border-emerald-200',
    value: 'text-emerald-900',
    swatch: 'bg-emerald-600',
  },
  progress: {
    label: 'Blue',
    meaning: 'In progress, on track',
    bar: 'bg-blue-600',
    body: 'bg-blue-50 border-blue-200',
    value: 'text-blue-900',
    swatch: 'bg-blue-600',
  },
  action: {
    label: 'Amber',
    meaning: 'Needs action',
    bar: 'bg-amber-500',
    body: 'bg-amber-50 border-amber-200',
    value: 'text-amber-900',
    swatch: 'bg-amber-500',
  },
  risk: {
    label: 'Red',
    meaning: 'At risk',
    bar: 'bg-red-600',
    body: 'bg-red-50 border-red-200',
    value: 'text-red-900',
    swatch: 'bg-red-600',
  },
  forecast: {
    label: 'Purple',
    meaning: 'Forecast, not yet on a PO',
    bar: 'bg-violet-600',
    body: 'bg-violet-50 border-violet-200',
    value: 'text-violet-900',
    swatch: 'bg-violet-600',
  },
  neutral: {
    label: 'Grey',
    meaning: 'For information / nothing to do',
    bar: 'bg-slate-500',
    body: 'bg-white border-slate-200',
    value: 'text-slate-900',
    swatch: 'bg-slate-400',
  },
}

export function StatCard({
  label,
  value,
  sublabel,
  tone = 'neutral',
  big = false,
}: {
  label: string
  value: string
  sublabel?: string
  tone?: Tone
  big?: boolean
}) {
  const t = TONES[tone]
  return (
    <div className={`overflow-hidden rounded-lg border ${t.body}`} title={t.meaning}>
      <div className={`${t.bar} px-4 py-1.5 text-xs font-semibold uppercase tracking-wide text-white`}>{label}</div>
      <div className="px-4 py-3 text-center">
        <p className={`${big ? 'text-3xl' : 'text-2xl'} font-bold ${t.value}`}>{value}</p>
        {sublabel && <p className="mt-1 text-xs text-slate-600">{sublabel}</p>}
      </div>
    </div>
  )
}

export function SectionBanner({ number, title, subtitle }: { number: number; title: string; subtitle?: string }) {
  return (
    <div className="rounded-md bg-blue-950 px-4 py-2 text-white">
      <span className="font-semibold">
        <span className="mr-2 inline-flex h-6 w-6 items-center justify-center rounded-full border border-white/60 text-sm">
          {number}
        </span>
        {title}
      </span>
      {subtitle && <span className="ml-2 text-sm text-blue-200">— {subtitle}</span>}
    </div>
  )
}

export function ColorLegend() {
  const order: Tone[] = ['done', 'progress', 'action', 'risk', 'forecast', 'neutral']
  return (
    <div className="flex flex-wrap gap-x-5 gap-y-1 rounded-md border border-slate-200 bg-white px-3 py-2 text-xs text-slate-600">
      <span className="font-semibold text-slate-700">Colour key:</span>
      {order.map((tone) => (
        <span key={tone} className="flex items-center gap-1.5">
          <span className={`inline-block h-3 w-3 rounded-sm ${TONES[tone].swatch}`} />
          {TONES[tone].meaning}
        </span>
      ))}
    </div>
  )
}
