import { createClient } from '@supabase/supabase-js'

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL as string | undefined
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined

if (!supabaseUrl || !supabaseAnonKey) {
  // Fails loudly at build/dev time rather than silently making unauthenticated
  // requests to nowhere -- see README "Environment variables".
  throw new Error(
    'Missing VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY. Copy app/.env.example to app/.env.local and fill in your Supabase project values.',
  )
}

export const supabase = createClient(supabaseUrl, supabaseAnonKey)
