# Badminton Analytics App — Agent Session Context Export

**Exported:** 2026-09-22 (re-exported, post-deployment)
**Live site:** https://quan240594.github.io/badminton-analytics-app/ (CONFIRMED WORKING)
**Repo:** https://github.com/quan240594/badminton-analytics-app (public)
**Local path:** /Users/quando/Personal_GitHub/badminton-app

## 1. Overview

Full session arc: CSS polish -> static-site CI/CD pipeline -> Titles/Finals scraper
data-completeness bug fix -> Career-medals per-year redesign -> repo relocation ->
fresh GitHub repo creation (`badminton-analytics-app`, replacing the deleted messy
`badminton-analytics` repo) -> GitHub Pages deployment troubleshooting -> gh CLI
installation via a Homebrew architecture-detection bug fix -> branch protection
lockout -> npm private-registry lockfile contamination fix -> **first successful
deployment confirmed live**.

## 2. Technical Foundation

- **Frontend:** React 18.3.1 + Vite 5.4.21, plain JSX, single `client/src/index.css`
- **Backend (build-time only):** `server/build-static.js` produces `client/public/data.json`
  from raw data files; no live server in production (GitHub Pages static hosting)
- **Scraper:** Python stdlib (`urllib`), targets `badmintonnederland.toernooi.nl`
- **Full Titles/Finals endpoint:** `https://badmintonnederland.toernooi.nl/player-profile/{guid}/PersonHome/TitlesFinals`
  (async-modal endpoint, requires `Cookie` + `X-Requested-With: XMLHttpRequest`)
- **Login form (Playwright automation):** `https://badmintonnederland.toernooi.nl/user?returnUrl=%2F`,
  cookie-consent `button.js-accept-basic`, fields `#Login`/`#Password`, submit `#btnLogin`
- **GitHub Actions** (`.github/workflows/deploy.yml`):
  - `refresh-data` job: Friday 06:00 UTC cron + manual dispatch only (`if: github.event_name != 'push'`);
    scrapes rankings/titles/career data via Playwright login, commits changes back to `main`.
    **Currently fails** without `TOERNOOI_USERNAME`/`TOERNOOI_PASSWORD` repo secrets (not yet added).
  - `build-and-deploy` job: always runs (`if: always() && !failure() && !cancelled()`),
    builds `client/public/data.json` + Vite client, deploys to GitHub Pages via
    `actions/configure-pages` + `upload-pages-artifact` + `deploy-pages`.
  - **Install steps use `npm install`, not `npm ci`** (deliberately changed — see Section 5).

## 3. Environment Facts (this Mac)

- **Genuine Apple Silicon (M3 Pro)**, confirmed via `uname -m`/`arch` = arm64, `sysctl machdep.cpu.brand_string`.
- BUT Homebrew was installed at the **Intel-only prefix** `/usr/local/Homebrew` instead of the
  native `/opt/homebrew` prefix — meaning it had been silently operating as an emulated/Intel
  Homebrew this whole time (self-reported "Intel x86_64" in error messages), which is why
  `brew install gh` kept failing with `CompilerSelectionError: go cannot be built with any
  available compilers` (arm64-only Xcode Command Line Tools missing x86_64 libs Homebrew needed).
- **Fix applied:** installed a second, native Homebrew at `/opt/homebrew` (user ran the official
  installer themselves, entering sudo password interactively — required since `/opt` is
  root-owned 755). `/opt/homebrew/bin/brew install gh` then succeeded instantly with a
  precompiled arm64 bottle (`gh 2.101.0`), no compilation needed.
- **gh authentication:** user ran `/opt/homebrew/bin/gh auth login` themselves (browser-based
  interactive login, PAT-backed) — confirmed via `gh auth status`: logged in as `quan240594`,
  broad token scopes (repo, workflow, admin:*, etc.).
- **This Mac is also the user's work laptop** — global `~/.npmrc` contains the employer's
  Artifactory registry override (`registry=https://artifactory.insim.biz/artifactory/api/npm/nn-npm/`
  plus several scoped `@nn*:registry=...` overrides and auth tokens for internal packages).
  This is why `npm install`/`npm ci` run locally on this machine silently resolve public npm
  packages through the corporate mirror instead of the real npmjs.org — see Section 5 for the
  downstream bug this caused. Direct access to `https://registry.npmjs.org` from this machine
  is **blocked by corporate network policy** (403 Forbidden even with `--registry` override) —
  confirmed fact, not yet worked around; only matters for local lockfile regeneration, not for
  CI (GitHub-hosted runners have no such restriction and reach public npm natively).

