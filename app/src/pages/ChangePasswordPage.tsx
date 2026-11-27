import { useState, type FormEvent } from 'react'
import { supabase } from '../lib/supabaseClient'
import { logEvent } from '../lib/audit'
import { useAuth } from '../contexts/AuthContext'

// Shown instead of the app while a user is on a temporary password that an
// admin set for them. They can't do anything else until they choose their own.
export function ChangePasswordPage() {
  const { user, signOut } = useAuth()
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  async function submit(e: FormEvent) {
    e.preventDefault()
    if (password.length < 8) return setError('Use at least 8 characters.')
    if (password !== confirm) return setError("The two passwords don't match.")
    setSaving(true)
    setError(null)
    const { error } = await supabase.auth.updateUser({ password, data: { must_change_password: false } })
    setSaving(false)
    if (error) {
      setError(error.message)
      return
    }
    await logEvent('password_changed')
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-50 px-4">
      <form onSubmit={submit} className="w-full max-w-sm rounded-lg border border-slate-200 bg-white p-6 shadow-sm">
        <h1 className="text-lg font-semibold text-slate-900">Choose your password</h1>
        <p className="mt-1 text-sm text-slate-500">
          You signed in as {user?.email} with a temporary password. Choose your own to continue.
        </p>
        <label className="mt-4 block text-sm font-medium text-slate-700">
          New password
          <input
            type="password"
            autoComplete="new-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
          />
        </label>
        <label className="mt-3 block text-sm font-medium text-slate-700">
          Confirm new password
          <input
            type="password"
            autoComplete="new-password"
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
            className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
          />
        </label>
        {error && <p className="mt-3 text-sm text-red-600">{error}</p>}
        <button
          type="submit"
          disabled={saving}
          className="mt-5 w-full rounded-md bg-blue-600 px-3 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-60"
        >
          {saving ? 'Saving…' : 'Save and continue'}
        </button>
        <button type="button" onClick={() => signOut()} className="mt-2 w-full text-sm text-slate-500 hover:underline">
          Sign out
        </button>
      </form>
    </div>
  )
}
