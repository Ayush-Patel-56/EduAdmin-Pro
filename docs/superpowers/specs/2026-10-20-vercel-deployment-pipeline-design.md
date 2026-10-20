# Vercel deployment and Go pipeline — design

Date: 2026-10-20. Status: draft for Ayush's review.

## Intent

EduAdmin Pro (pnpm monorepo: `apps/web` React/Vite, `apps/api` NestJS + Prisma 7 on Neon Postgres) goes live on Vercel for the first time. Ayush wants every push to be checked and deployed automatically, so that **the deployed site always has every feature working**, and every pull request gets a **preview website** to click through before merging. The pipeline itself is written in **Go** (Ayush's request).

Success looks like:

- Opening or updating a PR gives a working preview link (web + API + its own database copy) posted on the PR, after all checks pass.
- Merging to `main` puts the change on the production site only if every check passes, and the live site is verified after deploying.
- Nobody deploys by hand, and a broken build never reaches production.

## Goals

1. **Two Vercel projects from one repo**: `eduadmin-web` (static Vite build) and `eduadmin-api` (NestJS as a Vercel Function, Fluid compute, region `sin1` Singapore, next to the Neon database).
2. **One site for the browser**: the web project rewrites `/api/*` to the API deployment, so the browser only ever talks to the web origin. Required because login uses `sameSite: lax` cookies, and `*.vercel.app` is a public suffix, so two `vercel.app` hosts would be cross-site and the cookie would never be sent.
3. **A Go pipeline** (`tools/pipeline`) that runs every stage. GitHub Actions only triggers it and supplies secrets.
4. **PR previews**: each PR gets a Neon branch copied from production (Ayush's choice), its own preview API and web deployments wired to each other, smoke tests against the live preview, and a PR comment with the link. The branch and deployments are cleaned up when the PR closes.
5. **Production releases on merge to `main`**: checks → production migration → API deploy → web deploy → live smoke tests → automatic rollback of the deployments if the smoke tests fail.
6. **API ready for serverless**: the daily digest moves from the in-process `setInterval` scheduler to Vercel Cron, and the environment gains a "preview" mode with the safeguards below.

## Non-goals

- No custom domain yet: production uses the `*.vercel.app` addresses. Adding a domain later only changes `WEB_ORIGIN`, the R2 CORS rule and the Vercel domain settings.
- No staging environment between preview and production.
- No change to app features.
- No Docker images and no other host (Render, Fly, etc.).
- Vercel Blob is not used: file storage stays on Cloudflare R2 (decided by Ayush after a price comparison).

## Anti-goals (would be a failure even if it "works")

- **Real school data reachable by the public on a preview.** Previews hold a copy of production data, so every preview URL (web and API) must require Vercel login: Ayush, plus the PR reviewer Kayd-06 (see "Who opens previews"). Smoke tests get through with Vercel's "Protection Bypass for Automation" secret, never by turning protection off.
- **A preview contacting real people.** A preview must never send email (verification codes, digests, invites). Real teachers' and parents' addresses are in the copied data.
- **A preview writing to the production R2 bucket.**
- **Production smoke tests creating data.** Ayush does not want fake or hardcoded data in the product. Production checks are read-only.
- **Production deployed while a check is red**, or Vercel's own Git integration deploying around the pipeline.
- **Secrets printed in logs** or committed to the repo.

## Decisions made by Ayush

- Hosting: Vercel, for both web and API.
- Database: Neon. A new project `eduadmin-prod`, Postgres 17, AWS Asia Pacific (Singapore), database `eduadmin`, empty, with tables created only by `prisma migrate deploy` from the pipeline.
- Email: Gmail SMTP with an app password made for production.
- Files: Cloudflare R2, bucket `eduadmin-prod` (Automatic location, Asia Pacific; Standard class; public access off), a lifecycle rule deleting `uploads/` after 1 day, and an Account API token with Object Read & Write on that bucket only.
- PR previews: yes, with the database **copied from production**.
- Who opens previews: **Ayush and the reviewer (Kayd-06) only.**
- Pipeline language: Go.

## Secrets already in GitHub (Repository secrets)

`VERCEL_TOKEN`, `VERCEL_ORG_ID`, `PROD_DATABASE_URL` (pooled), `PROD_DIRECT_URL` (direct), `PROD_SMTP_USER`, `PROD_SMTP_PASS`, `PROD_MAIL_FROM`, `PROD_R2_ACCOUNT_ID`, `PROD_R2_ACCESS_KEY_ID`, `PROD_R2_SECRET_ACCESS_KEY`, `PROD_R2_BUCKET`, `CRON_SECRET`.

Still to add: `NEON_API_KEY` and `NEON_PROJECT_ID` (asked for, for preview branches), and `VERCEL_AUTOMATION_BYPASS_SECRET` (generated in each Vercel project's Deployment Protection settings, or created by the setup command; see below).

**GitHub secrets are the single source of truth.** The pipeline pushes environment variables to Vercel on every deploy, so nobody edits them by hand in the Vercel dashboard.

**Production secrets live in a GitHub Environment, not the repository (my call).** The repo is **public**, and a PR's preview job runs the PR's own copy of `tools/pipeline`. So any PR from a branch in this repo could read every Repository secret. The fix:

- Create a GitHub Environment `production`, restricted to the `main` branch. Move these secrets into it (Ayush does this once in GitHub → Settings → Environments; the setup notes in `docs/deploy.md` list the steps):
  - `PROD_DIRECT_URL`, `PROD_DATABASE_URL`
  - `PROD_SMTP_USER`, `PROD_SMTP_PASS`, `PROD_MAIL_FROM`
  - `PROD_R2_*`
  - `CRON_SECRET`
- Only the release and invite jobs use that environment.
- Preview jobs get only `VERCEL_TOKEN`, `VERCEL_ORG_ID`, `NEON_API_KEY`, `NEON_PROJECT_ID` and the bypass secret. Their database URL comes from the Neon API for the PR's branch.

**Because the repo is public, Actions logs and job summaries are public too.** Nothing secret, personal or school-related may ever be printed: no connection strings, codes, emails or student data.

**Dependabot and fork PRs** get no secrets, so they skip the preview job, with a clear "skipped: no secrets" note. Branch protection requires check and e2e, not preview, so these PRs can still merge (my call).

## Architecture

```
GitHub push / PR
      │  (thin workflows: checkout, setup Go/Node/pnpm, secrets → env)
      ▼
go run ./tools/pipeline <command>
      ├─ check      types, lint, unit tests (api + web), build
      ├─ e2e        throwaway Postgres (CI service): migrate deploy from empty, e2e suite, migrate diff = empty
      ├─ preview    Neon branch from prod → migrate deploy → deploy API → deploy web (rewrite to that API) → smoke → PR comment
      ├─ cleanup    delete the PR's Neon branch (+ stale ones), remove preview deployments
      ├─ release    migrate prod → deploy API (prod) → deploy web (prod) → smoke → rollback on failure
      └─ smoke      read-only checks against any URL (also usable by hand)
```

### Vercel projects

- **`eduadmin-api`**: root directory `apps/api`, framework NestJS (zero-config entry point `src/main.ts`, Vercel CLI ≥ 48.4), Node 22, region `sin1`. Install from the monorepo root with the frozen lockfile. `prisma generate` must run in the build. Build output must keep `src/generated/prisma` and the pg adapter inside the function bundle (check the 250 MB limit).
- **`eduadmin-web`**: root directory `apps/web`, Vite, output `dist`. Its `vercel.json` has an SPA fallback (non-file paths → `index.html`) and the `/api/:path*` rewrite to the API deployment's URL. For previews the rewrite target is that PR's API preview URL. The pipeline writes it into the web build config before `vercel build`, so the build in Git is never tied to one URL.
- **Vercel's Git auto-deploy is turned off** for both projects (`git.deploymentEnabled: false`). Only the pipeline deploys, using `vercel pull` / `vercel build` / `vercel deploy --prebuilt`, which is what makes "checks must pass first" true.
- **Deployment Protection**: Vercel Authentication on previews, plus Protection Bypass for Automation for the pipeline's smoke tests. **Builder must verify early (spike)** that the web preview's rewrite to the protected API preview works for a logged-in Vercel user. If it doesn't, the fallback is to protect the API preview with the bypass header injected by the rewrite, or to serve the preview API under the web preview's own project. Either way, neither preview may be public.

### Who opens previews

Ayush (the Vercel account owner) and Kayd-06 (the reviewer) only.

- On Hobby, Vercel allows **one external collaborator at a time**, invited by email through the deployment's **Share** dialog. Kayd-06 is that collaborator and logs in with their own Vercel account.
- Shareable "anyone with the link" links are **not** used: Hobby allows only one, and anyone holding it could open real data.
- **Spike, early:** confirm whether one invite gives Kayd-06 access to every PR's preview, or only one deployment or branch.
  - If it doesn't carry over and can't be automated through Vercel's API, the fallback is a Pro team with Kayd-06 as a member: 2 seats, about $40 a month. Ayush decides.
  - Don't work around this by weakening protection.
- The pipeline's PR comment links the web preview and says that Vercel login is required.

### Environment per target

| Variable | Production | Preview |
|---|---|---|
| `NODE_ENV` | production | production |
| `APP_ENV` (new) | production | preview |
| `DATABASE_URL` / `DIRECT_URL` | `PROD_*` | the PR's Neon branch (pooled / direct) |
| `WEB_ORIGIN` | production web URL | that PR's web preview URL |
| `TRUST_PROXY` | 1 (verify the right hop count on Vercel) | 1 |
| `REQUIRE_EMAIL_VERIFICATION` | true | true |
| `SMTP_HOST` / `SMTP_PORT` | smtp.gmail.com / 465 | unset |
| `SMTP_USER` / `SMTP_PASS` / `MAIL_FROM` | `PROD_*` | unset |
| `R2_*` | `PROD_R2_*` | unset (uploads off) |
| `DIGEST_ENABLED` | true | false |
| `DIGEST_HOUR_IST` | 19 | — |
| `CRON_SECRET` | secret | unset |

**New `APP_ENV=preview` mode in the API** (`config/env.ts`, `MailService`):

- SMTP is not required. `MailService` never sends: it logs only the recipient's internal user id and the subject, never the address or the code.
- R2 is absent, so uploads are refused with the existing clear message. Photos already stored in production don't load on previews (accepted).
- Digests and cron are off.
- `APP_ENV` is accepted only as `production` or `preview`, and the API refuses to boot with `APP_ENV=preview` if it sees the production database host (a guard against a mis-wired preview).

How a preview tester logs in without email: they use their own real production account (the data is a copy). Because previews send no email, new sign-ups on a preview can't verify. Accepted for now; the builder may add a preview-only, logged verification code that never leaves the server logs, if it is simple and can't be enabled in production.

### Daily digest on Vercel Cron

- **Ayush has not chosen Hobby or Pro yet.** The design assumes **Hobby**: each cron runs at most once a day, at any point within its hour.
- New endpoint `POST /api/internal/cron/digest`. It requires `Authorization: Bearer $CRON_SECRET` (Vercel sends this automatically when `CRON_SECRET` is set), compared in constant time, and returns 404 without it. It runs `DigestService.sendDue()` then `NotificationsService.prune()`, as `DigestScheduler.tick()` does today.
- Three daily cron entries in `apps/api/vercel.json` at 14:00, 15:00 and 16:00 UTC (19:30, 20:30 and 21:30 IST, ±59 min). These line up with the existing `DIGEST_MAX_ATTEMPTS = 3`: one attempt per run, with the claim TTL (5 min) far shorter than the gap.
- The `setInterval` scheduler stays for local and dev, but is off whenever running on Vercel (detect `VERCEL=1`).
- If Ayush picks Pro later, swap to one entry every 10 minutes from 19:00 IST to midnight, and nothing else changes.
- Vercel runs crons only on production deployments, so previews get none.

### Rate limits on serverless

`ThrottlerModule` (120/min per IP, plus stricter per-route limits on login and verification) and the "email me now" limit (3 per hour per account) keep their counts in memory. On Vercel each instance keeps its own count, so the limits weaken as traffic spreads across instances.

**Builder's call, recommended:** move the throttler's storage and the send-now count into Postgres (a small table with expiring rows), so login and verification-code limits hold across instances. If it's deferred, `docs/deploy.md` must say so.

### Preview flow (on `pull_request` opened / synchronize / reopened)

1. `check` and `e2e` (as today's CI). Stop on failure.
2. **Neon:** create or reuse branch `preview/pr-<n>` from the production branch (copy-on-write, instant). On reuse after a new push, **reset it to production** so each preview run starts from a fresh copy (builder may choose reuse-without-reset if a reset is slow; note in the PR comment which it is). Read its pooled and direct connection strings through the Neon API.
3. `prisma migrate deploy` against the branch (applies the PR's new migrations on top of real data, which is also a test that the migration works on production-shaped data). Then `migrate diff` against the PR's schema must be empty.
4. Deploy the API preview with the preview environment, then deploy the web preview with the rewrite pointing at it.
5. Smoke tests against the web preview URL (through the rewrite, so cookies and routing are tested as users see them). Previews may run the full flows below, because the branch is a throwaway copy.
6. Post or update one PR comment: web preview link, commit SHA, smoke results, and the Neon branch name. Fail the check if any step failed.

**Cleanup** (on `pull_request` closed, and a nightly scheduled run): delete `preview/pr-<n>` and any `preview/*` branch whose PR is closed. Remove that PR's preview deployments. The Neon plan's branch limit must not be hit by leftovers.

PRs from forks get no secrets and therefore no preview (GitHub's rule). The checks still run.

### Production flow (on push to `main`)

1. `check` and `e2e`. Stop on failure.
2. `prisma migrate deploy` with `PROD_DIRECT_URL`. Migrations are additive by convention (see `docs/deploy.md`, "migration → API → web"), so the previous API keeps working during the release. If the migration fails, stop: nothing is deployed. `lock_timeout` failures are reported with the `migrate resolve --rolled-back` hint from `docs/deploy.md`.
3. Deploy the API to production, then the web to production.
4. Production smoke tests (read-only).
5. If smoke fails: roll back both projects to their previous production deployments (`vercel rollback` / promote previous) and fail the run. The database is not rolled back (additive migrations make that safe). The run says so plainly.
6. Concurrency: one production release at a time (`concurrency` group, no cancel-in-progress, because a release must never be cut off between migration and deploy).

### Smoke tests (Go, `tools/pipeline/smoke`)

**Read-only, run everywhere (production included):**

- Web `/` returns the app shell and its JS/CSS assets load. A deep link (e.g. `/dashboard`) gets the SPA fallback.
- `GET /api/health` returns 200 and reports the database is reachable.
- `GET /api/auth/me` with no cookie returns 401.
- Security headers from helmet are present on API responses. CORS refuses an unknown origin.
- `POST /api/internal/cron/digest` without the secret returns 404 (production only).

**Previews only (the data is a throwaway copy):** log in with a dedicated smoke account and walk the main areas: dashboard, students, teachers, syllabus, daily reports, notifications. Each page's API calls must return 2xx. How the smoke account exists on a copy of production is the builder's design, within the anti-goals: e.g. the pipeline creates it directly in the preview branch's database after branching, never in production.

## The Go pipeline

- Location: `tools/pipeline/` as its own Go module (Go 1.22+ with modules; Ayush's machine has Go 1.26, CI pins one version). Standard library first: `os/exec`, `net/http`, `encoding/json`. No Dagger and no Docker requirement (my call: runs the same on Ayush's Windows machine and on Linux CI).
- **`invite` (first admin and later ones, my call).** The production database starts empty, and admin sign-up needs an invite code (today only `apps/api/scripts/create-invite.ts`, run against a direct database connection).
  - A manually triggered workflow, "Create admin invite", runs in the `production` environment with inputs: email, max uses, days.
  - It creates the code with the same rules as the script, reusing its logic and not duplicating it, and **emails** the code to the given address through the production SMTP.
  - The code is never printed to the log or the job summary; the run only says "invite sent".
  - Ayush runs it once after the first release to create his own admin account.
- Commands as above. Each prints clear stage headings, fails fast with the failing command's output, and never echoes secret values (mask anything read from `PROD_*`, `*_SECRET`, `*_TOKEN`, `*_KEY`, and connection strings).
- Talks to Vercel through the Vercel CLI (pinned version via `pnpm dlx vercel@<version>`) for pull/build/deploy, and to the Vercel REST API for env vars, project settings and rollback where the CLI is awkward. Talks to Neon through its REST API.
- A one-time, idempotent `setup` command creates or updates both Vercel projects (root directory, framework, region `sin1`, Node 22, Git auto-deploy off, protection settings) and syncs env vars. Ayush runs it once, or CI runs it on the first release.
- Tests: unit tests for the pure parts (env building per target, secret masking, rewrite generation, PR-comment rendering, Neon/Vercel API clients against `httptest` servers). `go vet` and `gofmt` run in `check`.

### GitHub Actions

- Replace `.github/workflows/ci.yml` with workflows that call the pipeline:
  - `pr.yml` (pull_request: check, e2e, preview);
  - `release.yml` (push to main: check, e2e, release);
  - `cleanup.yml` (PR closed + nightly).
- `check` and `e2e` stay separate jobs (as now) so failures are easy to read. Keep Node 22 (the API tests crash on Node 20) and the Postgres service for e2e. Bump the e2e Postgres image to 17 to match Neon production.
- Permissions: `contents: read` by default; `pull-requests: write` only on the job that comments.
- Recommended for Ayush (a GitHub setting, not code): branch protection on `main` requiring the check, e2e and preview jobs before merge.

## Changes needed in the app

1. `apps/api`:
   - `vercel.json` (region `sin1`, crons);
   - the internal cron controller (bearer check, constant-time compare);
   - the scheduler disabled on Vercel;
   - `APP_ENV` in `validateEnv` and `MailService`, with the production-host guard;
   - (recommended) Postgres-backed rate limits;
   - tests for each.
2. `apps/web`: `vercel.json` with the SPA fallback and an `/api` rewrite placeholder the pipeline fills in.
3. `docs/deploy.md`:
   - a "Deploying on Vercel" section: projects, env table, secrets list, first release steps, R2 CORS rule with the production web origin, rollback, and the preview data rules;
   - replace the "run migrations by hand" wording with "the pipeline runs them".
4. R2 bucket CORS: once the production web URL exists, add `https://<web>.vercel.app` with PUT/GET (one-time, documented; previews have no uploads so need no CORS entry).

## Risks to check early

- **Rewrite to a protected API preview** (see Vercel projects). Spike first.
- **NestJS bundle on Vercel:** the Prisma generated client path (`src/generated/prisma`), ESM with top-level `await bootstrap()`, and bundle size.
- **`TRUST_PROXY` hop count on Vercel:** the session IP and the throttler key must be the real client IP and not spoofable.
- **Neon plan branch limits and branch reset time.**
- **Hobby plan terms:** commercial use needs Pro. Ayush to decide before real schools use it.
- **Production smoke depth:** the first release runs against an empty database, so production checks prove the deployment is wired up (pages, API, database, auth refusal), not every feature. Feature-level checks happen on previews, which run against a copy of real data.

## Left to the builder

- Exact Go package layout and CLI flag names.
- How the PR comment looks.
- Whether reusing a preview branch resets it every push (default: reset).
- The preview smoke account mechanism, within the anti-goals.
- Whether rate limits move to Postgres now (recommended) or are documented as a follow-up.
