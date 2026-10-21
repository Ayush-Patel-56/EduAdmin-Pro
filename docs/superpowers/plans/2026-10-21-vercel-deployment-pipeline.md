# Vercel Deployment and Go Pipeline Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deploy EduAdmin Pro to Vercel (two projects: web and API). A Go pipeline checks every PR and, on every merge to `main`, migrates the production database, deploys, smoke-tests the live site and rolls back on failure.

**Architecture:**
- A Go module at `tools/pipeline` runs every stage (`check`, `e2e`, `release`, `smoke`, `setup`).
- GitHub Actions only triggers it. PR jobs get no secrets; the release runs in the GitHub `production` environment.
- The API becomes serverless-ready:
  - the digest moves to a Vercel Cron `GET` endpoint;
  - the `setInterval` scheduler is off on Vercel;
  - login, verification and "email me now" limits move to Postgres.

**Tech Stack:**
- Go (standard library only), Vercel CLI (pinned) and Vercel REST API.
- NestJS 12, `@nestjs/throttler` 6.7, Prisma 7.10 (pg adapter), Neon Postgres 17.
- pnpm 10, Node 22, GitHub Actions.

**Spec:** `docs/superpowers/specs/2026-10-20-vercel-deployment-pipeline-design.md` (revision 3). Read it before starting any task.

## Global Constraints

- Node **22** in CI and on Vercel (the API tests crash a vitest worker on Node 20).
- Vercel function region **`sin1`**. Plan **Hobby**: crons at most once a day each, ±59 min.
- Digest crons at **`0 14 * * *`, `0 15 * * *`, `0 16 * * *`** (UTC). The user-facing copy says "in the evening", never "7 PM".
- Production secret names (GitHub environment `production`):
  - `VERCEL_TOKEN`, `VERCEL_ORG_ID`
  - `PROD_DATABASE_URL`, `PROD_DIRECT_URL`
  - `PROD_SMTP_USER`, `PROD_SMTP_PASS`, `PROD_MAIL_FROM`
  - `PROD_R2_ACCOUNT_ID`, `PROD_R2_ACCESS_KEY_ID`, `PROD_R2_SECRET_ACCESS_KEY`, `PROD_R2_BUCKET`
  - `CRON_SECRET`
