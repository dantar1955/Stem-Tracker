export function StatCard({
  label,
  value,
  sublabel,
  accent = false,
}: {
  label: string
  value: string
  sublabel?: string
  accent?: boolean
}) {
  return (
    <div
      className={`rounded-lg border p-4 ${
        accent ? 'border-blue-200 bg-blue-50' : 'border-slate-200 bg-white'
      }`}
    >
      <p className="text-xs font-medium uppercase tracking-wide text-slate-500">{label}</p>
      <p className={`mt-1 text-2xl font-semibold ${accent ? 'text-blue-700' : 'text-slate-900'}`}>{value}</p>
      {sublabel && <p className="mt-1 text-xs text-slate-500">{sublabel}</p>}
    </div>
  )
}
