import { supabase } from './supabaseClient'

// Records an app event (sign-in, backup downloaded, pipeline import, ...)
// in the audit trail. Table changes are logged by the database itself, so
// this is only for things that aren't a row change. Never blocks the UI:
// a failed log entry is reported in the console only.
export async function logEvent(
  action: string,
  details: Record<string, unknown> = {},
  table?: string,
  recordLabel?: string,
): Promise<void> {
  const { error } = await supabase.rpc('log_app_event', {
    p_action: action,
    p_details: details,
    p_table: table ?? null,
    p_record_label: recordLabel ?? null,
  })
  if (error) console.error(`Audit log (${action}) failed:`, error.message)
}
