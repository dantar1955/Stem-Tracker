import { useCallback, useEffect, useState } from 'react'
import { useAuth } from '../contexts/AuthContext'
import { callAdminFunction, generateTempPassword } from '../lib/adminApi'
import { formatDateTime } from '../lib/format'
import { roleLabel } from '../lib/permissions'
import type { AdminUser, AppRole } from '../types/database'

const ROLES: AppRole[] = ['admin', 'sales', 'operations', 'accounting']

type Dialog =
  | { kind: 'create' }
  | { kind: 'edit'; user: AdminUser }
  | { kind: 'reset'; user: AdminUser }
  | { kind: 'done'; title: string; email: string; password: string }

function PasswordField({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <div className="mt-1 flex gap-2">
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-full rounded-md border border-slate-300 px-2 py-1 font-mono"
        placeholder="At least 8 characters"
      />
      <button
        type="button"
        onClick={() => onChange(generateTempPassword())}
        className="whitespace-nowrap rounded-md border border-slate-300 px-2 py-1 text-xs hover:bg-slate-100"
      >
        Generate
      </button>
    </div>
  )
}

export function AdminUsersPage() {
  const { user: me } = useAuth()
  const [users, setUsers] = useState<AdminUser[]>([])
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [message, setMessage] = useState<string | null>(null)
  const [dialog, setDialog] = useState<Dialog | null>(null)
  const [form, setForm] = useState({ full_name: '', email: '', role: 'operations' as AppRole, temp_password: '' })

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const res = await callAdminFunction<{ users: AdminUser[] }>('admin-users', { action: 'list' })
      setUsers(res.users)
      setError(null)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
    setLoading(false)
  }, [])

  useEffect(() => {
    load()
  }, [load])

  function openCreate() {
    setForm({ full_name: '', email: '', role: 'operations', temp_password: generateTempPassword() })
    setDialog({ kind: 'create' })
  }

  function openEdit(u: AdminUser) {
    setForm({ full_name: u.full_name ?? '', email: u.email, role: u.role ?? 'operations', temp_password: '' })
    setDialog({ kind: 'edit', user: u })
  }

  function openReset(u: AdminUser) {
    setForm((f) => ({ ...f, temp_password: generateTempPassword() }))
    setDialog({ kind: 'reset', user: u })
  }

  async function run(action: () => Promise<void>) {
    setBusy(true)
    setError(null)
    try {
      await action()
      await load()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
    setBusy(false)
  }

  function submit() {
    if (!dialog) return
    if (dialog.kind === 'create') {
      run(async () => {
        await callAdminFunction('admin-users', { action: 'create', ...form })
        setDialog({ kind: 'done', title: 'User created', email: form.email.trim().toLowerCase(), password: form.temp_password })
      })
    } else if (dialog.kind === 'edit') {
      run(async () => {
        await callAdminFunction('admin-users', {
          action: 'update',
          user_id: dialog.user.id,
          full_name: form.full_name,
          email: form.email,
          role: form.role,
        })
        setDialog(null)
        setMessage('User updated.')
      })
    } else if (dialog.kind === 'reset') {
      run(async () => {
        await callAdminFunction('admin-users', { action: 'reset_password', user_id: dialog.user.id, temp_password: form.temp_password })
        setDialog({ kind: 'done', title: 'Password reset', email: dialog.user.email, password: form.temp_password })
      })
    }
  }

  function toggleSuspend(u: AdminUser) {
    const verb = u.suspended ? 'Restore access for' : 'Suspend'
    if (!window.confirm(`${verb} ${u.full_name ?? u.email}?${u.suspended ? '' : ' They will be signed out and blocked from signing in.'}`)) return
    run(async () => {
      await callAdminFunction('admin-users', { action: u.suspended ? 'unsuspend' : 'suspend', user_id: u.id })
      setMessage(u.suspended ? 'Access restored.' : 'User suspended.')
    })
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-sm text-slate-600">
          Create users with a temporary password; they'll be asked to choose their own the first time they sign in.
        </p>
        <button onClick={openCreate} className="rounded-md bg-blue-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-blue-700">
          + Add user
        </button>
      </div>

      {message && (
        <p className="rounded-md bg-emerald-50 px-3 py-2 text-sm text-emerald-800">
          {message}{' '}
          <button className="underline" onClick={() => setMessage(null)}>
            Dismiss
          </button>
        </p>
      )}
      {error && <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}

      <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
        <table className="min-w-full divide-y divide-slate-200 text-sm">
          <thead className="bg-slate-50 text-xs uppercase text-slate-500">
            <tr>
              <th className="px-3 py-2 text-left">Name</th>
              <th className="px-3 py-2 text-left">Email</th>
              <th className="px-3 py-2 text-left">Role</th>
              <th className="px-3 py-2 text-left">Status</th>
              <th className="px-3 py-2 text-left">Last sign-in</th>
              <th className="px-3 py-2" />
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {loading ? (
              <tr>
                <td colSpan={6} className="px-3 py-6 text-center text-slate-400">
                  Loading…
                </td>
              </tr>
            ) : (
              users.map((u) => (
                <tr key={u.id} className={u.suspended ? 'bg-slate-50 text-slate-400' : ''}>
                  <td className="px-3 py-2 font-medium">{u.full_name ?? '—'}</td>
                  <td className="px-3 py-2">{u.email}</td>
                  <td className="px-3 py-2">{u.role ? roleLabel(u.role) : <span className="text-amber-700">No role</span>}</td>
                  <td className="px-3 py-2">
                    {u.suspended ? (
                      <span className="rounded-full bg-red-100 px-2 py-0.5 text-xs font-medium text-red-700">Suspended</span>
                    ) : u.must_change_password ? (
                      <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-800">Temp password</span>
                    ) : (
                      <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-medium text-emerald-800">Active</span>
                    )}
                  </td>
                  <td className="px-3 py-2">{formatDateTime(u.last_sign_in_at)}</td>
                  <td className="whitespace-nowrap px-3 py-2 text-right">
                    <button disabled={busy} onClick={() => openEdit(u)} className="text-blue-700 hover:underline">
                      Edit
                    </button>
                    <button disabled={busy} onClick={() => openReset(u)} className="ml-3 text-blue-700 hover:underline">
                      Reset password
                    </button>
                    {u.id !== me?.id && (
                      <button
                        disabled={busy}
                        onClick={() => toggleSuspend(u)}
                        className={`ml-3 hover:underline ${u.suspended ? 'text-emerald-700' : 'text-red-700'}`}
                      >
                        {u.suspended ? 'Restore access' : 'Suspend'}
                      </button>
                    )}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {dialog && (
        <div className="fixed inset-0 z-20 flex items-start justify-center bg-black/30 p-4" onClick={() => !busy && setDialog(null)}>
          <div className="mt-16 w-full max-w-md rounded-lg bg-white p-5 shadow-xl" onClick={(e) => e.stopPropagation()}>
            {dialog.kind === 'done' ? (
              <>
                <h3 className="text-base font-semibold text-slate-900">{dialog.title}</h3>
                <p className="mt-2 text-sm text-slate-600">
                  Share these sign-in details with the user privately. They'll choose their own password when they sign in. This
                  password won't be shown again.
                </p>
                <div className="mt-3 rounded-md bg-slate-50 p-3 font-mono text-sm">
                  <div>Email: {dialog.email}</div>
                  <div>Temporary password: {dialog.password}</div>
                </div>
                <div className="mt-4 flex justify-end gap-2">
                  <button
                    onClick={() => navigator.clipboard?.writeText(`Email: ${dialog.email}\nTemporary password: ${dialog.password}`)}
                    className="rounded-md border border-slate-300 px-3 py-1.5 text-sm"
                  >
                    Copy
                  </button>
                  <button onClick={() => setDialog(null)} className="rounded-md bg-blue-600 px-3 py-1.5 text-sm font-medium text-white">
                    Done
                  </button>
                </div>
              </>
            ) : (
              <>
                <h3 className="text-base font-semibold text-slate-900">
                  {dialog.kind === 'create' ? 'Add user' : dialog.kind === 'edit' ? 'Edit user' : `Reset password · ${dialog.user.email}`}
                </h3>
                <div className="mt-4 space-y-3 text-sm">
                  {dialog.kind !== 'reset' && (
                    <>
                      <label className="block">
                        <span className="text-slate-600">Full name</span>
                        <input
                          value={form.full_name}
                          onChange={(e) => setForm({ ...form, full_name: e.target.value })}
                          className="mt-1 w-full rounded-md border border-slate-300 px-2 py-1"
                        />
                      </label>
                      <label className="block">
                        <span className="text-slate-600">Email</span>
                        <input
                          type="email"
                          value={form.email}
                          onChange={(e) => setForm({ ...form, email: e.target.value })}
                          className="mt-1 w-full rounded-md border border-slate-300 px-2 py-1"
                        />
                      </label>
                      <label className="block">
                        <span className="text-slate-600">Role</span>
                        <select
                          value={form.role}
                          onChange={(e) => setForm({ ...form, role: e.target.value as AppRole })}
                          className="mt-1 w-full rounded-md border border-slate-300 px-2 py-1"
                        >
                          {ROLES.map((r) => (
                            <option key={r} value={r}>
                              {roleLabel(r)}
                            </option>
                          ))}
                        </select>
                      </label>
                    </>
                  )}
                  {dialog.kind !== 'edit' && (
                    <label className="block">
                      <span className="text-slate-600">Temporary password</span>
                      <PasswordField value={form.temp_password} onChange={(v) => setForm({ ...form, temp_password: v })} />
                      <span className="mt-1 block text-xs text-slate-500">They'll be asked to change it when they next sign in.</span>
                    </label>
                  )}
                </div>
                {error && <p className="mt-3 text-sm text-red-700">{error}</p>}
                <div className="mt-4 flex justify-end gap-2">
                  <button disabled={busy} onClick={() => setDialog(null)} className="rounded-md border border-slate-300 px-3 py-1.5 text-sm">
                    Cancel
                  </button>
                  <button
                    disabled={busy}
                    onClick={submit}
                    className="rounded-md bg-blue-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-60"
                  >
                    {busy ? 'Saving…' : dialog.kind === 'create' ? 'Create user' : dialog.kind === 'edit' ? 'Save' : 'Reset password'}
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
