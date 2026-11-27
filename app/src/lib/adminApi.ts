import { supabase } from './supabaseClient'

// Calls one of the admin-only Edge Functions and turns its error body into
// a readable message.
export async function callAdminFunction<T>(name: 'admin-users' | 'admin-backup', body: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase.functions.invoke(name, { body })
  if (error) {
    let message = error.message
    const context = (error as { context?: Response }).context
    if (context && typeof context.json === 'function') {
      try {
        const parsed = await context.json()
        if (parsed?.error) message = parsed.error
      } catch {
        // keep the generic message
      }
    }
    throw new Error(message)
  }
  return data as T
}

// 12 characters, no look-alikes (0/O, 1/l/I), always mixed case + digit + symbol.
export function generateTempPassword(): string {
  const sets = ['ABCDEFGHJKLMNPQRSTUVWXYZ', 'abcdefghijkmnpqrstuvwxyz', '23456789', '!@#$%&*?']
  const all = sets.join('')
  const pick = (chars: string) => chars[crypto.getRandomValues(new Uint32Array(1))[0] % chars.length]
  const out = sets.map(pick)
  while (out.length < 12) out.push(pick(all))
  for (let i = out.length - 1; i > 0; i--) {
    const j = crypto.getRandomValues(new Uint32Array(1))[0] % (i + 1)
    ;[out[i], out[j]] = [out[j], out[i]]
  }
  return out.join('')
}
