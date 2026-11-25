import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabaseClient'
import { roleLabel } from '../lib/permissions'
import type { AppRole, UserRole } from '../types/database'

const ROLES: AppRole[] = ['admin', 'sales', 'operations', 'accounting']

export function AdminUsersPage() {
  const [users, setUsers] = useState<UserRole[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)

  const [email, setEmail] = useState('')
  const [fullName, setFullName] = useState('')
  const [role, setRole] = useState<AppRole>('sales')
  const [inviting, setInviting] = useState(false)

  async function load() {
    setLoading(true)
    const { data, error } = await supabase.from('user_roles').select('*').order('created_at')
    if (error) setError(error.message)
    else setUsers((data as UserRole[]) ?? [])
    setLoading(false)
  }

  useEffect(() => {
    load()
  }, [])

  async function invite() {
    setInviting(true)
    setError(null)
    setSuccess(null)
    const { error } = await supabase.functions.invoke('invite-user', {
      body: { email, role, full_name: fullName || undefined },
    })
    setInviting(false)
    if (error) {
      setError(error.message)
      return
    }
    setSuccess(`Invited ${email} as ${roleLabel(role)}.`)
    setEmail('')
    setFullName('')
    load()
  }

  async function changeRole(userId: string, newRole: AppRole) {
    const { error } = await supabase.from('user_roles').update({ role: newRole }).eq('user_id', userId)
    if (error) setError(error.message)
    else load()
  }

  return (
    <div>
      <h2 className="text-lg font-semibold text-slate-900">Manage users</h2>
      <p className="mt-1 text-sm text-slate-500">
        Invite a new teammate by email and assign their role. They'll get an email to set a password.
      </p>

      <div className="mt-4 flex flex-wrap items-end gap-2 rounded-lg border border-slate-200 bg-white p-3">
        <label className="text-sm">
          <span className="block text-xs font-medium text-slate-500">Email</span>
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="mt-1 rounded-md border border-slate-300 px-2 py-1 text-sm"
          />
        </label>
        <label className="text-sm">
          <span className="block text-xs font-medium text-slate-500">Name</span>
          <input
            value={fullName}
            onChange={(e) => setFullName(e.target.value)}
            className="mt-1 rounded-md border border-slate-300 px-2 py-1 text-sm"
          />
        </label>
        <label className="text-sm">
          <span className="block text-xs font-medium text-slate-500">Role</span>
          <select
            value={role}
            onChange={(e) => setRole(e.target.value as AppRole)}
            className="mt-1 rounded-md border border-slate-300 px-2 py-1 text-sm"
          >
            {ROLES.map((r) => (
              <option key={r} value={r}>
                {roleLabel(r)}
              </option>
            ))}
          </select>
        </label>
        <button
          onClick={invite}
          disabled={inviting || !email}
          className="rounded-md bg-blue-600 px-3 py-1.5 text-sm font-medium text-white disabled:opacity-60"
        >
          {inviting ? 'Inviting…' : 'Send invite'}
        </button>
      </div>

      {error && <p className="mt-3 text-sm text-red-600">{error}</p>}
      {success && <p className="mt-3 text-sm text-green-700">{success}</p>}

      <div className="mt-4 overflow-x-auto rounded-lg border border-slate-200 bg-white">
        <table className="min-w-full divide-y divide-slate-200 text-sm">
          <thead className="bg-slate-50 text-xs uppercase text-slate-500">
            <tr>
              <th className="px-3 py-2 text-left">Name</th>
              <th className="px-3 py-2 text-left">Role</th>
              <th className="px-3 py-2 text-left">Added</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {loading ? (
              <tr>
                <td colSpan={3} className="px-3 py-6 text-center text-slate-400">
                  Loading…
                </td>
              </tr>
            ) : (
              users.map((u) => (
                <tr key={u.user_id}>
                  <td className="px-3 py-2">{u.full_name ?? '—'}</td>
                  <td className="px-3 py-2">
                    <select
                      value={u.role}
                      onChange={(e) => changeRole(u.user_id, e.target.value as AppRole)}
                      className="rounded-md border border-slate-300 px-2 py-0.5 text-xs"
                    >
                      {ROLES.map((r) => (
                        <option key={r} value={r}>
                          {roleLabel(r)}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td className="px-3 py-2">{new Date(u.created_at).toLocaleDateString()}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}
