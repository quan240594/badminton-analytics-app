# Badminton Win-Rate Simulator

Static site (React + Vite) that estimates win probability between players/pairs
from a badmintonnederland.toernooi.nl league pool, using an Elo-style rating
built from historical match data.

## Local development

```bash
cd data && python3 refresh_data.py            # pulls a cookie from your local Chrome profile
cd ../server && npm ci && node build-static.js  # writes client/public/data.json
cd ../client && npm ci && npm run dev
```

## Deployment (GitHub Pages)

`.github/workflows/deploy.yml` runs on:
- a weekly Friday cron (data refresh + redeploy)
- `workflow_dispatch` (manual run)
- every push to `main` (redeploy only, using the currently committed data)

The refresh job logs in with Playwright (the site's login page is
client-rendered, so a plain HTTP client can't submit it) and needs two repo
secrets:

- `TOERNOOI_USERNAME`
- `TOERNOOI_PASSWORD`

Set these under Settings → Secrets and variables → Actions before the first
scheduled run. GitHub Pages must also be enabled (Settings → Pages → Source:
GitHub Actions) once.

## Authentication

The client requires a [Supabase](https://supabase.com) project for user
registration/login with email-verification-code confirmation (free tier is
enough for this app).

### One-time manual setup

1. Create a Supabase project, then grab the Project URL and anon public key
   from Settings → API.
2. Local dev: copy `client/.env.example` to `client/.env` and fill in the two
   values above.
3. Deployed build (GitHub Pages): add `VITE_SUPABASE_URL` and
   `VITE_SUPABASE_ANON_KEY` as repo secrets (Settings → Secrets and variables →
   Actions) — `deploy.yml` injects them at build time.

### Everything else: config as code

All Auth settings that used to require clicking through the Supabase dashboard
(sign-up/confirmation behavior, SMTP, the confirmation email template, session
duration) live declaratively in `supabase/config.toml` and
`supabase/templates/confirmation.html`, and are pushed to the live project via
the **Sync Supabase auth config** GitHub Action (manual `workflow_dispatch` for
now — `supabase config push` has no dry-run, so review a run's effect before
wiring it to auto-trigger on push).

Required repo secrets for that workflow:

- `SUPABASE_ACCESS_TOKEN` — personal access token from
  [supabase.com/dashboard/account/tokens](https://supabase.com/dashboard/account/tokens).
- `SUPABASE_SMTP_USER` / `SUPABASE_SMTP_PASS` — the dedicated Gmail address and
  its [App Password](https://myaccount.google.com/apppasswords).

Sessions never force-expire (`auth.sessions.timebox`/`inactivity_timeout` are
left unset in `config.toml`), so once a user verifies their email they stay
logged in indefinitely on that device until they explicitly log out.

### Roles: admin-only data fetching

Only users with `app_metadata.role === "admin"` see the "Fetch data" /
"Fetch pool data" controls (`app_metadata` can only be written by the
service-role key, never by the user themselves, so it's safe to trust
client-side). Regular users can register/log in/change their password but
cannot trigger a refresh.

Granting the admin role is done via a workflow, not the Supabase dashboard:

```bash
gh workflow run set-admin-role.yml -f email=someone@example.com
```

Requires one more repo secret: `SUPABASE_SERVICE_ROLE_KEY` (the **secret**
key from Project Settings → API Keys — never the publishable/anon key, and
never used client-side). The target user must already be registered in the
app before running this.

### Account page

Signed-in users can change their password at `#/account` (linked from the
top nav) via `supabase.auth.updateUser`.