- Vercel project names: **`eduadmin-api`** (root `apps/api`) and **`eduadmin-web`** (root `apps/web`). Both have Git auto-deploy off. Production env vars are type **`sensitive`**.
- Migrations follow the repo pattern: `BEGIN; SET LOCAL lock_timeout = '10s'; … COMMIT;`, in a folder named `YYYYMMDDHHMMSS_name`.
- **Expand/contract:** a release only adds. The pipeline **warns** (it doesn't fail) on `DROP` or `RENAME` in unapplied migrations.
- The repo is **public**: never print secrets, connection strings, invite codes, emails or school data in CI output.
- Commits carry **no AI attribution** trailers. Push as GitHub user `Ayush-Patel-56`.
- API style: ESM imports with the `.js` suffix, vitest, `npx oxlint --type-aware src/ test/`, and comment density matching the surrounding code.
- Go style: `gofmt`, `go vet`, table-driven tests, `httptest` for HTTP clients, no third-party modules.

## Review Focus

1. **Two cron runs at once:** Vercel can invoke a cron twice. Each digest must still go out once.
2. **A rate-limit window expiring:** the count must restart at 1, not keep growing, and an expired row must not block forever.
3. **Two serverless instances:** two `HybridThrottlerStorage` instances on the same database must share one login count for the same key, and different keys must not share.
4. **First release ever fails smoke:** with no previous production deployment, the pipeline must report "nothing to roll back to" and exit non-zero, not crash.
5. **A secret echoed by a failing command:** the pipeline must mask it in its own output, not rely only on GitHub's `::add-mask::`.

The test pinning each item is in the owning task: item 1 → Task 2; items 2–3 → Task 1; item 4 → Task 6; item 5 → Task 3.

---

## File Structure

**API (`apps/api`)**
- Create `prisma/migrations/20261021090000_rate_limits/migration.sql`: the `RateLimit` table.
- Modify `prisma/schema.prisma`: add `model RateLimit`.
- Create `src/rate-limit/rate-limit.service.ts`: `RateLimitService` (Postgres fixed-window counter, `hit` and `prune`).
- Create `src/rate-limit/hybrid-throttler.storage.ts`: `HybridThrottlerStorage` (memory for `default`, Postgres for `durable`).
- Create `src/rate-limit/rate-limit.module.ts`: global module exporting both.
- Create `src/rate-limit/durable-throttle.ts`: the `DURABLE` throttler options constant.
- Create `src/rate-limit/rate-limit.spec.ts`.
- Create `test/rate-limit.e2e-spec.ts`.
- Modify `src/app.module.ts`: `ThrottlerModule.forRootAsync` with the two throttlers and the hybrid storage.
- Modify `src/auth/auth.controller.ts`: durable limits on signup, login, verify-email and resend-verification.
- Modify `src/notifications/digest.service.ts`: `sendNow` uses `RateLimitService` and not the in-memory map.
- Modify `src/notifications/digest.scheduler.ts`: `runDue()`; off on Vercel.
- Create `src/notifications/cron.controller.ts`: `GET /api/internal/cron/digest`.
- Modify `src/notifications/notifications.module.ts`: register the controller.
- Modify `src/app.controller.ts`: `GET /api/health/ip`.
- Create `vercel.json` in `apps/api`: region and crons.

**Web (`apps/web`)**
- Create `vercel.json`: SPA fallback and the `/api` rewrite placeholder.
- Modify `src/features/portal/PreferencesDialog.tsx`: digest hint wording.

**Pipeline (`tools/pipeline`)**
- `go.mod`, `main.go` (command dispatch).
- `internal/run/`: command runner with masking and stage headings.
- `internal/stages/`: `check.go`, `e2e.go`, `release.go`, `migrations.go`.
- `internal/vercel/`: REST client, project setup, env sync, rollback, and `rewrite.go`.
- `internal/smoke/`: smoke checks.

**CI and docs**
- Create `.github/workflows/pr.yml`, `release.yml`, `setup.yml` and `.github/dependabot.yml`. Delete `.github/workflows/ci.yml`.
- Modify `docs/deploy.md`.

---

### Task 1: Durable rate limits in Postgres

**Files:**
- Create: `apps/api/prisma/migrations/20261021090000_rate_limits/migration.sql`
- Modify: `apps/api/prisma/schema.prisma`
- Create: the `src/rate-limit/` files listed above
- Modify: `apps/api/src/app.module.ts:33`, `apps/api/src/auth/auth.controller.ts` (`STRICT` at :29 and the handlers at :39–:111), `apps/api/src/notifications/digest.service.ts` (`sentNow` :39, `sendNow` :159–:171)
- Test: `apps/api/src/rate-limit/rate-limit.spec.ts`, `apps/api/test/rate-limit.e2e-spec.ts`, and the existing `notifications.spec.ts` (send-now tests)

**Interfaces:**
- Produces:
  - `RateLimitService.hit(key: string, ttlMs: number, limit: number, now?: Date): Promise<{ hits: number; allowed: boolean; resetAt: Date }>`
  - `RateLimitService.prune(now?: Date): Promise<number>` (rows deleted)
  - `class HybridThrottlerStorage implements ThrottlerStorage`
  - `export const DURABLE = 'durable'`
  - `export const durableThrottle(limit: number, ttlMs: number)`: returns the argument for `@Throttle(...)`, `{ [DURABLE]: { limit, ttl: ttlMs } }`.

- [ ] **Step 1: Add the schema and migration**

The schema:

```prisma
// Request counts for limits that must hold across API instances (login,
// verification codes, "email me now"); a fixed window per key.
model RateLimit {
  key       String   @id
  hits      Int
  resetAt   DateTime @db.Timestamptz(3)
}
```

The migration:
- creates `"RateLimit"`, with `CHECK ("hits" >= 1)`;
- creates an index on `"resetAt"` for prune;
- uses the BEGIN / lock_timeout / COMMIT pattern.

Verify on a scratch database (`node <scratchpad>/scratchdb.cjs create scratch_rl`, then `migrate deploy`, then `migrate diff … --exit-code`), and only then on dev.

- [ ] **Step 2: Write the failing e2e test `test/rate-limit.e2e-spec.ts`**

```ts
it('counts within a window, refuses past the limit, and starts again at 1 after it', async () => {
  const key = `test:${randomUUID()}`; const t0 = new Date('2099-01-01T00:00:00Z');
  expect((await rl.hit(key, 60_000, 2, t0)).hits).toBe(1);
  expect(await rl.hit(key, 60_000, 2, new Date(t0.getTime() + 1_000))).toMatchObject({ hits: 2, allowed: true });
  expect(await rl.hit(key, 60_000, 2, new Date(t0.getTime() + 2_000))).toMatchObject({ hits: 3, allowed: false });
  expect(await rl.hit(key, 60_000, 2, new Date(t0.getTime() + 61_000))).toMatchObject({ hits: 1, allowed: true });
});
it('two storages on one database share a key, and keys never mix', async () => {
  const a = new HybridThrottlerStorage(rl), b = new HybridThrottlerStorage(rl);
  const k = `login:${randomUUID()}`;
  await a.increment(k, 60_000, 10, 60_000, DURABLE); const r = await b.increment(k, 60_000, 10, 60_000, DURABLE);
  expect(r.totalHits).toBe(2);
  expect((await b.increment(`login:${randomUUID()}`, 60_000, 10, 60_000, DURABLE)).totalHits).toBe(1);
});
it('20 concurrent hits on one key count to exactly 20', async () => { /* Promise.all of 20 hit() calls; max hits === 20, distinct hits values 1..20 */ });
it('prune deletes only expired rows', async () => { /* one expired, one live; prune(now) === 1 (filter to this test's keys) */ });
```

Clean up this test's keys in `afterAll`.

- [ ] **Step 3: Run it and check it fails**

Run `cd apps/api && DATABASE_URL=$DIRECT_URL npx vitest run --config vitest.config.e2e.ts test/rate-limit.e2e-spec.ts`. Expected: FAIL, because the module isn't found.

- [ ] **Step 4: Implement `RateLimitService.hit` as one atomic SQL statement**

```sql
INSERT INTO "RateLimit" ("key","hits","resetAt") VALUES ($key, 1, $now + $ttl)
ON CONFLICT ("key") DO UPDATE SET
  "hits"    = CASE WHEN "RateLimit"."resetAt" <= $now THEN 1 ELSE "RateLimit"."hits" + 1 END,
  "resetAt" = CASE WHEN "RateLimit"."resetAt" <= $now THEN $now + $ttl ELSE "RateLimit"."resetAt" END
RETURNING "hits", "resetAt"
```

Implement `prune` as `deleteMany({ where: { resetAt: { lte: now } } })`.

- [ ] **Step 5: Implement `HybridThrottlerStorage`**

- For `throttlerName === DURABLE`, it calls `hit(key, ttl, limit)` and maps the result to `ThrottlerStorageRecord`:
  - `totalHits`;
  - `timeToExpire` in **seconds**, rounded up;
  - `isBlocked = hits > limit`;
  - `timeToBlockExpire = timeToExpire`.
- Every other name delegates to an internal `ThrottlerStorageService` (memory).

- [ ] **Step 6: Run the e2e test and check it passes**

Same command as Step 3. Expected: PASS (4 tests).

- [ ] **Step 7: Wire the throttlers**

- In `app.module.ts`, `ThrottlerModule.forRootAsync` gets `throttlers` with:
  - `{ name: 'default', ttl: 60_000, limit: 120 }`;
  - `{ name: DURABLE, ttl: 60_000, limit: 10, skipIf: (ctx) => !reflector.getAllAndOverride(…durable limit metadata…) }`. The durable throttler only runs on routes that set a durable limit.
- It also gets `storage: HybridThrottlerStorage`. Import `RateLimitModule`.
- In `auth.controller.ts`, add `durableThrottle(10, 60_000)` alongside `STRICT` on:
  - signup/teacher, signup/admin, login, verify-email;
  - resend-verification, with `durableThrottle(3, 60_000)`.

  Keep the existing `default` overrides.

- [ ] **Step 8: Unit test the routing in `rate-limit.spec.ts`**

- `it('a route without a durable limit never touches Postgres')`: a fake `RateLimitService` whose `hit` throws. Increment with name `'default'` 3 times; expect totals 1, 2, 3.
- `it('maps a durable count to a blocked record past the limit')`: a fake `hit` returning `{ hits: 11, allowed: false, resetAt: now + 30s }`. Expect `{ totalHits: 11, isBlocked: true, timeToExpire: 30 }`.

Run `npx vitest run src/rate-limit`. Expected: PASS.

- [ ] **Step 9: Move `sendNow` onto `RateLimitService`**

- Inject `RateLimitService` into `DigestService`. Delete the `sentNow` map.
- Call `rateLimit.hit(\`send-now:${userId}\`, 3_600_000, SEND_NOW_PER_HOUR)` **after** the verified and digest checks and **before** `mail.send`. Throw the existing 429 message when `!allowed`.
- Update the `notifications.spec.ts` send-now tests:
  - `it('the 4th send in an hour is refused, counted in the database, per account')`: the fake `hit` returns `allowed: false` the 4th time; expect `HttpException` 429, and `hit` called with `('send-now:u1', 3_600_000, 3)`.

Run `npx vitest run src/notifications`. Expected: PASS.

- [ ] **Step 10: Run the full API checks**

Run `cd apps/api && npx tsc --noEmit -p tsconfig.json && npx vitest run && DATABASE_URL=$DIRECT_URL npx vitest run --config vitest.config.e2e.ts && npx oxlint --type-aware src/ test/`. Expected: all pass, 0 warnings.

- [ ] **Step 11: Commit**

```bash
git add apps/api/prisma apps/api/src/rate-limit apps/api/src/app.module.ts apps/api/src/auth/auth.controller.ts apps/api/src/notifications apps/api/test/rate-limit.e2e-spec.ts
git commit -m "API: login, verification and send-now limits in Postgres, so they hold across serverless instances"
```

---

### Task 2: Digest on Vercel Cron, scheduler off on Vercel, client-IP check endpoint

**Files:**
- Modify: `apps/api/src/notifications/digest.scheduler.ts` (constructor :24–:32, `onModuleInit` :34, `tick` :49–:60)
- Create: `apps/api/src/notifications/cron.controller.ts`
- Modify: `apps/api/src/notifications/notifications.module.ts`
- Modify: `apps/api/src/app.controller.ts`
- Create: `apps/api/vercel.json`
- Test: `apps/api/src/notifications/cron.spec.ts`, `apps/api/test/account.e2e-spec.ts` (add one test)

**Interfaces:**
- Consumes: `RateLimitService.prune(now)` (Task 1).
- Produces:
  - `DigestScheduler.runDue(now?: Date): Promise<{ due: boolean; sent: number; pruned: number }>`;
  - the `GET /api/internal/cron/digest` route (401 / 200 `{ due, sent, pruned }`);
  - the `GET /api/health/ip` route (200 `{ ip: string }`).

- [ ] **Step 1: Write the failing unit tests in `cron.spec.ts`**

```ts
it('401 without the right bearer, and 401 when CRON_SECRET is unset (constant-time compare)', async () => {
  const run = vi.fn();
  const ctl = (secret?: string) => new CronController({ get: () => secret } as never, { runDue: run } as never);
  await expect(ctl('s3cret').digest('Bearer nope')).rejects.toBeInstanceOf(UnauthorizedException);
  await expect(ctl(undefined).digest('Bearer ')).rejects.toBeInstanceOf(UnauthorizedException);
  await expect(ctl('s3cret').digest(undefined)).rejects.toBeInstanceOf(UnauthorizedException);
  expect(run).not.toHaveBeenCalled();
});
it('with the secret, runs the due work once and returns its counts', async () => { /* runDue resolves {due:true,sent:2,pruned:5}; digest('Bearer s3cret') resolves that */ });
it('the interval scheduler never starts on Vercel', () => { /* process.env.VERCEL='1'; onModuleInit(); expect no timer (spy setInterval not called) */ });
it('runDue before the digest hour does nothing; after, sends, prunes notifications and rate limits', async () => { /* 13:00Z (18:30 IST) → {due:false}; 14:00Z → sendDue, notifications.prune, rateLimit.prune each called once */ });
```

- [ ] **Step 2: Run them and check they fail**

Run `npx vitest run src/notifications/cron.spec.ts`. Expected: FAIL.

- [ ] **Step 3: Implement**

- `DigestScheduler.runDue(now)` holds the body of `tick` minus the error swallowing. It adds `rateLimit.prune(now)` to `pruned`.
- `tick` calls `runDue` inside its try/catch and keeps the `running` flag.
- The constructor's `enabled` is also false when `process.env.VERCEL === '1'`.
- `CronController`: `@Controller('internal/cron')`, `@Get('digest')`, `@SkipThrottle()`, reading `@Headers('authorization')`.
  - Compare `sha256('Bearer ' + secret)` with `sha256(header ?? '')` using `timingSafeEqual`.
  - Throw `UnauthorizedException` when the secret is empty or the digests differ.
  - No `SessionGuard`.

- [ ] **Step 4: Add the client-IP endpoint**

In `AppController`, add `@Get('ip') ip(@Req() req: Request) { return { ip: req.ip }; }` with the default throttle. Unit test it: `it('echoes the address Express resolved, nothing else')` asserts the response has the single key `ip`.

- [ ] **Step 5: Run the unit tests and check they pass**

Run `npx vitest run src/notifications src/app`. Expected: PASS.

- [ ] **Step 6: Add the Review Focus 1 e2e test in `test/account.e2e-spec.ts`**

`it('two cron runs at once send each digest once')`:
- Turn the admin's digest on.
- Run two `scheduler.runDue(digestNow)` with `Promise.all` (real `DigestService`, mock mail).
- Expect `sentTo()` length 1.
- Reset `emailNotifications` to false.

Run the account e2e. Expected: PASS.

- [ ] **Step 7: Create `apps/api/vercel.json`**

```json
{
  "$schema": "https://openapi.vercel.sh/vercel.json",
  "regions": ["sin1"],
  "git": { "deploymentEnabled": false },
  "crons": [
    { "path": "/api/internal/cron/digest", "schedule": "0 14 * * *" },
    { "path": "/api/internal/cron/digest", "schedule": "0 15 * * *" },
    { "path": "/api/internal/cron/digest", "schedule": "0 16 * * *" }
  ]
}
```

- [ ] **Step 8: Run the full API checks (as in Task 1 Step 10), then commit**

```bash
git add apps/api/src apps/api/test apps/api/vercel.json
git commit -m "API: digest via Vercel Cron (GET, bearer secret), scheduler off on Vercel, client-IP check"
```

---

### Task 3: Go pipeline core with `check` and `e2e`

**Files:**
- Create: `tools/pipeline/go.mod` (`module github.com/Ayush-Patel-56/EduAdmin-Pro/tools/pipeline`, `go 1.24`), `tools/pipeline/main.go`
- Create: `tools/pipeline/internal/run/run.go` and `run_test.go`
- Create: `tools/pipeline/internal/stages/check.go`, `e2e.go` and `stages_test.go`

**Interfaces:**
- Produces:
  - `run.New(repoRoot string, out io.Writer) *Runner`
  - `(*Runner).Mask(values ...string)`
  - `(*Runner).Stage(name string)`: prints `==> name` (plus `::group::` when `GITHUB_ACTIONS=true`)
  - `(*Runner).Cmd(ctx, dir string, env []string, name string, args ...string) error`: streams the output, masked
  - `(*Runner).Output(ctx, dir, env, name, args...) (string, error)`
  - `run.MaskFromEnv(environ []string) []string`: values of keys matching `*_TOKEN`, `*_KEY`, `*_SECRET`, `*_PASS`, `PROD_*`, and any value starting with `postgres://` / `postgresql://`
  - `stages.Check(ctx, r *run.Runner) error`
  - `stages.E2E(ctx, r *run.Runner, databaseURL string) error`
  - Command dispatch: `pipeline <check|e2e|release|smoke|setup> [flags]`; exit code 1 on error, with the message `pipeline: <stage>: <err>`.

- [ ] **Step 1: Write the failing tests in `run_test.go`**

```go
func TestMaskFromEnv(t *testing.T) { /* {"PROD_SMTP_PASS=abc","VERCEL_TOKEN=tok","HOME=/h","X=postgresql://u:p@h/db"} → contains abc, tok, the postgres URL; not /h */ }
func TestCmdMasksSecretsInChildOutput(t *testing.T) {
  var buf bytes.Buffer; r := run.New(t.TempDir(), &buf); r.Mask("s3cret-value")
  _ = r.Cmd(context.Background(), "", nil, "go", "env", "-json") // any command; use a helper process that prints s3cret-value
  if strings.Contains(buf.String(), "s3cret-value") { t.Fatal("secret leaked") }
  if !strings.Contains(buf.String(), "***") { t.Fatal("mask marker missing") }
}
func TestCmdReturnsErrorWithExitCode(t *testing.T) { /* helper process exits 3 → error mentions exit status 3 */ }
```

Use the standard `TestHelperProcess` pattern (`os.Args[0] -test.run=TestHelperProcess`) to print a given string and exit with a given code.

- [ ] **Step 2: Run them and check they fail**

Run `cd tools/pipeline && go test ./...`. Expected: FAIL (undefined: run.New).

- [ ] **Step 3: Implement `internal/run`**

Masking replaces every registered value (longest first) with `***`, line by line, before writing to `out`. `Mask` also prints `::add-mask::<value>` when `GITHUB_ACTIONS=true`. The `::add-mask::` line itself is not passed through masking.

- [ ] **Step 4: Run the tests and check they pass**

Run `go test ./internal/run/`. Expected: PASS.

- [ ] **Step 5: Write the failing stage tests in `stages_test.go`**

- `TestE2ERefusesNonLocalDatabase`: `E2E(ctx, r, "postgresql://u:p@ep-x.neon.tech/db")` returns an error containing "throwaway"; `localhost` and `127.0.0.1` are allowed (use a runner whose commands are recorded, not executed, via a `Runner.Exec` hook).
- `TestCheckRunsEverySuite`: the recorded commands, in order, equal:
  1. `pnpm --filter api exec tsc --noEmit`
  2. `pnpm --filter web exec tsc -b`
  3. `pnpm lint`
  4. `pnpm --filter api test`
  5. `pnpm --filter web test` (×3, with `TZ=Asia/Kolkata`, `TZ=America/Los_Angeles`, `TZ=Pacific/Kiritimati`)
  6. `pnpm build`
  7. `go vet ./...`, `gofmt -l .` (fails if the output isn't empty), `go test ./...` (in `tools/pipeline`)

- [ ] **Step 6: Implement `Check` and `E2E`**

`E2E` sets `DATABASE_URL` and `DIRECT_URL` and then runs:
1. `pnpm --filter api exec prisma migrate deploy`
2. `pnpm --filter api test:e2e`
3. `pnpm --filter api exec prisma migrate diff --from-config-datasource --to-schema prisma/schema.prisma --exit-code` (check the flag names against Prisma 7.10's `migrate diff --help`, and adjust only the flags if they differ).

Add `Runner.Exec func(cmd *exec.Cmd) error` (default: run it) so tests can record commands.

- [ ] **Step 7: Implement `main.go` dispatch for `check` and `e2e`**

`e2e` reads `DATABASE_URL`. The repo root comes from `git rev-parse --show-toplevel`. Then run `go test ./... && go vet ./...`. Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add tools/pipeline
git commit -m "Pipeline: Go runner with secret masking; check and e2e stages"
```

---

### Task 4: Vercel client, project setup and env sync

**Files:**
- Create: `tools/pipeline/internal/vercel/client.go`, `projects.go`, `env.go`, `rewrite.go` and `vercel_test.go`
- Modify: `tools/pipeline/main.go` (the `setup` command)
- Create: `apps/web/vercel.json`

**Interfaces:**
- Produces:
  - `vercel.NewClient(token, teamID string, base string) *Client`; `base` defaults to `https://api.vercel.com` and is overridden in tests.
  - `type ProjectSpec struct { Name, RootDirectory, Framework string }`; `vercel.APISpec`, `vercel.WebSpec`.
  - `(*Client).EnsureProject(ctx, ProjectSpec) (Project, error)`, where `Project{ID, Name string}`. It creates via `POST /v11/projects` if `GET /v9/projects/{name}` is 404, then `PATCH`es `rootDirectory`, `framework`, `nodeVersion: "22.x"`.
  - `(*Client).ProductionOrigin(ctx, projectID) (string, error)`: `https://` plus the project's `*.vercel.app` production domain from `GET /v9/projects/{id}/domains`.
  - `(*Client).SyncEnv(ctx, projectID string, vars map[string]string) error`: `POST /v10/projects/{id}/env?upsert=true`, `type: "sensitive"`, `target: ["production"]`, one call per key, never logging values.
  - `vercel.WriteRewrite(webDir, apiOrigin string) error`: replaces `__API_ORIGIN__` in `webDir/vercel.json`, trimming a trailing `/` from `apiOrigin`.
  - `vercel.APIEnv(getenv func(string) string, webOrigin string) (map[string]string, error)`: builds the API's production env (the spec's "Environment" table) and errors listing every missing secret.

- [ ] **Step 1: Create `apps/web/vercel.json`**

```json
{
  "$schema": "https://openapi.vercel.sh/vercel.json",
  "git": { "deploymentEnabled": false },
  "rewrites": [
    { "source": "/api/:path*", "destination": "__API_ORIGIN__/api/:path*" },
    { "source": "/((?!api/|assets/).*)", "destination": "/index.html" }
  ]
}
```

- [ ] **Step 2: Write the failing tests in `vercel_test.go`**

- `TestEnsureProjectCreatesThenPatches`: an `httptest` server returns 404 for GET and 200 for POST and PATCH. Assert:
  - the request bodies carry `rootDirectory: "apps/api"`, `framework: "nestjs"`, `nodeVersion: "22.x"`;
  - every request has `Authorization: Bearer tok` and `teamId=team_x`.
- `TestSyncEnvSendsSensitiveProductionOnly`: every POST body has `type: "sensitive"` and `target: ["production"]`, with `upsert=true` in the query.
- `TestAPIEnvListsMissingSecrets`: with only `PROD_DATABASE_URL` set, the error mentions `PROD_DIRECT_URL`, `PROD_SMTP_PASS`, `CRON_SECRET` (all missing ones).
- `TestAPIEnvValues`:
  - `NODE_ENV=production`, `REQUIRE_EMAIL_VERIFICATION=true`, `SMTP_HOST=smtp.gmail.com`, `SMTP_PORT=465`;
  - `DIGEST_ENABLED=true`, `DIGEST_HOUR_IST=19`;
  - `WEB_ORIGIN` equals the argument, and `TRUST_PROXY` equals env `TRUST_PROXY` (default `1`).
- `TestWriteRewriteTrimsSlash`: origin `https://eduadmin-api.vercel.app/` gives the destination `https://eduadmin-api.vercel.app/api/:path*` (no `//api`).

- [ ] **Step 3: Run them and check they fail, then implement, then check they pass**

Run `go test ./internal/vercel/`: FAIL first, then PASS after implementing. If a Vercel REST endpoint version or field name differs from the above, follow Vercel's REST API reference and update the test to match.

- [ ] **Step 4: Implement the `setup` command**

It reads `VERCEL_TOKEN` and `VERCEL_ORG_ID`, masks secrets, runs `EnsureProject(APISpec)` and `EnsureProject(WebSpec)`, gets the web production origin, builds `APIEnv`, then runs `SyncEnv` on the API project. It prints only project names and origins.

- [ ] **Step 5: Commit**

```bash
git add tools/pipeline apps/web/vercel.json
git commit -m "Pipeline: Vercel projects, sensitive env sync, web rewrite"
```

---

### Task 5: Smoke tests

**Files:**
- Create: `tools/pipeline/internal/smoke/smoke.go` and `smoke_test.go`
- Modify: `tools/pipeline/main.go` (the `smoke --web URL --api URL` command)

**Interfaces:**
- Produces:
  - `smoke.Run(ctx, client *http.Client, webOrigin, apiOrigin string) []smoke.Result`, where `Result{Name string; Err error}`
  - `smoke.Failed(results) bool`

- [ ] **Step 1: Write the failing tests against an `httptest` server that imitates the live site**

There's one test per check, plus one where each check is broken in turn and expected to fail:

- `web shell`: `/` and `/dashboard` return 200 HTML containing `<div id="root">`. Every `/assets/*.js` and `/assets/*.css` referenced in it returns 200.
- `api ready`: `GET {web}/api/health/ready` returns 200 with `{"database":"up"}`.
- `auth refuses`: `GET {web}/api/auth/me` returns 401.
- `security headers`: `/api/health` has `x-content-type-options: nosniff` and a `content-security-policy` header.
- `cors`: with `Origin: https://evil.example`, the response has no `access-control-allow-origin: https://evil.example`.
- `client ip`: `GET {web}/api/health/ip` with `X-Forwarded-For: 203.0.113.7`:
  - the returned ip must not be `203.0.113.7`;
  - it must not be loopback, private or empty (`netip.Addr.IsPrivate/IsLoopback`);
  - two calls must return the same value.
- `cron locked`: `GET {api}/api/internal/cron/digest` with no header returns 401.

- [ ] **Step 2: Run, implement, run again**

Run `go test ./internal/smoke/`: FAIL first, then PASS. Use a 15 s timeout per request and 3 attempts with a 5 s wait between them (a fresh deployment can take a moment to answer). Use no cookies.

- [ ] **Step 3: Commit**

```bash
git add tools/pipeline
git commit -m "Pipeline: read-only smoke tests for the live site"
```

---

### Task 6: `release` command

**Files:**
- Create: `tools/pipeline/internal/stages/release.go`, `migrations.go` and `release_test.go`
- Create: `tools/pipeline/internal/vercel/deploy.go` (CLI deploy, list deployments, rollback state, rollback)
- Modify: `tools/pipeline/main.go`

**Interfaces:**
- Consumes: `run.Runner` (Task 3); `vercel.Client`, `EnsureProject`, `ProductionOrigin`, `SyncEnv`, `APIEnv`, `WriteRewrite` (Task 4); `smoke.Run` and `smoke.Failed` (Task 5).
- Produces:
  - `stages.RiskyStatements(sql string) []string`: lines matching `DROP TABLE|DROP COLUMN|ALTER TABLE … RENAME|DROP TYPE`, case-insensitive, ignoring `--` comments and `DROP CONSTRAINT|DROP INDEX|DROP DEFAULT|DROP NOT NULL`.
  - `(*Client).RolledBack(ctx, projectID) (bool, error)`: from the project's rollback field (confirm the field name in Vercel's "Get a project" response; it's the one set by Instant Rollback).
  - `(*Client).PreviousProduction(ctx, projectID) (deploymentID string, ok bool, err error)`: the current READY production deployment, recorded before deploying.
  - `(*Client).Rollback(ctx, projectID, deploymentID string) error`.
  - `vercel.Deploy(ctx, r *run.Runner, projectID, orgID, token string) (url string, err error)`: runs `pnpm dlx vercel@<pinned> pull --yes --environment=production`, `build --prod`, `deploy --prebuilt --prod` from the repo root, with `VERCEL_PROJECT_ID`, `VERCEL_ORG_ID` and `VERCEL_TOKEN` in the env (never on the command line).
  - `stages.Release(ctx, r, deps ReleaseDeps) error`. `ReleaseDeps` is an interface wrapping the calls above, so tests use fakes.

- [ ] **Step 1: Write the failing tests in `release_test.go`**

- `TestRiskyStatements`:
  - `DROP COLUMN "x"` and `ALTER TABLE "A" RENAME TO "B"` are flagged;
  - `DROP CONSTRAINT`, `DROP NOT NULL`, `DROP DEFAULT` and a commented `-- DROP TABLE` are not.
- `TestReleaseOrder`: with fakes that all succeed, the recorded steps are:
  1. ensure api
  2. ensure web
  3. rolledBack api, web
  4. previous api, web
  5. warn on risky migrations
  6. migrate
  7. sync env
  8. deploy api
  9. write rewrite
  10. deploy web
  11. smoke
- `TestReleaseStopsWhenRolledBack`: `RolledBack(web)=true` gives an error containing "Undo Rollback" and "vercel promote"; no migrate and no deploy happen.
- `TestReleaseMigrationFailureDeploysNothing`: migrate fails with output containing `lock timeout`. The error contains `migrate resolve --rolled-back`, and there are no deploy calls.
- `TestSmokeFailureRollsBackBoth`: smoke fails, so `Rollback(api, prevAPI)` and `Rollback(web, prevWeb)` are called, and the error says both are rolled back and how to undo it.
- `TestWebDeployFailureRollsBackAPI`: only the API is rolled back.
- `TestFirstReleaseSmokeFailure` (**Review Focus 4**): there's no previous deployment (`ok=false`), and smoke fails. There are no `Rollback` calls, and the error contains "no earlier production deployment to roll back to". No panic.

- [ ] **Step 2: Run them and check they fail**

Run `go test ./internal/stages/`. Expected: FAIL.

- [ ] **Step 3: Implement `Release`**

Follow the order in Step 1. Specifics:
- The unapplied migrations come from `prisma migrate status` output; feed the SQL files they name to `RiskyStatements` and print `::warning::` lines.
- Migrate runs with `DIRECT_URL=$PROD_DIRECT_URL` and `DATABASE_URL=$PROD_DATABASE_URL`.
- Smoke runs with the web origin from `ProductionOrigin(web)` and the API origin from `ProductionOrigin(api)`.

Add the `release` command in `main.go`:
- mask everything from `MaskFromEnv(os.Environ())` first;
- refuse to start unless `GITHUB_REF` is `refs/heads/main` or `--allow-local` is passed (so a release can't be started from a branch by mistake).

- [ ] **Step 4: Run the tests and check they pass, then commit**

Run `go test ./... && go vet ./... && test -z "$(gofmt -l .)"`. Expected: PASS.

```bash
git add tools/pipeline
git commit -m "Pipeline: release (rollback check, additive-migration warning, migrate, deploy, smoke, rollback)"
```

---

### Task 7: GitHub workflows, Dependabot, copy and docs

**Files:**
- Create: `.github/workflows/pr.yml`, `.github/workflows/release.yml`, `.github/workflows/setup.yml`, `.github/dependabot.yml`
- Delete: `.github/workflows/ci.yml`
- Modify: `apps/web/src/features/portal/PreferencesDialog.tsx:79`, `docs/deploy.md`

- [ ] **Step 1: Write `pr.yml`**

- Trigger: `on: pull_request`, plus `push` to branches other than `main` is **not** needed.
- `concurrency: pr-${{ github.ref }}` with cancel-in-progress.
- `permissions: contents: read`. No secrets.
- Job `check`, steps:
  1. checkout
  2. `pnpm/action-setup`
  3. `actions/setup-node` (22, pnpm cache)
  4. `actions/setup-go` (`go-version-file: tools/pipeline/go.mod`)
  5. `pnpm install --frozen-lockfile`
  6. `go -C tools/pipeline run . check`
- Job `e2e`: the same setup plus a `postgres:17` service (as in the current `ci.yml`), env `DATABASE_URL`/`DIRECT_URL=postgresql://postgres:postgres@localhost:5432/eduadmin`, then `go -C tools/pipeline run . e2e`.
- **Pin every third-party action to a full commit SHA**, with the version as a trailing comment. Look up the current release SHAs with `gh api repos/<owner>/<action>/git/ref/tags/<tag>`.

- [ ] **Step 2: Write `release.yml`**

- Trigger: `on: push: branches: [main]`.
- `concurrency: { group: release-production, cancel-in-progress: false }`.
- Jobs `check` and `e2e` (as in `pr.yml`), then job `release`:
  - `needs: [check, e2e]`, `environment: production`, `timeout-minutes: 30`;
  - env: every Global Constraints secret from `${{ secrets.* }}`;
  - steps: the same setup, then `go -C tools/pipeline run . release`.

- [ ] **Step 3: Write `setup.yml` and `dependabot.yml`, and delete `ci.yml`**

- `setup.yml`: `workflow_dispatch`, `environment: production`, runs `go -C tools/pipeline run . setup`.
- `dependabot.yml`: weekly updates for `github-actions` (`/`), `gomod` (`/tools/pipeline`) and `npm` (`/`).

Check that the workflows parse by running `gh workflow list`. After pushing the branch, the PR's own `check` and `e2e` must go green.

- [ ] **Step 4: Change the copy**

In `PreferencesDialog.tsx:79`:
- the verified text becomes `'Daily report digest by email, in the evening (India time). Off until you turn it on.'`;
- the unverified text becomes `'Daily report digest by email, in the evening (India time). Verify your email address to receive it.'`.

Run `cd apps/web && npx tsc -b && npx vitest run`. Expected: PASS (update any test asserting the old copy).

- [ ] **Step 5: Update `docs/deploy.md`**

- Replace "Run migrations with `pnpm --filter api exec prisma migrate deploy` …" in **Order** with "The release pipeline runs migrations (see Deploying on Vercel)".
- In **Account settings**, change "From `DIGEST_HOUR_IST` (default 19…)" to the cron window ("between about 19:30 and 22:30 IST on Vercel Hobby").
- Add **Deploying on Vercel** with these subsections:
  - Projects
  - GitHub `production` environment and secrets (step by step, including deleting `NEON_API_KEY` / `NEON_PROJECT_ID` and revoking that key in Neon)
  - What a PR runs, and what a merge runs
  - Expand/contract rule
  - Rollback and undoing it ("Undo Rollback" button, or `vercel promote <deployment>`)
  - First admin (the local `invite:create` command from the spec)
  - R2 CORS with the production web origin
  - `TRUST_PROXY` (how the smoke test checks it)
  - Hobby limits and what changes on Pro (the spec's table)

- [ ] **Step 6: Run everything, then commit**

```bash
cd tools/pipeline && go run . check
git add .github apps/web/src docs/deploy.md
git commit -m "CI: PR checks and production release through the Go pipeline; docs for deploying on Vercel"
```

---

### Task 8: Go live (with Ayush, in order)

Interactive. Ayush does the GitHub and Vercel clicks; the agent drives the rest. Don't merge before steps 1–3 are done.

- [ ] **Step 1: Ayush creates the GitHub Environment `production`**

Settings → Environments → New environment → `production`. Under "Deployment branches", choose **Selected branches**, then `main`.

- [ ] **Step 2: Ayush moves the secrets**

- Add each Global Constraints secret to `production`, re-entering the values from the original sources: Vercel, Neon, Gmail, R2 and `CRON_SECRET`.
- Delete the repository-level copies, plus `NEON_API_KEY` and `NEON_PROJECT_ID`.
- Revoke that Neon API key in the Neon console.

- [ ] **Step 3: Open the PR and get the checks green**

Push the `deploy-pipeline` branch and open the PR. `check` and `e2e` must pass, and Kayd-06 reviews it.

- [ ] **Step 4: Merge, then watch the first release**

On failure:
- **Bundle or zero-config problem** (spec Risk 1, e.g. the top-level `await bootstrap()`): add an exported handler entry and fix forward in a follow-up PR. There's nothing live to break yet.
- **`client ip` smoke check fails:** read `/api/health/ip` through the web origin, set `TRUST_PROXY` to the hop count that yields the real client IP, re-run `setup.yml`, then re-run the release.

- [ ] **Step 5: Add the R2 CORS rule**

Bucket → Settings → CORS policy:

```json
[{ "AllowedOrigins": ["https://<web production origin>"], "AllowedMethods": ["PUT", "GET"], "AllowedHeaders": ["Content-Type"], "MaxAgeSeconds": 3600 }]
```

- [ ] **Step 6: Ayush creates the first admin invite**

Ayush runs this locally, with `DIRECT_URL` set to the production direct URL in his own shell, then signs up on the live site:

```bash
pnpm --filter api invite:create -- "Ayush" --max-uses 1 --days 1
```

- [ ] **Step 7: Recommended: branch protection on `main`**

Ayush requires the `check` and `e2e` status checks before merging.
