import { useMemo } from 'react'
import { NavLink, Navigate, Route, Routes } from 'react-router-dom'
import { marked } from 'marked'
import quickstart from '../knowledgebase/quickstart.md?raw'
import manual from '../knowledgebase/manual.md?raw'

const ARTICLES = [
  { path: 'quickstart', label: 'Quickstart guide', blurb: 'Your first ten minutes' },
  { path: 'manual', label: 'Instruction manual', blurb: 'Every screen explained' },
  { path: 'video', label: 'Explainer video', blurb: 'A three-minute tour' },
]

function Article({ markdown }: { markdown: string }) {
  // The articles are our own files bundled with the app, not user input.
  const html = useMemo(() => marked.parse(markdown, { async: false, gfm: true }) as string, [markdown])
  return (
    <div>
      <div className="mb-4 flex justify-end print:hidden">
        <button onClick={() => window.print()} className="rounded-md border border-slate-300 px-3 py-1.5 text-sm hover:bg-slate-100">
          Print / save as PDF
        </button>
      </div>
      <article className="kb-article" dangerouslySetInnerHTML={{ __html: html }} />
    </div>
  )
}

function Video() {
  return (
    <div className="space-y-3">
      <h1 className="text-2xl font-semibold text-slate-900">Explainer video</h1>
      <p className="text-sm text-slate-600">
        A three-minute tour of the tracker: the dashboard, orders, the pipeline, the knowledgebase and the admin tools.
      </p>
      <video
        controls
        preload="metadata"
        poster="/knowledgebase/stem-tracker-explainer-poster.jpg"
        className="w-full max-w-4xl rounded-lg border border-slate-200 bg-black"
      >
        <source src="/knowledgebase/stem-tracker-explainer.mp4" type="video/mp4" />
        <track kind="captions" src="/knowledgebase/stem-tracker-explainer.vtt" srcLang="en" label="English" default />
      </video>
      <p className="text-xs text-slate-500">
        Captions are on by default — use the CC button to turn them off.{' '}
        <a href="/knowledgebase/stem-tracker-explainer.mp4" download className="text-blue-700 underline">
          Download the video
        </a>
      </p>
    </div>
  )
}

export function KnowledgebasePage() {
  return (
    <div className="flex flex-col gap-6 md:flex-row">
      <aside className="md:w-56 md:shrink-0 print:hidden">
        <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-slate-500">Knowledgebase</h2>
        <nav className="flex flex-col gap-1">
          {ARTICLES.map((a) => (
            <NavLink
              key={a.path}
              to={`/knowledgebase/${a.path}`}
              className={({ isActive }) =>
                `rounded-md px-3 py-2 text-sm ${isActive ? 'bg-blue-50 font-medium text-blue-800' : 'text-slate-700 hover:bg-slate-100'}`
              }
            >
              {a.label}
              <span className="block text-xs font-normal text-slate-500">{a.blurb}</span>
            </NavLink>
          ))}
        </nav>
      </aside>
      <div className="min-w-0 flex-1 rounded-lg border border-slate-200 bg-white p-6 print:border-0 print:p-0">
        <Routes>
          <Route index element={<Navigate to="quickstart" replace />} />
          <Route path="quickstart" element={<Article markdown={quickstart} />} />
          <Route path="manual" element={<Article markdown={manual} />} />
          <Route path="video" element={<Video />} />
          <Route path="*" element={<Navigate to="quickstart" replace />} />
        </Routes>
      </div>
    </div>
  )
}
