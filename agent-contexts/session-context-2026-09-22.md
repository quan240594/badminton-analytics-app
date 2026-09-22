# Badminton Analytics App — Agent Session Context Export

**Exported:** 2026-09-22
**Location:** /Users/quando/Personal_GitHub/badminton-app (moved this session from OneDrive)

## 1. Overview

This session is a continuation of a longer prior session covering:
1. CSS alignment/consistency fixes across the 5 stacked player-comparison tables
2. Building a static-site + GitHub Actions CI/CD pipeline (Playwright login, weekly Friday refresh, GitHub Pages deploy) to replace the live Express backend
3. Fixing a real data-completeness bug in the Titles/Finals scraper
4. Redesigning the Career-medals table to a per-year breakdown with a dynamic year range
5. Pushing the completed work to a new private GitHub repo (`quan240594/badminton-analytics`)
6. Moving the whole app from OneDrive to a local GitHub-projects folder

## 2. Technical Foundation

- **Frontend:** React 18.3.1 + Vite 5.4.21, plain JSX, single `client/src/index.css`
- **Backend (being phased out):** Node/Express (`server/index.js`), superseded by a static-site build (`server/build-static.js` → `client/public/data.json`)
- **Scraper:** Python stdlib (`urllib`), targets `badmintonnederland.toernooi.nl`
- **Full Titles/Finals endpoint:** `https://badmintonnederland.toernooi.nl/player-profile/{guid}/PersonHome/TitlesFinals` (async-modal endpoint, requires `Cookie` + `X-Requested-With: XMLHttpRequest`)
- **Login form (for Playwright automation):** `https://badmintonnederland.toernooi.nl/user?returnUrl=%2F`, cookie-consent `button.js-accept-basic`, fields `#Login`/`#Password`, submit `#btnLogin`, form `id="form_login"`
- **GitHub Actions:** `.github/workflows/deploy.yml` — `schedule` (Friday 06:00 UTC), `workflow_dispatch`, `push: branches: [main]`; jobs `refresh-data` + `build-and-deploy`; deploys via `actions/upload-pages-artifact` + `actions/deploy-pages`

## 3. Environment Facts (this Mac)

