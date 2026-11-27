import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import type { Session, User } from '@supabase/supabase-js'
import { supabase } from '../lib/supabaseClient'
import { logEvent } from '../lib/audit'
import type { AppRole } from '../types/database'

interface AuthContextValue {
  user: User | null
  session: Session | null
  role: AppRole | null
  loading: boolean
  /** True while the user is still on a temporary password set by an admin. */
  mustChangePassword: boolean
  /** Set when a suspended user was signed out, so the login page can say why. */
  notice: string | null
  signInWithPassword: (email: string, password: string) => Promise<{ error: string | null }>
  signOut: () => Promise<void>
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined)

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null)
  const [role, setRole] = useState<AppRole | null>(null)
  const [loading, setLoading] = useState(true)
  const [notice, setNotice] = useState<string | null>(null)

  useEffect(() => {
    let mounted = true

    supabase.auth.getSession().then(({ data }) => {
      if (!mounted) return
      setSession(data.session)
      setLoading(false)
    })

    const { data: listener } = supabase.auth.onAuthStateChange((_event, newSession) => {
      setSession(newSession)
    })

    return () => {
      mounted = false
      listener.subscription.unsubscribe()
    }
  }, [])

  useEffect(() => {
    let mounted = true

    if (!session?.user) {
      setRole(null)
      return
    }

    supabase
      .from('user_roles')
      .select('role, suspended')
      .eq('user_id', session.user.id)
      .maybeSingle()
      .then(({ data, error }) => {
        if (!mounted) return
        if (error) {
          console.error('Failed to load role for current user', error)
          setRole(null)
          return
        }
        if (data?.suspended) {
          // Suspended by an admin: end this session straight away.
          setNotice('Your access has been suspended. Contact an administrator.')
          setRole(null)
          supabase.auth.signOut()
          return
        }
        setRole((data?.role as AppRole) ?? null)
      })

    return () => {
      mounted = false
    }
  }, [session?.user?.id])

  const value = useMemo<AuthContextValue>(
    () => ({
      user: session?.user ?? null,
      session,
      role,
      loading,
      mustChangePassword: Boolean(session?.user?.user_metadata?.must_change_password),
      notice,
      async signInWithPassword(email: string, password: string) {
        setNotice(null)
        const { error } = await supabase.auth.signInWithPassword({ email, password })
        if (error) {
          const banned = /banned/i.test(error.message)
          return { error: banned ? 'Your access has been suspended. Contact an administrator.' : error.message }
        }
        await logEvent('sign_in')
        return { error: null }
      },
      async signOut() {
        await logEvent('sign_out')
        await supabase.auth.signOut()
      },
    }),
    [session, role, loading, notice],
  )

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used within an AuthProvider')
  return ctx
}
