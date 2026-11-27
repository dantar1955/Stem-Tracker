# STEM Production Tracker

Replaces the **STEM STATUS 2024-2026** workbook with a role-based web app.
NetSuite is the source of truth for sales orders; Sales, Operations and
Accounting enter the rest as each order moves along. See the plan doc
("STEM Production Tracker — Application Plan") for the full design
rationale — this README is about getting the code running.

## Repo layout

```
supabase/
  migrations/        schema, RLS policies, computed views (run in order)
  functions/
    netsuite-sync/    scheduled Edge Function, pulls sales orders from NetSuite
    invite-user/       admin-only Edge Function, invites a user + assigns a role
  seed.sql            sample data for local development only
  test/                local-only test harness (never run against real Supabase)
app/                   React + TypeScript + Tailwind frontend (Vite)
netlify.toml           Netlify build config
.github/workflows/     CI: migration tests, edge function typecheck, frontend build
```

## What's already verified

Nothing here has touched a live Supabase/NetSuite project yet (this repo was
built without those credentials), but the parts that don't need them have
been tested directly in this environment:

- All three SQL migrations run cleanly against a local Postgres 16 instance.
- A full functional test (`supabase/test/functional_test.sql`) exercises the
  role-based access control end to end: each of the four roles can and
  cannot edit the columns the plan says they should/shouldn't, service-role
  (the sync job) bypasses those checks, manual order inserts are admin-only,
  and every reporting view queries cleanly.
- Both Edge Functions type-check and lint under Deno 2.9, with `netsuite-sync`'s
  JWT-signing logic specifically verified against a throwaway RSA key pair
  (signs with PS256, verifies correctly) -- the part most likely to be subtly
  wrong in a NetSuite OAuth2 M2M integration.
- The frontend builds cleanly (`tsc -b && vite build`) with no type errors.

## Getting this live: what I need from you

Three accounts, plus NetSuite credentials:

1. **GitHub** — a repo to push this code to. I don't have working GitHub
   credentials in this session (the `GH_TOKEN` available here is invalid),
   so either hand me a personal access token with `repo` scope, or create an
   empty repo yourself and I'll give you the code to push.
2. **Supabase** — a new project (free tier is plenty to start). Once it
   exists, I need the project's connection string (or you run the
   migrations yourself — steps below) and, for the NetSuite sync and invite
   functions, the project's URL + service role key as function secrets.
3. **Netlify** — connect the GitHub repo once it exists; Netlify reads
   `netlify.toml` automatically. Needs the two `VITE_SUPABASE_*` environment
   variables set in Netlify's site settings (see below) — no Netlify API
   token needed for this path.
4. **NetSuite** — an OAuth 2.0 Machine-to-Machine (client credentials)
   integration record, which needs someone with NetSuite admin access to
   set up (steps below). This is the one piece I can't do any part of
   without your NetSuite admin's involvement.

## Supabase setup

1. Create a project at supabase.com.
2. Run the migrations, in order, against it. Easiest via the Supabase CLI:
   ```
   npx supabase login
   npx supabase link --project-ref <your-project-ref>
   npx supabase db push    # applies supabase/migrations/*.sql
   ```
   Or paste each file's contents into the SQL Editor in order
   (`0001_schema.sql`, `0002_rls.sql`, `0003_views.sql`) — skip
   `supabase/test/*` and `seed.sql`, those are not for production.
3. Deploy the two Edge Functions:
   ```
   npx supabase functions deploy netsuite-sync
   npx supabase functions deploy invite-user
   ```
4. Set secrets (Project Settings > Edge Functions, or via CLI):
   ```
   npx supabase secrets set NETSUITE_ACCOUNT_ID=... NETSUITE_CLIENT_ID=... \
     NETSUITE_CERTIFICATE_ID=... NETSUITE_PRIVATE_KEY="$(cat netsuite_private_key.pem)"
   ```
   `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` are provided to Edge
   Functions automatically — don't set those yourself.
5. Schedule `netsuite-sync`: Dashboard > Edge Functions > netsuite-sync >
   add a cron trigger, e.g. `*/10 * * * *` (every 10 minutes).
6. Create the first admin: sign up through the app once it's deployed (or
   via Dashboard > Authentication > Add user), then in the SQL Editor:
   ```sql
   insert into public.user_roles (user_id, role, full_name)
   values ('<that user's id, from Authentication>', 'admin', 'Your Name');
   ```
   Every other user is invited from the app's Manage Users page once an
   admin exists.

## NetSuite credentials

NetSuite's machine-to-machine OAuth2 uses a JWT signed with a private key,
not a plain client secret. Someone with NetSuite admin access needs to:

1. Generate an RSA key pair (`openssl genpkey -algorithm RSA -pkeyopt
   rsa_keygen_bits:2048`).
2. In NetSuite: Setup > Integration Management > Manage Integration Records
   > New. Enable "Client Credentials (T2T) Grant" (or "Client Credentials",
   naming varies by NetSuite version), upload the public key, and note the
   **Client ID** and the **Certificate ID** NetSuite assigns the uploaded key.
3. Make sure the integration's assigned role has permission to the
   `transaction` record type (for SuiteQL) and REST Web Services access.
4. Confirm the custom field IDs this NetSuite account actually uses for
   Labs qty, Teacher Station qty, and DOE P.O. on the sales order —
   `supabase/functions/netsuite-sync/index.ts` defaults to
   `custbody_labs_qty` / `custbody_ts_qty` / `custbody_doe_po`, which are
   placeholders until confirmed. Override via the `NETSUITE_FIELD_*` secrets
   if they're different.
