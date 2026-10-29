# Student Feedback Links Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** An admin shares a per-batch link. A student opens it with no login, picks their name and a teacher, and gives a rating and comment. The feedback appears in the admin Feedback section (with the student's name) and in the teacher's portal (without it).

**Architecture:**
- New `FeedbackLink` table, plus a new `STUDENT_TO_TEACHER` direction and student/batch fields on `Feedback`, via an additive migration.
- Admin link routes live on the existing admin feedback controller. A new unauthenticated `public/feedback/:token` controller serves the form and takes submissions.
- The 15-minute per-student cool-down is enforced in one transaction that locks the student's row.
- Web gets three pieces:
  - a links dialog and a Student → Teacher tab on the admin Feedback page;
  - a public `/feedback/:token` page;
  - a "From students" section on the teacher Feedback page.

**Tech Stack:** NestJS 12, Prisma 7.10 (pg adapter) on Neon Postgres 17, React 19 + Vite + TanStack Query + Tailwind 4, vitest.

**Spec:** `docs/superpowers/specs/2026-10-30-student-feedback-links-design.md`. Read it first; it is binding.

## Global Constraints

- Every new row is school-scoped:
  - composite FKs `(x, schoolId)` → `X(id, schoolId)`, as in the existing schema;
  - `ON DELETE SET NULL ("col")` for Feedback's optional links, `CASCADE` for `FeedbackLink.batch` and `FeedbackLink.school`;
  - timestamps are `@db.Timestamptz(3)`.
- Migration pattern: `BEGIN; SET LOCAL lock_timeout = '10s'; … COMMIT;`, folder `20261030090000_student_feedback_links`.
  - Verify on a scratch DB first (`node <scratchpad>/scratchdb.cjs create scratch_sfl`, then `migrate deploy`, then `migrate diff --from-config-datasource --to-schema prisma/schema.prisma --exit-code`), then apply to dev.
  - Additive only (expand/contract).