## 4. GitHub Repo History (why there are two repos)

- Original repo `quan240594/badminton-analytics` (private) became "too messy" per the user
  (branch confusion from an earlier session — a stray `init` branch, a `main` that had been
  reset to a near-empty state, etc.) and **the user deleted it**.
- **New repo created:** `quan240594/badminton-analytics-app` (public — required for free-tier
  GitHub Pages, since private-repo Pages needs a paid plan). Local git history was fully
  reinitialized (`rm -rf .git && git init -b main`) with a single clean commit before publishing
  via GitHub Desktop (already installed from earlier troubleshooting).
- **Branch protection lockout (resolved):** user configured a repository ruleset with required
  status checks, required PRs, required signed commits, and a "missing successful active
  github-pages deployment" check — which combined into a hard lockout (couldn't push directly,
  couldn't satisfy the Pages-deployment check because nothing had deployed yet, chicken-and-egg).
  **User temporarily disabled the ruleset** via the GitHub UI to unblock; pushes since then show
  `remote: Bypassed rule violations for refs/heads/main: ...` (ruleset still exists but is
  disabled, not deleted — worth revisiting with lighter rules once things stabilize).

## 5. Root-Caused CI Bug: Private Registry Contamination in Lockfiles

- **Symptom:** `build-and-deploy` failed at "Install server dependencies" / "Install client
  dependencies" with `npm error code ENOTFOUND ... getaddrinfo ENOTFOUND artifactory.insim.biz`.
- **Root cause:** `server/package-lock.json` (70 occurrences) and `client/package-lock.json`
  (110 occurrences) had `resolved` fields baked in pointing to
  `https://artifactory.insim.biz/artifactory/api/npm/nn-npm/...` — the user's employer's
  Artifactory npm mirror — because the lockfiles were originally generated on this same
  machine while its global `~/.npmrc` had that registry override active. GitHub's clean
  runners obviously can't resolve that private corporate hostname.
- **Fix applied (two-part):**
  1. Changed `deploy.yml`'s two install steps from `npm ci` to `npm install` (defense in depth —
     `npm ci` strictly enforces lockfile `resolved` URLs; `npm install` is more forgiving) —
     **this alone was insufficient**, `npm install` still attempted the stale resolved URLs first.
  2. **Actual fix:** rewrote both lockfiles in place with
     `sed 's#https://artifactory.insim.biz/artifactory/api/npm/nn-npm/#https://registry.npmjs.org/#g'`
     — safe because the corporate Artifactory `nn-npm` repo is a passthrough/virtual mirror of
     the public npm registry, so package content and integrity hashes are identical; only the
     host/path differed. Verified 0 remaining `artifactory.insim.biz` references, 70+110 correct
     `registry.npmjs.org` references after the rewrite.
  3. Restored local `server/node_modules` afterward via the (working, for this host) corporate
     registry so local dev isn't broken.
- **Result:** next push-triggered run succeeded end-to-end — `refresh-data` correctly skipped
  (push event), `build-and-deploy` installed both dependency sets, built the client, and
  deployed to Pages successfully. **Confirmed live** at
  https://quan240594.github.io/badminton-analytics-app/ (fetched and verified: shows "72 rated
  players from Bondscompetitie 2026-2027 – Mannen Veer 2 afd. 12", full UI rendering).

## 6. Codebase State (paths relative to `badminton-app/`)

- All CSS/alignment fixes, the "Most recent" Titles-table header label, the dynamic
  per-comparison `visibleTitleYears` Career-medals redesign, and the full Titles/Finals
  scraper fix (539 players re-scraped) from earlier in this session are present and intact
  in the current `main` branch (verified via `git log`/`grep` after the repo-history reset
  incident earlier in the session — see prior context section below for that recovery story).
- `client/src/components/TitlesCard.jsx` — header row: `<th className="stat-label">Most recent</th>`
- `client/src/App.jsx` — `visibleTitleYears` computed from currently-selected Side A/B players
- `client/src/components/CareerMedalsCard.jsx` — per-year rows + bold `Total` row
- `data/fetch_titles.py` — fetches full history via the async-modal endpoint (not the
  5-entry preview widget)
