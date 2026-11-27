import { NavLink, Outlet } from 'react-router-dom'

const TABS = [
  { to: '/admin/users', label: 'Users' },
  { to: '/admin/audit', label: 'Audit trail' },
  { to: '/admin/backup', label: 'Backup' },
]

export function AdminLayout() {
  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3 border-b border-slate-200">
        <h2 className="pb-2 text-lg font-semibold text-slate-900">Admin</h2>
        <nav className="flex gap-1">
          {TABS.map((t) => (
            <NavLink
              key={t.to}
              to={t.to}
              className={({ isActive }) =>
                `rounded-t-md px-3 py-2 text-sm font-medium ${
                  isActive ? 'border-b-2 border-blue-600 text-blue-700' : 'text-slate-500 hover:text-slate-800'
                }`
              }
            >
              {t.label}
            </NavLink>
          ))}
        </nav>
      </div>
      <Outlet />
    </div>
  )
}
