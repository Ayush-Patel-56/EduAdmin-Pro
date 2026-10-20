# Vercel deployment and Go pipeline: design

Date: 2026-10-20. Status: revision 3, for Ayush's approval. Per-PR previews were dropped at Ayush's request, and the design review's points are kept where they still apply.

## Intent

EduAdmin Pro (pnpm monorepo: `apps/web` React/Vite, `apps/api` NestJS + Prisma 7 on Neon Postgres) goes live on Vercel for the first time. Ayush wants every change checked and deployed automatically, so that **the deployed site always has every feature working**. The pipeline itself is written in **Go** (Ayush's request).

**How it works (Ayush's decision):** pull requests are checked but not deployed. **Merging a PR into `main` is what puts the change on the live site.** There are no per-PR preview sites.

Success looks like this:

- Every PR shows green or red checks before merge.
- Merging to `main` puts the change live only if every check passes, and the live site is verified straight after.
- Nobody deploys by hand, and a broken build never reaches the live site.
- Nothing a pull request runs can touch production.

## Goals

1. **Two Vercel projects from one repo**:
   - `eduadmin-web`: the static Vite build.
   - `eduadmin-api`: NestJS as a Vercel Function, with Fluid compute, region `sin1` (Singapore, next to the Neon database).
2. **One site for the browser**: the web project rewrites `/api/*` to the API project, so the browser only talks to the web origin.
   - This is required because login uses `sameSite: lax` cookies (`auth.controller.ts:117`).
   - `*.vercel.app` is a public suffix, so two `vercel.app` hosts would count as cross-site and the cookie would never be sent.
3. **A Go pipeline** (`tools/pipeline`) runs every stage. GitHub Actions only triggers it and supplies secrets.
4. **PRs:** checks only (types, lint, unit tests, build, database e2e tests). No secrets, no deploys.
5. **Merge to `main`:** checks, then the release, in this order:
   - additive-only migration;
   - API deploy, then web deploy;
   - read-only smoke tests against the live site;
   - automatic rollback of both deployments if the smoke tests fail.
6. **API ready for serverless**: the daily digest moves to Vercel Cron, and the in-process scheduler is off on Vercel. Login and verification limits move to Postgres.

## Non-goals

- **No per-PR preview sites** (Ayush's decision). If Ayush wants them later, the earlier revision of this document (in git history, commit `c6364c7`) has a full design with separate preview projects and scrubbed data.
- No staging environment.
- No custom domain yet. The site uses `*.vercel.app` addresses; a domain later only changes `WEB_ORIGIN`, the R2 CORS rule and the Vercel domain settings.
- No app feature changes, no Docker images, no other host.
- Vercel Blob isn't used. Files stay on Cloudflare R2, which Ayush chose after a price comparison.
- No paid plans yet (see "Plans").

## Anti-goals: failures even if it "works"

- **A pull request reaching production.** PR jobs run the PR's own code, so they get **no secrets at all**.
- **The live site deployed while a check is red**, or Vercel's own Git integration deploying around the pipeline. Vercel's GitHub auto-deploy would also build every PR branch with production settings, so it's switched off.
- **Real personal data in logs or job summaries.** The repo is **public**, so its Actions logs are public.
- **Smoke tests creating data on the live site.** Ayush doesn't want fake or hardcoded data in the product.
- **Secrets printed in logs** or committed.

## Decisions made by Ayush

- Hosting: Vercel, for both web and API.
- Database: Neon project `eduadmin-prod`.
  - Postgres 17, AWS Asia Pacific (Singapore), database `eduadmin`.
  - It starts empty; tables are created only by `prisma migrate deploy` from the pipeline.
- Email: Gmail SMTP, with an app password made for production.
- Files: Cloudflare R2 bucket `eduadmin-prod`.
  - Automatic location (Asia Pacific), Standard storage class, public access off.
  - A lifecycle rule deletes `uploads/` after 1 day.
  - An Account API token has Object Read & Write on that bucket only.
- **No per-PR previews.** The live site updates when a PR is merged into `main`.
- **Vercel Hobby (free) for now.** Ayush moves to Pro later.
- Pipeline language: Go.

## Plans and what Hobby means now

| | Hobby (now) | When Ayush moves to Pro |
|---|---|---|
| Terms | Personal, **non-commercial** use only | Required before schools pay |
| Digest cron | Daily entries, each fires somewhere within its hour | One entry every 10 min from 19:00 IST, on the minute |
| Rollback | Only to the immediately previous production deployment | Any earlier production deployment |
| Function region | One region (`sin1`), which is all we need | Same |

## Credentials

All secrets move into a **GitHub Environment `production`**, restricted to the `main` branch. Only the release and setup jobs use it, and PR jobs get nothing. It holds:

- `VERCEL_TOKEN`, `VERCEL_ORG_ID`.
- `PROD_DATABASE_URL` (pooled; runtime only), `PROD_DIRECT_URL` (direct; migrations only).
- `PROD_SMTP_USER`, `PROD_SMTP_PASS`, `PROD_MAIL_FROM`.
- `PROD_R2_ACCOUNT_ID`, `PROD_R2_ACCESS_KEY_ID`, `PROD_R2_SECRET_ACCESS_KEY`, `PROD_R2_BUCKET`.
- `CRON_SECRET`.

**Changes Ayush makes in GitHub** (step by step in the build plan and in `docs/deploy.md`):

- Create the `production` Environment (Settings → Environments), restricted to `main`.
- Add the secrets above to it, then delete the repository-level copies.
- **Delete `NEON_API_KEY` and `NEON_PROJECT_ID`.** They were only for previews. That Neon key can reach every Neon project, so also revoke it in the Neon console.

**In Vercel**, production env vars are written as **Sensitive** (write-only). GitHub is the single source of truth, and the pipeline syncs env vars on each release. Nobody edits them in the dashboard.

## Architecture

```
GitHub
 ├─ pull_request ─► pr.yml       (no secrets)          go run ./tools/pipeline check
 │                                                     go run ./tools/pipeline e2e
 ├─ push to main ─► release.yml  (environment: production)
 │                     check → e2e → release: rollback-state check → migrate → deploy api → deploy web → smoke → rollback on fail
 └─ manual ──────► setup.yml     (environment: production)   go run ./tools/pipeline setup
```

### Vercel projects

| Project | Root | Notes |
|---|---|---|
| `eduadmin-api` | `apps/api` | NestJS zero-config entry `src/main.ts` (Vercel CLI ≥ 48.4), Node 22, region `sin1`, crons in `apps/api/vercel.json`. |
| `eduadmin-web` | `apps/web` | Vite, output `dist`. `apps/web/vercel.json`: SPA fallback (non-file paths → `index.html`) and `/api/:path*` rewritten to the production API URL. |

Both projects share these settings:

- **Vercel's Git auto-deploy is off** (`git.deploymentEnabled: false`). Only the pipeline deploys, with `vercel pull` / `vercel build` / `vercel deploy --prebuilt --prod`, using the pinned CLI version.
- Install runs from the monorepo root with the frozen lockfile.
- `prisma generate` runs inside `vercel build`, because `src/generated/prisma` is git-ignored. The bundle must stay under 250 MB uncompressed.
- The rewrite target is the API project's production URL, written into the web build config by the pipeline (not hardcoded in git), so a later custom domain or project rename is a config change.
- No deployment protection on production: it's the public site, and the app's own login protects data.

### Environment (API, production)

| Variable | Value |
|---|---|
| `NODE_ENV` | production |
| `DATABASE_URL` | `PROD_DATABASE_URL` (pooled) |
| `DIRECT_URL` | `PROD_DIRECT_URL` (migrations only; set on the API project only if Prisma needs it at runtime) |
| `WEB_ORIGIN` | the production web URL |
| `TRUST_PROXY` | the verified hop count (see Risks) |
| `REQUIRE_EMAIL_VERIFICATION` | true |
| `SMTP_HOST` / `SMTP_PORT` | smtp.gmail.com / 465 |
| `SMTP_USER` / `SMTP_PASS` / `MAIL_FROM` | `PROD_*` |
| `R2_*` | `PROD_R2_*` |
| `DIGEST_ENABLED` / `DIGEST_HOUR_IST` | true / 19 |
| `CRON_SECRET` | secret |

### Daily digest on Vercel Cron

- **New endpoint:** `GET /api/internal/cron/digest`, on the **API project's own URL**. Vercel calls crons with GET, doesn't follow redirects, and doesn't go through the web rewrite.
  - It requires `Authorization: Bearer $CRON_SECRET`, which Vercel sends automatically, compared in constant time.
  - It returns **401 when the header is wrong or `CRON_SECRET` isn't set**.
  - It runs `DigestService.sendDue()` then `NotificationsService.prune()`, as `DigestScheduler.tick()` does now, and only when the IST hour is ≥ `DIGEST_HOUR_IST`.
- **Hobby schedule:** three daily entries at 14:00, 15:00 and 16:00 UTC. Each fires somewhere within its hour, so digests go out **between about 19:30 and 22:30 IST**. `docs/deploy.md` and the Preferences hint say "in the evening", not "at 7 PM".
  - The three runs line up with `DIGEST_MAX_ATTEMPTS = 3`.
  - The `EmailDigest` claim (5-minute TTL) makes a duplicate invocation harmless.
  - Vercel doesn't retry a failed invocation; the next entry is the retry.
- On Pro later: one entry `*/10 13-18 * * *` UTC; nothing else changes.
- **`DigestScheduler` (`setInterval`)** doesn't start when `VERCEL=1`. It stays for local development only.

### Rate limits on serverless

The global throttler (`app.module.ts:33`, 120/min per IP) stays in memory as a best-effort limit per instance. **Login and verification attempts, and "email me now", move to Postgres-backed counters** (a small table with expiring rows), so those limits hold across instances.

### PR flow (`pull_request`)

- `check`: API and web typecheck, lint, unit tests (web tests under the three timezones as today), build, and `go vet` / `gofmt` / `go test` for the pipeline.
- `e2e`: a Postgres 17 service, `prisma migrate deploy` from empty, the e2e suite, and `migrate diff` = empty.
- No secrets and no deploys, so fork and Dependabot PRs behave exactly like Ayush's own.
- Recommended GitHub setting for Ayush: branch protection on `main` requiring `check` and `e2e`.

### Release flow (push to `main`)

1. `check` and `e2e` again on the merged commit. Stop on failure.
2. **Rollback state check.** If either project is still rolled back from an earlier failed release (production auto-assignment is off), stop with a clear message: undo the rollback or promote first. Otherwise the new deployment wouldn't go live.
3. `prisma migrate deploy` with `PROD_DIRECT_URL`. The old deployment keeps serving meanwhile.
   - **Expand/contract rule:** a release only adds (tables, nullable or defaulted columns, indexes). Drops and renames come one release later, after no deployed code uses them.
   - The pipeline warns on `DROP` or `RENAME` in a new migration; `docs/deploy.md` states the rule.
   - On failure, stop; nothing is deployed. Lock timeouts are reported with the `migrate resolve --rolled-back` hint from `docs/deploy.md`.
4. Sync env vars (Sensitive), then deploy the API to production, then the web.
5. Read-only smoke tests against the live site.
6. On smoke failure: roll back both projects to their previous production deployments (on Hobby, only the immediately previous one) and fail the run. The database isn't rolled back; expand/contract makes that safe. The run says plainly that the projects are now rolled back, and how to undo it.
7. One release at a time: a `concurrency` group with `cancel-in-progress: false`, so a release is never cut off between migrating and deploying.

### First admin on the empty production database

After the first release, Ayush runs the existing invite script **on his own computer**, against `PROD_DIRECT_URL` from his password manager:

```
pnpm --filter api invite:create -- "Ayush" --max-uses 1 --days 1
```

The code appears only in his terminal. No CI job creates or prints invite codes, because the public repo means public logs.

### Smoke tests (Go, read-only)

- Web `/` serves the app shell, and its JS and CSS load. A deep link (e.g. `/dashboard`) gets the SPA fallback.
- `GET /api/health` (through the web rewrite) returns 200 with the database reachable.
- `GET /api/auth/me` with no cookie returns 401.
- Helmet's security headers are present. CORS refuses an unknown origin.
- The API sees the caller's real IP, and a forged `X-Forwarded-For` isn't trusted beyond the configured hops. This needs a small read-only diagnostic: e.g. `/api/health` echoing the IP it saw, or a check the builder designs.
- `GET /api/internal/cron/digest` on the API URL without the secret returns 401.

These prove the live site is wired up correctly: pages, API, database, auth, cron lock. Feature behaviour is covered by the unit and e2e suites that must pass before any release.

## The Go pipeline

- Location: `tools/pipeline/`, its own Go module. CI pins one Go version; Ayush has 1.26 locally.
- Standard library first. No Dagger and no Docker requirement (my call: it runs the same on Windows and Linux).
- Commands:
  - `check`, `e2e`
  - `release`
  - `smoke <web-url> <api-url>`
  - `setup`
- Each command prints clear stage headings and fails fast with the failing command's output.
- **Masking:** values of `*_TOKEN`, `*_KEY`, `*_SECRET`, `*_PASS`, `PROD_*` and any connection string are masked with `::add-mask::` before use, and never echoed.
- Vercel: the pinned Vercel CLI handles pull, build and deploy; the REST API handles env vars, project settings, rollback state, rollback and promote.
- `setup` (manual, environment `production`) is idempotent. It creates or updates both projects:
  - root directory, framework, region `sin1`, Node 22;
  - Git auto-deploy off;
  - Sensitive env vars.
- Tests:
  - unit tests for env building, masking, rewrite generation, the migration DROP/RENAME warning, rollback-state detection, and the Vercel client against `httptest` servers;
  - `go vet` and `gofmt` run in `check`.

### GitHub Actions

- Workflows: `pr.yml`, `release.yml`, `setup.yml`.
- They replace `.github/workflows/ci.yml`, keeping its checks (Node 22, the Postgres e2e service, bumped to Postgres 17 to match Neon).
- Permissions are `contents: read`.
- Third-party actions are pinned by commit SHA. Dependabot updates the Actions versions, the Go module and the npm packages.

## Changes needed in the app

1. `apps/api`:
   - `vercel.json` (region, crons);
   - the internal cron controller;
   - the scheduler off on Vercel;
   - Postgres-backed login, verification and send-now limits;
   - tests for each.
2. `apps/web`:
   - `vercel.json` with the SPA fallback and the `/api` rewrite placeholder;
   - the Preferences digest hint changed to "in the evening".
3. `docs/deploy.md`, a "Deploying on Vercel" section covering:
   - the projects and credentials, and the GitHub steps;
   - the first release and first admin;
   - the expand/contract rule;
   - rollback and undoing it;
   - the R2 CORS rule with the production web origin;
   - Hobby limits and what changes on Pro.

   Also replace the "run migrations by hand" wording.
4. R2 bucket CORS: once the production web URL exists, add it with PUT and GET.

## Risks to check early

1. **NestJS on Vercel:**
   - `main.ts` uses a top-level `await bootstrap()` with `listen()`; confirm zero-config accepts it, or add an exported handler;
   - the Prisma generated client in the bundle;
   - the bundle size.
2. **The web → API rewrite between two projects:** cookies, `Set-Cookie` passing through, request body limits (imports post up to ~2 MB of JSON).
3. **`TRUST_PROXY` hop count** through Vercel's edge and the cross-project rewrite. A wrong count gives every user the same `req.ip` (breaking per-user limits) or lets a forged one through.
4. **The first release is against an empty database.** The first `migrate deploy` replays all migrations. Check it stays within the job timeout and Neon's limits.

## Left to the builder

- The exact Go package layout and flag names.
- The table design for the Postgres-backed limits.
- How the smoke test checks the client IP without exposing anything sensitive.