- Cool-down: **15 minutes** per student.
- Link URLs are built by the web from `window.location.origin` (`/feedback/<token>`); the API returns only `token` (the spec's `url` field is dropped so the API never guesses the site's address).
- Cool-down message: `You can send feedback again in N minutes` (`1 minute` when N = 1).
- Comment: trimmed, whitespace collapsed, **10–1,000** characters. Rating: integer **1–5**.
- Public endpoints: `Cache-Control: no-store`; `durableThrottle(120, 60_000)` plus default `{ limit: 120, ttl: 60_000 }`.
- **Public GET returns only:**
  - `schoolName`, `batchName`, `cooldownMinutes`;
  - students `{ id, name }` (ACTIVE, `Student.batchId` = the link's batch);
  - teachers `{ id, name, subjects }` (`FacultyBatch` for the batch, status not INACTIVE).
- Unknown token, inactive link or deleted batch → **404**, body message `This feedback link isn't active`.
- Teachers never receive `studentId`, `studentName` or `senderName` for student feedback. Select only `id, rating, content, batchName, feedbackDate, createdAt, status`. Dismissed entries are hidden; an inactive teacher gets none.
- Copy: direction label **`Student -> Teacher`** in the API and **`Student → Teacher`** in the web, matching the existing label styles. Thank-you text: `Thanks! You can send more feedback after 15 minutes.`
- Repo is public: no secrets or personal data in logs. Commits carry no AI attribution trailers. API code uses ESM `.js` import suffixes. Lint with `npx oxlint --type-aware src/ test/` (api) and `npx oxlint` (web).

## Review Focus

1. **Two submissions by the same student at the same moment** (double tap, two phones): exactly one succeeds and the other gets 429. Test in Task 3.
2. **A student moved to another batch after the link was shared:** the old batch's link refuses them, and the GET no longer lists them. Test in Task 3.
3. **A teacher unassigned from the batch or made INACTIVE after the page loaded:** the submission is refused (`Pick a teacher from the list`) and the teacher drops off the list. Test in Task 3.
4. **A link replaced or switched off while a student has the page open:** their submit gets 404 `This feedback link isn't active`. Test in Task 3.
5. **The student or batch is deleted later:** the feedback row stays, with `studentName` and `batchName`, and the ids nulled. Test in Task 1.

---

## File Structure

**API (`apps/api`)**
- Modify `prisma/schema.prisma`: enum value, Feedback fields and relations, model `FeedbackLink`, back-relations on School, Batch and Student.
- Create `prisma/migrations/20261030090000_student_feedback_links/migration.sql`.
- Create `src/feedback/feedback-links.service.ts`: admin link CRUD.
- Create `src/feedback/public-feedback.service.ts`: form data and submit with cool-down.
- Create `src/feedback/public-feedback.controller.ts` and `src/feedback/public-feedback.dto.ts`.
- Modify `src/feedback/feedback.controller.ts` (link routes), `feedback.module.ts`, `feedback.service.ts` (list mapping, teacher "fromStudents"), `feedback-rules.ts` (label), `feedback.dto.ts` (direction filter accepts the new value).
- Modify `src/schools/schools.service.ts` (Clear All Data deletes links).
- Tests: `src/feedback/public-feedback.spec.ts`, `src/feedback/feedback-links.spec.ts`, `test/student-feedback.e2e-spec.ts`, `test/schema-constraints.e2e-spec.ts` (only if a CHECK is added).

**Web (`apps/web/src`)**
- Modify `features/feedback/api.ts`: types, labels, hooks for links and the public form.
- Create `features/admin/feedback/FeedbackLinksDialog.tsx`.
- Modify `features/admin/feedback/FeedbackPage.tsx`: the button opening the dialog, the Student → Teacher tab, student row display.
- Create `features/public-feedback/StudentFeedbackPage.tsx` and its test `features/public-feedback/StudentFeedbackPage.test.tsx`.
- Modify `routes.tsx`: public route `/feedback/:token`, lazy.
- Modify `features/teacher/FeedbackPage.tsx`: a "From students" section.

---

### Task 1: Schema, migration and Clear All Data

**Files:** `prisma/schema.prisma`, the new migration, `src/schools/schools.service.ts` (Clear All Data at about line 468), `src/schools/clear-all-data.spec.ts`, `test/student-feedback.e2e-spec.ts` (new; this task adds only the deletion test).

**Interfaces:**
- Produces (Prisma):
  - `FeedbackDirection.STUDENT_TO_TEACHER`;
  - `Feedback.studentId?`, `studentName?`, `batchId?`, `batchName?`, with relations `student` and `batch`;
  - `model FeedbackLink { id, schoolId, batchId @unique, token @unique, active, createdById?, createdAt, updatedAt }` with `@@index([schoolId])`;
  - `@@index([studentId, createdAt])` on Feedback.

- [ ] **Step 1: Edit the schema**

  Use the field comments style of the existing Feedback model. The relations are:
  - `student Student? @relation("FeedbackStudent", fields: [studentId, schoolId], references: [id, schoolId], onDelete: SetNull)`;
  - `batch Batch? @relation("FeedbackBatch", fields: [batchId, schoolId], references: [id, schoolId], onDelete: SetNull)`;
  - `FeedbackLink.batch` uses `onDelete: Cascade`, and so does `FeedbackLink.school`.

  `Batch` must have `@@unique([id, schoolId])`; check it does, and add it if not.

- [ ] **Step 2: Write the migration by hand**

  - `ALTER TYPE "FeedbackDirection" ADD VALUE 'STUDENT_TO_TEACHER';`
  - `ALTER TABLE "Feedback" ADD COLUMN …` for the four columns.
  - The composite FKs use `ON DELETE SET NULL ("studentId")` / `("batchId")`. Copy the pattern from the migration that added `targetFacultyId`; grep `SET NULL ("targetFacultyId")` in `prisma/migrations`.
  - The index.
  - `CREATE TABLE "FeedbackLink"` with its FKs and unique indexes.
  - Wrap it in BEGIN / lock_timeout / COMMIT.

- [ ] **Step 3: Verify on a scratch database, then dev**

  Run the commands from Global Constraints. Expected: `migrate deploy` applies the migration and `migrate diff --exit-code` exits 0, on both scratch and dev. Then `npx prisma generate`.

- [ ] **Step 4: Clear All Data**

  In `clearAllData`, add `await tx.feedbackLink.deleteMany({ where: { schoolId } });` next to the feedback delete. Add a test to `clear-all-data.spec.ts`: `it('clears feedback links')`, asserting `feedbackLink.deleteMany` was called with `{ where: { schoolId: 'school-1' } }` inside the transaction. Mock `feedbackLink` the same way the spec mocks the other models.

- [ ] **Step 5: e2e for Review Focus 5**

  In `test/student-feedback.e2e-spec.ts`: `it('feedback outlives its student and batch, keeping their names')`.
  - Create a school, program, batch, student and faculty with Prisma directly.
  - Create a `STUDENT_TO_TEACHER` Feedback row with `studentId`, `studentName` and `batchName`.
  - Delete the student, then the batch.
  - Expect the row to remain, with `studentId: null`, `batchId: null`, and the names unchanged.
  - Clean up by school id in `afterAll`.

- [ ] **Step 6: Run the checks and commit**

  Run `npx tsc --noEmit -p tsconfig.json`, `npx vitest run src/schools`, and the e2e file (`DATABASE_URL=$DIRECT_URL npx vitest run --config vitest.config.e2e.ts test/student-feedback.e2e-spec.ts`). Expected: all pass.

  ```bash
  git add apps/api/prisma apps/api/src/schools apps/api/test/student-feedback.e2e-spec.ts
  git commit -m "Feedback: student-to-teacher direction, feedback links table (migration)"
  ```

---

### Task 2: Admin link management API

**Files:** create `src/feedback/feedback-links.service.ts` and `src/feedback/feedback-links.spec.ts`; modify `src/feedback/feedback.controller.ts` and `src/feedback/feedback.module.ts`.

**Interfaces:**
- Produces:
  - `type LinkRow = { batchId: string; batchName: string; programName: string; token: string | null; active: boolean }`
  - `FeedbackLinksService.list(schoolId): Promise<LinkRow[]>`: every batch of the school, ordered by program name then batch name, with its link or `token: null, active: false`.
  - `create(schoolId, userId, batchId): Promise<LinkRow>`: idempotent, an upsert on `batchId`. The batch must belong to the school, else 404 `Batch not found`.
  - `setActive(schoolId, batchId, active: boolean): Promise<LinkRow>`: 404 if there's no link.
  - `regenerate(schoolId, batchId): Promise<LinkRow>`: a new token; 404 if there's no link.
  - `newToken(): string` = `randomBytes(32).toString('base64url')`.
- Routes on `AdminFeedbackController`, each first calling `this.access.assertAdmin(auth.userId, schoolId)`:
  - `GET links`
  - `POST links` with body `{ batchId: uuid }`
  - `PATCH links/:batchId` with body `{ active: boolean }`
  - `POST links/:batchId/regenerate`

  DTOs go in `feedback.dto.ts`: `CreateFeedbackLinkDto { @IsUUID() batchId }` and `FeedbackLinkActiveDto { @IsBoolean() active }`.

- [ ] **Step 1: Write the failing unit tests (`feedback-links.spec.ts`, mocked Prisma)**

  - `it('create is idempotent per batch and refuses another school's batch')`: `batch.findFirst` is called with `{ id, schoolId }`. A null result rejects with `NotFoundException`. The upsert's `where` is `{ batchId }`.
  - `it('regenerate gives a different 43-character base64url token')`: match `/^[A-Za-z0-9_-]{43}$/` and assert it's not equal to the old token.
  - `it('setActive and regenerate on a batch with no link are 404')`.

- [ ] **Step 2: Run them and check they fail, then implement the service and routes**

- [ ] **Step 3: Run `npx vitest run src/feedback` and check they pass, then commit**

  ```bash
  git add apps/api/src/feedback
  git commit -m "Feedback: admin routes to create, switch off and replace a batch's student feedback link"
  ```

---

### Task 3: Public form API (no login)

**Files:** create `src/feedback/public-feedback.dto.ts`, `public-feedback.service.ts`, `public-feedback.controller.ts` and `public-feedback.spec.ts`; extend `test/student-feedback.e2e-spec.ts`; register them in `feedback.module.ts`.

**Interfaces:**
- Consumes: the `FeedbackLink` and `Feedback` fields from Task 1.
- Produces:
  - `export const STUDENT_COOLDOWN_MS = 15 * 60_000`
  - `PublicFeedbackService.form(token): Promise<{ schoolName; batchName; cooldownMinutes: 15; students: {id,name}[]; teachers: {id,name,subjects: string[]}[] }>`
  - `PublicFeedbackService.submit(token, dto: StudentFeedbackDto, now = new Date()): Promise<{ ok: true; nextAllowedAt: string }>`
  - `StudentFeedbackDto { @IsUUID() studentId; @IsUUID() facultyId; @IsInt() @Min(1) @Max(5) rating; @IsString() @Transform(trim + collapse whitespace) @Length(10, 1000) comment }`
  - `@Controller('public/feedback')`, with no `SessionGuard`, `@Throttle({ default: { limit: 120, ttl: 60_000 }, ...durableThrottle(120, 60_000) })`, and `@Header('Cache-Control', 'no-store')` on both routes:
    - `GET :token` → `form`;
    - `POST :token` → `submit`, returning 201.
- Errors:
  - unusable token → `NotFoundException("This feedback link isn't active")`;
  - student not ACTIVE in the link's batch → `BadRequestException('Pick your name from the list')`;
  - teacher not assigned to the batch, or INACTIVE → `BadRequestException('Pick a teacher from the list')`;
  - cool-down → `HttpException({ message: 'You can send feedback again in N minutes', retryAfterSeconds }, 429)`, where N = `Math.ceil(remaining / 60_000)`.

- [ ] **Step 1: Write the failing unit tests (`public-feedback.spec.ts`, mocked Prisma)**

  - `it('the form lists only the batch's active students (id and name) and its non-inactive teachers')`: assert the `student.findMany` where is `{ schoolId, batchId, status: 'ACTIVE' }`, its select is exactly `{ id: true, fullName: true }`, and the output has only `id` and `name` keys.
  - `it('an inactive, unknown or replaced link is 404 with the same message')`.
  - `it('refuses a student or teacher outside the batch')`.
  - `it('within 15 minutes of the last one: 429 with minutes left, nothing inserted')`: the last row is 14 min ago, so the message is `You can send feedback again in 1 minute`, `retryAfterSeconds` is 60, and `feedback.create` isn't called.
  - `it('stores a student-to-teacher row with names snapshotted and no creator')`: assert the `feedback.create` data includes:
    - `direction: 'STUDENT_TO_TEACHER'`, `senderName: <student name>`, `studentName`, `studentId`;
    - `batchId`, `batchName`, `targetFacultyId`, `targetName`;
    - `toAllFaculty: false`, `category: 'GENERAL'`, `source: 'APP'`;
    - `feedbackDate` = today (IST), `createdById: null`.

- [ ] **Step 2: Run them and check they fail, then implement**

  `submit` runs inside `this.prisma.$transaction(async (tx) => …)`:
  1. Load the link with its batch and school name. Check it's active.
  2. ``tx.$queryRaw`SELECT "id" FROM "Student" WHERE "id" = ${studentId} AND "schoolId" = ${schoolId} AND "batchId" = ${batchId} AND "status" = 'ACTIVE' FOR UPDATE` ``. No row means 400.
  3. Check the teacher with `tx.facultyBatch.findFirst({ where: { batchId, facultyId, schoolId, faculty: { status: { not: 'INACTIVE' } } }, include: { faculty: { select: { name: true } } } })`.
  4. Find the latest `STUDENT_TO_TEACHER` row for the student (`orderBy createdAt desc`). If it's under 15 min old, throw 429.
  5. Create the row.

- [ ] **Step 3: Run the unit tests and check they pass**

- [ ] **Step 4: Write the e2e tests (`test/student-feedback.e2e-spec.ts`, real services on the dev DB, per-run unique data)**

  - `it('GET returns only this batch: active students without roll numbers, assigned non-inactive teachers')`
  - `it('two submissions by one student at the same moment: one 201, one 429')` (Review Focus 1): `Promise.allSettled` of two `submit` calls; one fulfils and one rejects with status 429.
  - `it('a student moved to another batch is refused and no longer listed')` (Review Focus 2).
  - `it('a teacher unassigned or made inactive is refused and dropped from the list')` (Review Focus 3).
  - `it('a replaced or switched-off link is 404 for a student who already has the page open')` (Review Focus 4): submit with the old token after `regenerate`; then `setActive(false)` and submit again.

  Run with `DATABASE_URL=$DIRECT_URL npx vitest run --config vitest.config.e2e.ts test/student-feedback.e2e-spec.ts`. Expected: PASS.

- [ ] **Step 5: Commit**

  ```bash
  git add apps/api/src/feedback apps/api/test/student-feedback.e2e-spec.ts
  git commit -m "Feedback: public student form API with a 15-minute per-student cool-down"
  ```

---

### Task 4: Student feedback in the admin list and the teacher's portal (API)

**Files:** modify `src/feedback/feedback.service.ts` (`toFeedback`, `adminList`, `teacherFeedback`), `feedback-rules.ts`, `feedback.dto.ts`, and `src/feedback/feedback.spec.ts`.

**Interfaces:**
- Produces:
  - `DIRECTION_LABELS.STUDENT_TO_TEACHER = 'Student -> Teacher'`.
  - `FeedbackQuery.direction` accepts `STUDENT_TO_TEACHER`.
  - `toFeedback(row)` sets:
    - `target = { all: false, name: row.targetName }` for `STUDENT_TO_TEACHER`;
    - a new field `student: { name: row.studentName, batchName: row.batchName } | null`, filled only for that direction.
  - `teacherFeedback(scope)` returns `{ received, sent, fromStudents: { id, rating, content, batchName, date, createdAt, status }[] }`. The query is `where: { schoolId, direction: 'STUDENT_TO_TEACHER', targetFacultyId: scope.facultyId, status: { not: 'DISMISSED' } }`, with `select` of exactly those columns, and it returns `[]` when `!scope.active || !scope.facultyId`.
- `parseDirection` (import) stays unchanged: student feedback can't be imported.

- [ ] **Step 1: Write the failing tests in `feedback.spec.ts`**

  - `it('teacher student-feedback has no student identity, even in the query')`: assert the `findMany` `select` has no `studentId`, `studentName` or `senderName`, and that no returned object has those keys.
  - `it('hides dismissed student feedback from the teacher and shows nothing to an inactive one')`.
  - `it('admin list filters by Student -> Teacher and shows the student and batch')`.

- [ ] **Step 2: Run them and check they fail, implement, and check they pass**

  Run `npx vitest run src/feedback`, then `npx oxlint --type-aware src/ test/`. Expected: pass, 0 warnings.

- [ ] **Step 3: Commit**

  ```bash
  git add apps/api/src/feedback
  git commit -m "Feedback: student feedback in the admin list (with name) and the teacher's page (without)"
  ```

---

### Task 5: Web: admin links dialog and Student → Teacher tab

**Files:** modify `features/feedback/api.ts`; create `features/admin/feedback/FeedbackLinksDialog.tsx`; modify `features/admin/feedback/FeedbackPage.tsx`; extend `features/feedback/api.test.ts`.

**Interfaces:**
- Consumes: the Task 2 routes; the Task 4 `student` field and direction.
- Produces, in `api.ts`:
  - `FeedbackDirection` gains `'STUDENT_TO_TEACHER'`; `DIRECTION_LABELS` gets `'Student → Teacher'`;
  - `type FeedbackLinkRow = { batchId; batchName; programName; token: string | null; active: boolean }`;
  - `useFeedbackLinks(schoolId)`, plus mutations `createLink`, `setLinkActive`, `regenerateLink`;
  - `feedbackLinkUrl(token: string, origin = window.location.origin) => `${origin}/feedback/${token}``.

- [ ] **Step 1: Test `feedbackLinkUrl` in `api.test.ts`**

  `it('builds the public link from the site origin')`: `feedbackLinkUrl('abc', 'https://eduadmin-web.vercel.app')` equals `https://eduadmin-web.vercel.app/feedback/abc`.

- [ ] **Step 2: Implement the dialog and the page changes**

  - A **"Student feedback links"** button on the admin Feedback page header opens the dialog. The dialog lists batches grouped by program. Per row:
    - no link: **Create link**;
    - with a link: **Copy link** (shows "Copied" for 2 s), an active toggle, and **Replace link**, which confirms with "The old link will stop working" first.
  - Add the **Student → Teacher** tab beside the existing direction tabs.
  - Student rows show "*Student* (Batch) → *Teacher*".
  - Follow the existing dialog and form styles (`components/ui/Dialog`, `formStyles`).

- [ ] **Step 3: Run the checks and commit**

  Run `npx tsc -b && npx vitest run && npx oxlint`. Expected: pass.

  ```bash
  git add apps/web/src/features
  git commit -m "Feedback page: student feedback links per batch, and a Student → Teacher tab"
  ```

---

### Task 6: Web: public student page

**Files:** create `features/public-feedback/StudentFeedbackPage.tsx` and `StudentFeedbackPage.test.tsx`; modify `routes.tsx` (add a lazy `{ path: '/feedback/:token' }` beside `/login`, with no auth wrapper); add to `features/feedback/api.ts`:
- `usePublicFeedbackForm(token)`: GET `/public/feedback/:token`, `retry: false`;
- `submitStudentFeedback(token, body)`.

**Interfaces:** consumes the Task 3 endpoints and the 404 / 400 / 429 bodies.

- [ ] **Step 1: Write the failing component tests**

  Mock the api module the way existing web tests do; check `features/assessments/allMatching.test.ts`. Tests:
  - `it('a 404 shows "This feedback link isn't active"')`
  - `it('the form needs a name, a teacher, a rating and a 10-character comment before Send is enabled')`
  - `it('after sending shows the thank-you and the 15-minute note')`: the exact copy from Global Constraints.
  - `it('a 429 shows the minutes left and keeps the typed comment')`
  - `it('a 400 shows the server message')`

- [ ] **Step 2: Implement the page**

  - Mobile-first single column; reuse the auth pages' card layout.
  - School and batch are the heading.
  - Name and teacher selects; teacher options show "Name · Subjects".
  - Five tappable star buttons with `aria-label="N stars"`.
  - A textarea with a live `n/1000` counter.
  - Send button with a busy state.

- [ ] **Step 3: Run the checks and commit**

  Run `npx tsc -b && npx vitest run && npx oxlint && npx vite build`. Expected: pass.

  ```bash
  git add apps/web/src
  git commit -m "Public student feedback page at /feedback/:token"
  ```

---

### Task 7: Web: teacher "From students" section, docs, and an end-to-end check

**Files:** modify `features/teacher/FeedbackPage.tsx`, `features/feedback/api.ts` (`fromStudents` in the teacher type) and `docs/deploy.md` (a short "Student feedback links" note under Feedback: one link per batch, public, the 15-minute cool-down, and that admins see names and teachers don't).

- [ ] **Step 1: Render "From students"**

  Show rating stars, comment, batch and date, newest first, and an empty state of "No feedback from students yet". Never read or render student name fields (the API doesn't send them).

- [ ] **Step 2: Check it end to end against the dev servers**

  Run `preview_start api` and `preview_start web`, with a localhost test admin from the scratchpad `testcreds.env`. Then:
  1. Create a link for a batch with two students and one assigned teacher, and copy it.
  2. Open it signed out and submit once.
  3. Submit again and confirm the 429 message.
  4. Check the admin list shows the student's name under Student → Teacher.
  5. As the teacher, confirm the entry shows without a name.
  6. Dismiss it as admin and confirm it disappears for the teacher.

- [ ] **Step 3: Run the full checks and commit**

  Run the API unit, e2e and lint, then the web tests in all three timezones (`TZ=Asia/Kolkata`, `America/Los_Angeles`, `Pacific/Kiritimati`), lint and build. Expected: all pass.

  ```bash
  git add apps/web/src docs/deploy.md
  git commit -m "Teacher feedback: From students (without names); deploy notes"
  ```