- Intel x86_64 Mac with a broken/mismatched Xcode Command Line Tools install (`xcrun: error: unable to load libxcrun... need x86_64` — arm64 tools present instead). This blocks any Homebrew formula requiring compilation (e.g. `gh`'s `go` dependency → `CompilerSelectionError`).
- SSH to GitHub is network-blocked on both port 22 and the 443 fallback (`Broken pipe`).
- HTTPS anonymous git ops return `remote: Repository not found.` for the private repo (expected GitHub behavior for unauthenticated private-repo access).
- `brew install --cask github` (GitHub Desktop, a GUI app) succeeded — this is a **different package** from the `gh` CLI (`brew install gh`), which was never actually installed (confirmed via `brew list gh` → "No such keg", and no binary at `/usr/local/bin/gh` or `/opt/homebrew/bin/gh`). The user initially conflated the two.
- **Resolution path for the GitHub push:** use GitHub Desktop (already installed) — sign in with the personal `quan240594` account, add the local repo, and use Push/Publish branch. This avoids `gh`/PAT/compiler issues entirely.

## 4. Codebase State (paths relative to `badminton-app/`)

- `client/src/index.css` — finalized: shared column widths 20/23/23/34, `overflow:hidden` + ellipsis on all 5 tables, uniform right-alignment on columns 2-4, shared `.icon-cell { font-size: 1rem; }` class, `.player-card-grid`/`.grid-line` alignment guides, responsive breakpoint at 820px, `.career-medals-table` multi-row styling (`tr + tr td { border-top }`, `.total-row` bold)
- `client/src/components/DivisionCard.jsx` — "Highest division" label shortened to "Division"
- `client/src/components/TitlesCard.jsx` — trophy/medal icons use shared `.icon-cell`; **most recent change:** first header cell changed from `<th></th>` to `<th className="stat-label">Most recent</th>` (mirrors the "Career" label pattern in the per-year table), verified visually
- `client/src/components/CareerMedalsCard.jsx` — rewritten to show one row per year (`titleYears` prop) plus a bold `Total` row; `fmt(count)` returns `-` for zero
- `client/src/App.jsx` — removed all live "Refresh data" UI/state (static-site mode); added a `visibleTitleYears` computation (union of non-zero years across currently-selected Side A/B players, sorted ascending) and wired both `<SideEditor>` call sites to use it instead of a fixed year list — **verified via Playwright**: Quan Do vs Jerry Langbein shows only 2025/2026 rows; players with real older history (e.g. David Keijner: 2015-2018, 2022) are unaffected
- `client/src/api.js` — static-site rewrite: fetches `data.json` once via `loadBundle()`, computes simulations client-side
- `client/vite.config.js` — `base: './'`, no `/api` proxy
- `server/lib/dataset.js` — `titleCounts(guid)` returns `{ byYear, total }`; module-level `titleYears` (all years across all players) still computed but no longer drives the UI directly (superseded by App.jsx's dynamic per-comparison range)
- `data/fetch_titles.py` — **fixed root cause bug**: was scraping the small inline preview widget (~5 entries) instead of the full-history async-modal endpoint; now fetches `.../PersonHome/TitlesFinals` directly. Re-scraped all 539 players; Quan Do's entries went from 5 → 8 (verified: 2 gold, 6 silver, 0 bronze)
- `data/refresh_data.py` — added `--skip-cookie-refresh` flag for CI use with a Playwright-obtained cookie
- `data/playwright_login.py` — uses verified login selectors to authenticate and save `cookie.txt`
- `.github/workflows/deploy.yml`, `.gitignore`, `README.md` — created, not yet run in CI (blocked on GitHub push)

## 5. Problem Resolutions

1. **Alignment inconsistencies** — root-caused via Playwright pixel/DOM measurement (not guesswork): missing `overflow:hidden` on 3/5 tables, too-narrow column widths, inconsistent icon `font-size`, and an intentional final switch to right-align all data columns (Year included) per explicit user request. One round of "spacing inconsistency" was investigated and found to be a false alarm (pixel-identical box models) — correctly not acted on.
2. **Data-completeness bug** — "I've got more than 8 medals, only 5 shown" traced to the scraper hitting the wrong endpoint (main profile page's small preview widget vs. the full-history AJAX modal). Fixed and re-scraped all 539 players.
3. **Career-table year range** — user initially asked to hardcode 2025-2026; investigation showed other players have real history back to 2006. Resolved with a **dynamic per-comparison** range (computed from currently-selected players only) rather than a global hardcode, avoiding silent data loss for other matchups.
4. **GitHub push authentication** — extensive troubleshooting (HTTPS 404, SSH broken pipe, `gh` compiler failure, keychain-prompt terminal hang). Landed on **GitHub Desktop** (already installed via `brew install --cask github`) as the working path forward, since it needs no CLI/PAT and sidesteps the broken CLT toolchain.
5. **"Most recent" label** — added to the Titles table's header (first cell), matching the "Career" label already used in the per-year table, per user's screenshot request.
6. **App relocation** — moved the entire `badminton-app` directory (git repo, remote, and uncommitted working-tree changes intact) from `~/Library/CloudStorage/OneDrive-NN/Documents/Personal/badminton-app` to `~/Personal_GitHub/badminton-app`. Stopped the running Vite dev server/esbuild process tied to the old path first, since source and target were on the same volume (instant rename, no copy needed).

## 6. Outstanding / Next Steps

- **GitHub push (primary blocker):** Sign in to GitHub Desktop with the `quan240594` personal account, add `/Users/quando/Personal_GitHub/badminton-app` as a local repository if not auto-detected, then Push/Publish the 2 local commits (plus the uncommitted `App.jsx`/`TitlesCard.jsx` changes, once committed) to `origin` (`quan240594/badminton-analytics`).
- **Uncommitted changes at time of export:** `client/src/App.jsx` (dynamic `visibleTitleYears`) and `client/src/components/TitlesCard.jsx` ("Most recent" label) are modified but not committed — commit these before/as part of the push.
- **Dev server:** was stopped before the move; restart with `npm run dev` (or equivalent) from the new path if local testing is needed again.
- **Nested git repos:** `/Users/quando/Personal_GitHub` itself has its own (empty, no-commit) git repo + `.code-workspace` file, pre-existing before this move. `badminton-app` now lives as a nested subdirectory with its own independent `.git`/remote — this is intentional/harmless (same pattern as a multi-root "GitProjects" container), not a conflict.

## 7. Key Lessons

- Always verify visual "misalignment" complaints with real pixel/DOM measurement (Playwright) before changing CSS — most were real bugs, at least one was a false alarm.
- A "fixed global" data-scoping decision (e.g. year range) can silently break other slices of data even when it looks correct for the one example in front of you — cross-check against the full dataset before hardcoding.
- This machine's broken Xcode Command Line Tools + network-blocked SSH are environment limitations, not something to brute-force around (e.g. don't keep trying more SSH ports or force `gh` to compile) — pivot to a working alternative (GitHub Desktop) instead.
- Never type secrets (PAT, passwords) into a terminal on the user's behalf — hand off credential entry to the user directly (GUI app login, VS Code Source Control, or their own terminal).