5. Set the four `NETSUITE_*` secrets in Supabase (above).

Until those secrets are set, `netsuite-sync` runs as a no-op (it checks for
them and returns `{"skipped": true}` rather than failing), so the rest of
the app can go live before NetSuite access is sorted out.

## Netlify setup

1. New site from Git > pick this repo. Netlify reads `netlify.toml`
   (`base = app`, build command, publish directory) automatically.
2. Site settings > Environment variables, add:
   - `VITE_SUPABASE_URL`
   - `VITE_SUPABASE_ANON_KEY`
   (both from Supabase Project Settings > API — the **anon/public** key,
   never the service role key).
3. Deploy. Every push to `main` redeploys automatically from then on.

## Admin tools, pipeline, audit trail and knowledgebase

Added after go-live (migrations `0004`–`0008`, Edge Functions `admin-users` and `admin-backup`):

- **Admin tab** (admins only): create users with a temporary password, edit name/email/role, reset passwords, suspend and restore access (`supabase/functions/admin-users`). Users on a temporary password must choose their own at next sign-in. A suspended user's role stops counting immediately (`current_user_role()` ignores suspended users) and Supabase Auth blocks their sign-in.
- **Audit trail** (`public.audit_log`): a trigger on every app table records inserts, updates (changed fields only, old → new) and deletes with the user who made them; NetSuite sync changes are labelled `netsuite_sync`, SQL Editor changes `database`. Sign-ins, sign-outs, password changes, imports and exports are logged through `log_app_event()`. Admins can read it; nobody can edit or delete it.
- **Backup** (`supabase/functions/admin-backup`): downloads every table plus the user list (no passwords) as Excel and JSON.
- **Pipeline tab** (`public.pipeline_entries`, `public.year_goals`): opportunities by stage, yearly goals, Excel template download/export/upload. Pipeline + Awaiting PO feed the dashboard's Total Projected. `record_weekly_snapshot()` runs every Monday via pg_cron.
- **Knowledgebase tab**: quickstart guide and manual (`app/src/knowledgebase/*.md`) and the explainer video (`app/public/knowledgebase/`).

Deploying these:

```
npx supabase functions deploy admin-users
npx supabase functions deploy admin-backup
```

Then run `supabase/migrations/0008_pipeline_admin_audit.sql` in the SQL Editor. `invite-user` is no longer used by the app.

Tests: `supabase/test/audit_pipeline_test.sql` (run after `functional_test.sql`) covers the audit trail, pipeline permissions, weekly snapshots and suspension.

## Local development

```
# Frontend
cd app
cp .env.example .env.local   # fill in your Supabase project's URL + anon key
npm install
npm run dev

# Database (needs a local Postgres or the Supabase CLI's local stack)
npx supabase start           # if using the full local Supabase stack
npx supabase db reset        # applies migrations + seed.sql
```

## Known gaps / decisions still open

These carry over from the plan doc's Assumptions section — nothing below
blocks going live, but they're worth a look before relying on the numbers:

- **Build Plan sheet**: the original workbook's Confidence/Target Date/Owner
  fields aren't modeled as their own table yet — they're mostly derivable
  from `orders` + `builds` + `shortages`. Add a table if that's not enough.
- **2024/2025 historical data**: not migrated by these migrations (those
  sheets use a different column layout than "2026 Production" and need a
  separate mapping decision — see the module docstring in
  `scripts/migrate_2026_production.py`).
- **NetSuite custom field IDs**: placeholders, see "NetSuite credentials"
  above.
- **`so_number` is intentionally not unique**: the real "2026 Production"
  sheet has 6 sales orders (out of 70 rows) split across more than one
  tracked row — e.g. a Chromebook shipment and a separate Apple/Mac
  shipment under the same S/O, each shipping and installing on its own
  schedule. Treating `so_number` as unique (an earlier draft of this
  schema did) would have silently dropped those rows on import. The
  NetSuite sync function's reconciliation logic (`upsertOrders` in
  `supabase/functions/netsuite-sync/index.ts`) accounts for this: it only
  links the oldest unreconciled row for a given `so_number` to a NetSuite
  id, since `netsuite_so_id` itself stays unique (one real NetSuite
  transaction per SO). Any sibling rows stay historical-only, which is
  correct — there's only one NetSuite transaction to link to either way.

### Historical "2026 Production" import — validated

`scripts/migrate_2026_production.py` reads the uploaded workbook's "2026
Production" sheet and writes
`supabase/migration_data/2026_production_import.sql`. This has been run
end-to-end against a local Postgres instance (schema + RLS + views
migrations, then this import, with no errors) — not just generated and
eyeballed:

```
python3 scripts/migrate_2026_production.py <path-to-workbook.xlsx> --year 2026
psql -d <your-db> -v ON_ERROR_STOP=1 -f supabase/migration_data/2026_production_import.sql
```

All 70 rows insert cleanly. Two rows are flagged on stderr for a manual
look (a "Bill Month" of "At Risk" instead of an actual month — left NULL,
original text kept in `legacy_status_text`). A handful of other cells with
free text where the schema expects a date or a number (e.g. "Pending MACs"
in a PCS-received cell, a bare "A" in a Teacher Satisfaction quantity
cell) are diverted the same way: the typed column is left NULL/0 rather
than generating an invalid SQL literal, and the original text is kept
verbatim in `legacy_status_text` so nothing is silently discarded. Run
this once against an empty/freshly-migrated `orders` table — there's no
`ON CONFLICT` guard (deliberately, since `so_number` isn't unique), so
re-running it without truncating first will duplicate rows.

The 2024/2025 sheets are a separate, not-yet-written script (different
column layout — see the gap above).
