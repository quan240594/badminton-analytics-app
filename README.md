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
