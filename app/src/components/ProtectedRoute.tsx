import type { ReactNode } from 'react'
import { Navigate } from 'react-router-dom'
import { useAuth } from '../contexts/AuthContext'
import type { AppRole } from '../types/database'

export function ProtectedRoute({
  children,
  allow,
}: {
  children: ReactNode
  /** Restrict to specific roles; omit to allow any authenticated user. */
  allow?: AppRole[]
}) {
  const { user, role, loading } = useAuth()

  if (loading) {
    return <div className="p-8 text-slate-500">Loading…</div>
  }

  if (!user) {
    return <Navigate to="/login" replace />
  }

  if (allow && (!role || !allow.includes(role))) {
    return (
      <div className="p-8">
        <p className="text-slate-700">
          Your role ({role ?? 'unassigned'}) doesn't have access to this page.
        </p>
      </div>
    )
  }

  return <>{children}</>
}
