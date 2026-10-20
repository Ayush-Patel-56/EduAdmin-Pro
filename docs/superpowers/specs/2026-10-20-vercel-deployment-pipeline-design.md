# Vercel deployment and Go pipeline: design

Date: 2026-10-20. Status: revision 2, after Kayd-06's design review, for Ayush's approval.

## Intent

EduAdmin Pro (pnpm monorepo: `apps/web` React/Vite, `apps/api` NestJS + Prisma 7 on Neon Postgres) goes live on Vercel for the first time. Ayush wants every push checked and deployed automatically, so that **the deployed site always has every feature working**. Every pull request should get a **preview website** to click through before merging. The pipeline itself is written in **Go** (Ayush's request).

Success looks like this:

- Opening or updating a PR gives a working preview link (web, API and its own database) posted on the PR, after all checks pass.
- Merging to `main` puts the change on the production site only if every check passes, and the live site is verified after deploying.
- Nobody deploys by hand, and a broken build never reaches production.
- **Nothing a pull request runs can touch production:** no deploys, no settings, no database, no secrets.

## Goals

1. **Production on Vercel**: two projects from one repo.
   - `eduadmin-web`: the static Vite build.
   - `eduadmin-api`: NestJS as a Vercel Function, with Fluid compute, region `sin1` (Singapore, next to the Neon database).
2. **One site for the browser**: the web project rewrites `/api/*` to its API deployment, so the browser only talks to the web origin.
   - This is required because login uses `sameSite: lax` cookies (`auth.controller.ts:117`).
   - `*.vercel.app` is a public suffix, so two `vercel.app` hosts would count as cross-site.
3. **Previews fully separated from production**: separate Vercel projects and a separate Neon project, each with credentials that can't reach production.
4. **Preview data is a scrubbed copy of production**, refreshed every night. It has the same schools, structure and volume, but no real personal details.
5. **A Go pipeline** (`tools/pipeline`) runs every stage. GitHub Actions only triggers it and supplies secrets.
6. **Production releases on merge to `main`**, in this order:
   - checks;
   - additive-only migration;
   - API deploy, then web deploy;
   - read-only smoke tests against the live site;
   - automatic rollback of both deployments if the smoke tests fail.
7. **API ready for serverless**:
   - the daily digest moves to Vercel Cron;
   - the in-process scheduler is switched off on Vercel;
   - a new "preview" mode with safeguards.

## Non-goals

- No custom domain yet. The site uses `*.vercel.app` addresses; a domain later only changes `WEB_ORIGIN`, the R2 CORS rule and the Vercel domain settings.
- No staging environment between preview and production.
- No app feature changes.
- No Docker images and no other host.
- Vercel Blob isn't used. Files stay on Cloudflare R2, which Ayush chose after a price comparison.
- No paid plans yet (see "Plans").

## Anti-goals: failures even if it "works"

- **A pull request reaching production.** PR jobs run the PR's own copy of the pipeline. They must never hold a credential that can do any of these:
  - deploy, promote or roll back the production projects;
  - change production settings;
  - read production env vars;
  - read, change or delete the production database.
- **Real personal data outside production**, in previews, logs, job summaries or artifacts. The repo is **public**, so its Actions logs and job summaries are public too.
- **A preview contacting real people.** A preview never sends email.
- **A preview writing to the production R2 bucket.**
- **Production smoke tests creating data.** Ayush doesn't want fake or hardcoded data in the product, so production checks are read-only.
- **Production deployed while a check is red**, or Vercel's own Git integration deploying around the pipeline.
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
- PR previews: yes.
- **Preview data: a scrubbed copy of production** (revised after the review; Ayush agreed).
- **Vercel Hobby (free) for now.** Ayush will move to Pro later and add Kayd-06 to previews then.
- Pipeline language: Go.

## Plans and what Hobby means now

Designed for Hobby today, with the switch to Pro a settings change and not a redesign.

| | Hobby (now) | When Ayush moves to Pro |
|---|---|---|
| Terms | Personal, **non-commercial** use only | Required before schools pay |
| Who opens previews | Ayush only. Hobby allows one invited outside viewer; Kayd-06 is added later | Kayd-06 invited, or added as a member |
| Digest cron | Daily entries, each fires somewhere within its hour | One entry every 10 min from 19:00 IST, on the minute |
| Rollback | Only to the immediately previous production deployment | Any earlier production deployment |
| Function region | One region (`sin1`), which is all we need | Same |

## Credentials: who holds what

**GitHub Environment `production`** is restricted to the `main` branch. Only the release, nightly scrub and setup jobs use it. It holds:

- `VERCEL_TOKEN`: team-scoped, for the production projects.
- `PROD_DATABASE_URL` (pooled), `PROD_DIRECT_URL` (direct).
- `PROD_SMTP_USER`, `PROD_SMTP_PASS`, `PROD_MAIL_FROM`.
- `PROD_R2_ACCOUNT_ID`, `PROD_R2_ACCESS_KEY_ID`, `PROD_R2_SECRET_ACCESS_KEY`, `PROD_R2_BUCKET`.
- `CRON_SECRET`.
- `NEON_PROD_API_KEY`: **project-scoped** to `eduadmin-prod`. Used only by the nightly scrub to make and delete a temporary branch.
- `NEON_PROD_PROJECT_ID`.
- `NEON_PREVIEW_API_KEY` (also listed below). The scrub job writes the scrubbed copy into the preview project.
- `PREVIEW_LOGIN_PASSWORD`: see "Logging in to a preview".

**Repository secrets** are visible to PR jobs from branches in this repo. They hold only preview credentials:

- `VERCEL_ORG_ID` (not sensitive).
- `VERCEL_PREVIEW_API_TOKEN`: **project-scoped** to `eduadmin-api-preview`.
- `VERCEL_PREVIEW_WEB_TOKEN`: **project-scoped** to `eduadmin-web-preview`.
- `NEON_PREVIEW_API_KEY`: **project-scoped** to `eduadmin-preview`.
- `NEON_PREVIEW_PROJECT_ID`.
- `VERCEL_PREVIEW_BYPASS_SECRET`: the preview projects' Protection Bypass for Automation secret, so smoke tests can get through the Vercel login.

**Changes Ayush makes to what's already in GitHub** (listed step by step in `docs/deploy.md` and in the build plan):

- Create the `production` Environment and move every `PROD_*` secret, `CRON_SECRET` and `VERCEL_TOKEN` into it. Then delete the repository-level copies.
- **Delete the current repository-level `NEON_API_KEY`.** It's an account or organisation key that reaches every Neon project. Make the two project-scoped keys above instead.
- Rename `NEON_PROJECT_ID` to `NEON_PROD_PROJECT_ID` and move it into `production`.
- Add the preview Vercel tokens once `setup` has created the preview projects.

**In Vercel**, production env vars are written as **Sensitive** (write-only), so even a token holder can't read them back. GitHub is the single source of truth, and the pipeline syncs env vars on each deploy. Nobody edits them in the dashboard.

## Architecture

```
GitHub
 ├─ pull_request ──► pr.yml       (repo secrets only: preview credentials)
 │                     check → e2e → preview → smoke(preview) → PR comment
 ├─ push main ─────► release.yml  (environment: production)
 │                     check → e2e → migrate prod → deploy api → deploy web → smoke(prod) → rollback on fail
 ├─ nightly ───────► scrub.yml    (environment: production)   prod → scrubbed copy → preview-base
 │                   cleanup.yml  (repo secrets)              delete stale preview branches and deployments
 ├─ PR closed ─────► cleanup.yml
 └─ manual ────────► setup.yml    (environment: production)   create or configure the Vercel projects

each job: go run ./tools/pipeline <command>
```

### Vercel projects (four, all in Ayush's Hobby scope)

| Project | Root | Notes |
|---|---|---|
| `eduadmin-api` | `apps/api` | Production API. NestJS zero-config entry `src/main.ts` (Vercel CLI ≥ 48.4), Node 22, region `sin1`, crons. |
| `eduadmin-web` | `apps/web` | Production web. `/api/:path*` rewrites to the production API URL; SPA fallback. |
| `eduadmin-api-preview` | `apps/api` | Preview APIs only. No crons. |
| `eduadmin-web-preview` | `apps/web` | Preview web only. Each deployment rewrites to that PR's API preview. |

All four projects share these settings:

- **Vercel's Git auto-deploy is off** (`git.deploymentEnabled: false`). Only the pipeline deploys, with `vercel pull` / `vercel build` / `vercel deploy --prebuilt`, using the pinned CLI version.
- Install runs from the monorepo root with the frozen lockfile.
- `prisma generate` runs inside `vercel build`, because `src/generated/prisma` is git-ignored. The bundle must stay under 250 MB uncompressed.
- The web rewrite target is written into the web build config by the pipeline just before `vercel build`. The committed `apps/web/vercel.json` holds a placeholder, so Git is never tied to one URL.
- **Preview protection:** Vercel Authentication is on for both preview projects.
  - **Spike first:** the browser's Vercel login cookie belongs to the web preview's domain, so a rewrite into a protected API preview may get 401.
  - Options, in order of preference:
    1. Protect only the web preview, and have the API preview accept requests only when they carry the bypass header, which the web rewrite adds.
    2. Have the web rewrite send `x-vercel-protection-bypass` to a protected API preview.
  - The data is scrubbed, but neither preview may be public: the code under review is unreleased.

### Environment per target

| Variable | Production | Preview |
|---|---|---|
| `NODE_ENV` | production | production |
| `APP_ENV` (new) | production | preview |
| `DATABASE_URL` (runtime, pooled) | `PROD_DATABASE_URL` | the PR's branch in `eduadmin-preview`, pooled |
| `DIRECT_URL` (migrations only) | `PROD_DIRECT_URL` | the PR's branch, direct |
| `WEB_ORIGIN` | production web URL | that PR's web preview URL |
| `TRUST_PROXY` | the verified hop count | same |
| `REQUIRE_EMAIL_VERIFICATION` | true | true |
| `SMTP_HOST` / `SMTP_PORT` | smtp.gmail.com / 465 | unset |
| `SMTP_USER` / `SMTP_PASS` / `MAIL_FROM` | `PROD_*` | unset |
| `R2_*` | `PROD_R2_*` | unset (uploads off) |
| `DIGEST_ENABLED` | true | false |
| `CRON_SECRET` | secret | unset |

**`APP_ENV=preview` in the API** (`config/env.ts`, `MailService`, the scheduler):

- SMTP isn't required, and `MailService` never sends. It logs only the internal user id and the subject.
- R2 is absent, so uploads are refused with the existing message. Photos referenced by the scrubbed data don't load (accepted).
- Digests and cron are off.
- `APP_ENV` must be `production` or `preview`.
- **Guard:** the API refuses to boot with `APP_ENV=preview` if **either** `DATABASE_URL` or `DIRECT_URL` points at a production Neon host. The production endpoint hosts come from config the pipeline sets; they aren't hardcoded.

### Preview data: the scrubbed copy

The **nightly `scrub` job** (environment `production`) has five steps:

1. With `NEON_PROD_API_KEY`, create a temporary branch of `eduadmin-prod`. Copy-on-write, so it's instant and never touches the production branch.
2. Run the **scrub SQL** on that temporary branch, so real personal data never leaves the production project.
3. `pg_dump` the scrubbed temporary branch and restore it into branch `preview-base` of `eduadmin-preview`, replacing what was there.
4. Delete the temporary branch, and in every case delete the dump from the runner's disk.
5. Never print rows, and never upload the dump as an artifact.

**Scrub rules: deny by default.** Every text, varchar, JSON or bytes column in every table must have an explicit rule: keep, replace or clear. A test (unit or e2e on the migrated schema) **fails when a column has no rule**, so a new migration that adds a personal-data column can't silently leak into previews.

- **Replace** names and other personal fields with stable placeholders derived from the row id, so relationships still read sensibly. Examples:
  - `fullName` → "Teacher 4f2a" / "Student 9c1e";
  - emails → `user-<id>@preview.invalid`;
  - phone numbers, addresses, guardian details, notes.
- **Free text** (PTM discussion, remarks, report topics, notification bodies, flag reasons) gets neutral placeholder text of similar length.
- **Clear** these entirely:
  - sessions;
  - verification codes and tokens;
  - invite codes;
  - uploaded avatars (`UserAvatar`) and `avatarUrl`;
  - stored file keys;
  - `EmailDigest` rows.
- **Keep** what carries no personal data and makes previews realistic:
  - school and program structure, batch names, subjects, chapters;
  - statuses, dates, marks and ratings (numbers attached to placeholder people);
  - counts.
- **Passwords:** every user's `passwordHash` is replaced with the hash of `PREVIEW_LOGIN_PASSWORD`. See the next section.

**Per-PR branches** (`preview/pr-<n>`) are created from `preview-base`. They're **reset to `preview-base` on each new push** to a PR, then `prisma migrate deploy` applies the PR's migrations on top. That's also a test that the migration works on production-shaped data.

Until the first nightly scrub has run (or while production is still empty), `preview-base` is just the migrated empty schema, and previews start empty.

### Logging in to a preview

All accounts on a preview have placeholder emails and the same preview-only password (`PREVIEW_LOGIN_PASSWORD`, known to Ayush). To test as an admin of a school, open that school's admin account by its placeholder email. The PR comment links to a short how-to.

The preview password exists only in the `production` Environment and in the preview database as a hash. It never works on production, whose hashes are untouched.

### Daily digest on Vercel Cron

- **New endpoint:** `GET /api/internal/cron/digest` on the **API project's own URL**. Vercel calls crons with GET, doesn't follow redirects, and doesn't go through the web rewrite.
  - It requires `Authorization: Bearer $CRON_SECRET`, which Vercel sends automatically, compared in constant time.
  - It returns **401 when the header is wrong or when `CRON_SECRET` isn't set**.
  - It runs `DigestService.sendDue()` then `NotificationsService.prune()`, as `DigestScheduler.tick()` does now, and only when the IST hour is ≥ `DIGEST_HOUR_IST`.
- **Hobby schedule:** three daily entries in `apps/api/vercel.json`, at 14:00, 15:00 and 16:00 UTC. Each fires somewhere within its hour, so digests go out **between about 19:30 and 22:30 IST**. `docs/deploy.md` and the Preferences hint say "in the evening", not "at 7 PM".
  - The three runs line up with the existing `DIGEST_MAX_ATTEMPTS = 3`.
  - The `EmailDigest` claim (5-minute TTL) makes a duplicate invocation harmless.
  - Vercel doesn't retry a failed invocation; the next entry is the retry.
- On Pro later: one entry `*/10 13-18 * * *` UTC (19:00–23:59 IST); nothing else changes.
- **`DigestScheduler` (`setInterval`)** doesn't start when `VERCEL=1` or `APP_ENV` is set. It stays for local development only.
- Crons run only on production deployments. The preview API project has none.

### Rate limits on serverless

The global throttler (`app.module.ts:33`, 120/min per IP) stays in memory as a best-effort limit per instance. **Login and verification attempts, and "email me now", move to Postgres-backed counters** (a small table with expiring rows), so those limits hold across instances. The smoke test checks that `req.ip` is the real client IP through Vercel's edge and the cross-project rewrite, so `TRUST_PROXY` is set to the verified hop count.

### Preview flow (`pull_request`: opened / synchronize / reopened)

1. `check` and `e2e`. Stop on failure.
2. With the Neon preview key: create, or reset to `preview-base`, branch `preview/pr-<n>`. Read its pooled and direct URLs.
3. `prisma migrate deploy` on the branch using the direct URL. Then `migrate diff` against the PR's schema must be empty.
4. Deploy the API preview, then the web preview with the rewrite to it, using the preview project tokens only.
5. Smoke-test the web preview URL through the rewrite (so cookies and routing are tested as users see them), using the bypass secret. Previews may run the full flows below.
6. Post or update one PR comment with:
   - the web preview link (Vercel login required);
   - the commit SHA;
   - the smoke results;
   - the Neon branch name;
   - the date of the scrubbed snapshot.
7. Fail the check if any step failed.

PRs from forks and Dependabot get no secrets. Their preview job is **skipped with a clear note**, not failed. Branch protection (a recommended GitHub setting for Ayush) requires `check` and `e2e`, not `preview`, so those PRs can still merge.

### Cleanup (PR closed, plus nightly)

- Delete `preview/pr-<n>`, and any `preview/*` branch whose PR is closed.
- Remove that PR's preview deployments.
- Keep within Neon Free's 10 branches per project: `preview-base` + per-PR branches + the scrub's temporary branch, which is in the prod project.
- Scale-to-zero is on for preview computes.

### Production flow (push to `main`)

1. `check` and `e2e`. Stop on failure.
2. **Rollback state check.** If either production project is still rolled back from an earlier failed release (production auto-assignment is off), stop with a clear message. The fix is to undo the rollback or promote. Otherwise the new deployment wouldn't go live.
3. `prisma migrate deploy` with `PROD_DIRECT_URL`. The old deployment keeps serving meanwhile.
   - **Expand/contract rule:** a release only adds (tables, nullable or defaulted columns, indexes). Drops and renames come one release later, after no deployed code uses them.
   - The pipeline warns on `DROP` or `RENAME` in a new migration; `docs/deploy.md` states the rule.
   - On failure, stop; nothing is deployed. Lock timeouts are reported with the `migrate resolve --rolled-back` hint from `docs/deploy.md`.
4. Deploy the API to production, then the web.
5. Production smoke tests (read-only).
6. On smoke failure: roll back both projects to their previous production deployments (on Hobby, only the immediately previous one is available) and fail the run. The database isn't rolled back; expand/contract makes that safe. The run says plainly that the projects are now in the rolled-back state.
7. One release at a time: a `concurrency` group with `cancel-in-progress: false`, so a release is never cut off between migrating and deploying.

### First admin on the empty production database

After the first release, Ayush runs the existing invite script **on his own computer**, against `PROD_DIRECT_URL` from his password manager:

```
pnpm --filter api invite:create -- "Ayush" --max-uses 1 --days 1
```

The code appears only in his terminal. No CI job creates or prints invite codes, because the public repo means public logs. `docs/deploy.md` documents this.

### Smoke tests (Go)

**Read-only, everywhere (production included):**

- Web `/` serves the app shell, and its JS and CSS load. A deep link gets the SPA fallback.
- `GET /api/health` returns 200 with the database reachable.
- `GET /api/auth/me` with no cookie returns 401.
- Helmet's security headers are present. CORS refuses an unknown origin.
- The API sees the caller's real IP. A header the smoke test sends with a fake `X-Forwarded-For` must not be trusted beyond the configured hops.
- Production only: `GET /api/internal/cron/digest` without the secret returns 401.

**Previews only:** log in as a scrubbed admin with the preview password, then walk the main areas: dashboard, students, teachers, syllabus, daily reports and notifications. Each page's API calls must return 2xx.

Production starts empty, so production smoke tests prove wiring (pages, API, database, auth), not every feature. Feature-level checking happens on previews, against production-shaped data.

## The Go pipeline

- Location: `tools/pipeline/`, its own Go module. CI pins one Go version; Ayush has 1.26 locally.
- Standard library first. No Dagger and no Docker requirement (my call: it runs the same on Windows and Linux).
- Commands:
  - `check`, `e2e`
  - `preview`, `cleanup`
  - `scrub`
  - `release`
  - `smoke <url>`
  - `setup`
- Each command prints clear stage headings and fails fast with the failing command's output.
- **Masking:** values of `*_TOKEN`, `*_KEY`, `*_SECRET`, `*_PASSWORD`, `PROD_*` and any connection string are masked with `::add-mask::` before use, and never echoed.
- Vercel: the pinned Vercel CLI handles pull, build and deploy; the REST API handles env vars, project settings, rollback state and promote. Neon: the REST API.
- **Each command uses only the credentials its target needs.** The preview and cleanup commands refuse to run if any production credential is present in their environment (defence in depth).
- `setup` (manual, environment `production`) is idempotent. It creates or updates all four projects:
  - root directory, framework, region `sin1`, Node 22;
  - Git auto-deploy off;
  - protection settings;
  - Sensitive env vars.

  It prints which preview tokens Ayush must then create in the Vercel dashboard (project-scoped tokens can only be minted by a full-account token, which the pipeline doesn't hold).
- Tests:
  - unit tests for env building per target, masking, rewrite generation, the scrub rule coverage check, PR-comment rendering, and the Neon and Vercel clients against `httptest` servers;
  - `go vet` and `gofmt` run in `check`.

### GitHub Actions

- Workflows: `pr.yml`, `release.yml`, `scrub.yml`, `cleanup.yml`, `setup.yml`.
- They replace `.github/workflows/ci.yml`, keeping its checks (Node 22, the Postgres e2e service, bumped to Postgres 17 to match Neon).
- Permissions are `contents: read` by default, and `pull-requests: write` only on the commenting job.
- Third-party actions are pinned by commit SHA. Dependabot updates the Actions versions, the Go module and the npm packages.

## Changes needed in the app

1. `apps/api`:
   - `vercel.json` (region, crons);
   - the internal cron controller;
   - the scheduler off on Vercel;
   - `APP_ENV` with the two-URL production-host guard;
   - Postgres-backed login, verification and send-now limits;
   - tests for each.
2. Scrub SQL plus the rule-coverage test. It lives with the API (it knows the schema), and the Go `scrub` command runs it.
3. `apps/web`:
   - `vercel.json` with the SPA fallback and the `/api` rewrite placeholder;
   - the Preferences digest hint changed to "in the evening".
4. `docs/deploy.md`, a "Deploying on Vercel" section covering:
   - the projects;
   - the credentials table and the GitHub steps;
   - the first release and first admin;
   - the expand/contract rule;
   - rollback and undoing it;
   - the R2 CORS rule with the production web origin;
   - preview data and login;
   - Hobby limits and what changes on Pro.

   Also replace the "run migrations by hand" wording.
5. R2 bucket CORS: once the production web URL exists, add it with PUT and GET. Previews have no uploads, so they need no entry.

## Risks to check early (spikes before the bulk of the work)

1. **Rewrite from the web preview to the protected API preview** (see "Preview protection").
2. **NestJS on Vercel:**
   - `main.ts` uses a top-level `await bootstrap()` with `listen()`; confirm zero-config accepts it, or add an exported handler;
   - the Prisma generated client in the bundle;
   - the bundle size.
3. **`TRUST_PROXY` hop count** through Vercel's edge and the cross-project rewrite.
4. **The scrub on a realistic dataset:** how long the dump and restore take, and that the coverage test catches a newly added column.
5. **Neon Free limits:** 10 branches per project, and compute hours per project.

## Left to the builder

- The exact Go package layout and flag names.
- The PR comment design.
- The placeholder formats in the scrub, within the rules above.
- How the API preview checks the bypass header (the spike decides).
- The table design for the Postgres-backed limits.
