import { NavLink, Outlet } from 'react-router-dom'
import { useAuth } from '../contexts/AuthContext'
import { roleLabel } from '../lib/permissions'

const NAV_ITEMS = [
  { to: '/', label: 'Dashboard' },
  { to: '/orders', label: 'Orders' },
  { to: '/builds', label: 'Build Tracker' },
  { to: '/shortages', label: 'Shortages' },
  { to: '/device-shipments', label: 'Device Shipping' },
  { to: '/simulation', label: 'Simulation' },
  { to: '/reporting', label: 'Reporting' },
]

export function Layout() {
  const { user, role, signOut } = useAuth()

  return (
    <div className="min-h-screen flex flex-col">
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto max-w-7xl px-4 py-3 flex items-center justify-between">
          <div>
            <h1 className="text-lg font-semibold text-slate-900">STEM Production Tracker</h1>
            <p className="text-xs text-slate-500">A+ Mobile Solutions</p>
          </div>
          <div className="flex items-center gap-4 text-sm">
            {role === 'admin' && (
              <NavLink to="/admin/users" className="text-slate-600 hover:text-slate-900">
                Manage users
              </NavLink>
            )}
            <span className="text-slate-600">
              {user?.email} <span className="text-slate-400">· {role ? roleLabel(role) : 'no role'}</span>
            </span>
            <button
              onClick={() => signOut()}
              className="rounded-md border border-slate-300 px-3 py-1 text-slate-700 hover:bg-slate-100"
            >
              Sign out
            </button>
          </div>
        </div>
        <nav className="mx-auto max-w-7xl px-4 flex gap-1 overflow-x-auto">
          {NAV_ITEMS.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.to === '/'}
              className={({ isActive }) =>
                `whitespace-nowrap rounded-t-md px-3 py-2 text-sm font-medium ${
                  isActive
                    ? 'border-b-2 border-blue-600 text-blue-700'
                    : 'text-slate-500 hover:text-slate-800'
                }`
              }
            >
              {item.label}
            </NavLink>
          ))}
        </nav>
      </header>
      <main className="flex-1 mx-auto w-full max-w-7xl px-4 py-6">
        <Outlet />
      </main>
    </div>
  )
}
