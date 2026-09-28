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

1. Create a Supabase project, then grab the Project URL and anon public key
   from Settings → API.
2. Authentication → Sign In / Providers → Email: enable "Confirm email".
3. Authentication → Emails → Confirm signup template: replace the confirmation
   link with `{{ .Token }}` so users get a 6-digit code instead of a link (the
   app's verify-email page expects a code, not a link).
4. Local dev: copy `client/.env.example` to `client/.env` and fill in the two
   values above.
5. Deployed build (GitHub Pages): add `VITE_SUPABASE_URL` and
   `VITE_SUPABASE_ANON_KEY` as repo secrets (Settings → Secrets and variables →
   Actions) — `deploy.yml` injects them at build time.