- `.github/workflows/deploy.yml` — `npm install` (not `npm ci`) in both install steps
- `server/package-lock.json`, `client/package-lock.json` — resolved URLs point to
  `registry.npmjs.org`, not the corporate Artifactory mirror
- `agent-contexts/` — this export directory; **note: it disappeared once earlier in the
  session after being created** (cause unknown, possibly an external cleanup step) and was
  recreated — if persistence matters, commit it to git rather than relying on it staying on
  disk unmanaged (currently untracked, not yet in `.gitignore` either).

## 7. Outstanding / Next Steps

- **Add repo secrets** `TOERNOOI_USERNAME` and `TOERNOOI_PASSWORD` (Settings -> Secrets and
  variables -> Actions) so the Friday auto-refresh (`refresh-data` job) can actually log in
  and scrape fresh data. Until then, scheduled/manual-dispatch runs will keep failing at the
  "Log in and capture session cookie" step (this does NOT block `build-and-deploy`, since that
  job only runs on `push` events in practice, where `refresh-data` is skipped).
- **Branch protection ruleset** is currently disabled (bypassed), not redesigned. Revisit with
  lighter rules appropriate for a solo hobby project (e.g. just "no force-push", drop PR-only
  requirement, drop code-scanning/coverage/signed-commit requirements) once stable.
- **Local `~/.npmrc` still has the corporate registry override** — harmless for this project
  now that lockfiles are fixed, but worth being aware of for any *future* `npm install`
  regenerating lockfiles on this machine (would silently reintroduce the same
  artifactory.insim.biz contamination bug). Consider a project-local `.npmrc` with
  `registry=https://registry.npmjs.org/` to force the public registry for this repo specifically.
- **`gh` CLI** is now fully installed (`/opt/homebrew/bin/gh`, native arm64) and authenticated
  as `quan240594` — available for any future direct Actions/API interaction without needing
  the user to use the web UI.

## 8. Key Lessons

- A Homebrew install can silently be running as the "wrong" architecture (Intel-prefix
  `/usr/local/Homebrew` on real Apple Silicon hardware) even when `uname`/`arch` correctly
  report the true CPU — Homebrew's behavior is determined by which prefix it was installed
  under, not just the live kernel architecture. Installing a second, native `/opt/homebrew`
  Homebrew alongside the old one is a safe, additive fix (needs one sudo-gated step from the
  user, since `/opt` is root-owned).
- A machine's global npm/registry config can silently contaminate lockfiles with private
  registry URLs that then break CI on GitHub's clean runners — always check `~/.npmrc` for
  registry overrides before diagnosing "network"-flavored CI failures as environment/DNS
  issues; check whether the *lockfile itself* has non-public resolved URLs baked in.
  `npm ci` vs `npm install` matters here too: `npm ci` is strict about trusting the lockfile's
  resolved URLs, `npm install` is more forgiving but can still prefer stale resolved entries.
- Branch protection rules that require "a successful deployment already exists" as a
  precondition for allowing pushes create a hard self-lock for a brand-new repo with zero
  deployments yet — a chicken-and-egg situation best avoided by not enabling that specific
  rule until after the first deployment succeeds.
- `gh` (once properly installed/authenticated) lets the agent directly watch/diagnose/fix CI
  runs (`gh run watch`, `gh run view --log`) without relying on the user to copy-paste
  screenshots of the Actions UI — much faster iteration once auth is set up correctly.

## 9. Follow-up (2026-09-23): League Day Simulator — Counter-Lineup Feature

- Added counter-lineup behavior to `autoFill` in `client/src/pages/LeagueDaySimulator.jsx`:
  clicking "Match players for club A/B to get at least 5 wins" now locks the OPPONENT
  side's lineup for any rubber where it's already fully manually entered, and only
  optimizes the clicked club's own side against it, instead of picking both sides jointly.
- Mechanism: reuses the existing `fixedPlayersA`/`fixedPlayersB` fixed-pairing path (the same
  one used by the small-roster `buildDefaultLineup` lineup and the forced-MS1 pick) via a new
  `opponentLockSide` + per-slot manual-lock check (`slot[opponentLockSide].every(Boolean)`).
  Manual entries take priority over both of those existing mechanisms, and are excluded from
  the optimizer's own usage/cap tracking the same way `fixedA`/`fixedB` already were.
- `'excitement'` (closest-ratings) objective is unchanged.
- Verified with `npm run build` (client) — no errors.
