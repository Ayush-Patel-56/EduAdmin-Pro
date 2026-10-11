# Deploying EduAdmin Pro

## Order

**migration → API → web.** Each step tolerates the previous release still running:

- The new migrations are additive. `School.adminInviteCode` has a database default, so the *previous* API can keep creating schools between the migration and the API deploy (no "back to back" window is needed).
- The web app tolerates an API that predates a feature (for example `/auth/me` without `preferences`), but an old web build against a *newer* API is not guaranteed, so deploy the web last.

Run migrations with `pnpm --filter api exec prisma migrate deploy` over the **direct** (non-pooled) connection (`DIRECT_URL`). Never run `prisma migrate dev` against production.

## Before the invite-code migration (`20261011210000_admin_invite_and_email_index`)

The migration adds a unique index on `lower("email")`. It fails if two accounts already differ only by letter case, so check first:

```sql
SELECT lower(email), count(*) FROM "User" GROUP BY 1 HAVING count(*) > 1;
```

No rows means it is safe. If rows come back, merge or rename those accounts first.

The index is created with raw SQL because `schema.prisma` can't express expression indexes. Prisma leaves it alone: replaying every migration into an empty database and diffing it against `schema.prisma` reports no changes, so the next `prisma migrate dev` will not try to drop it.

## Before the unique-names migration (`20261012010000_unique_names_and_chapters`)

The migration adds three unique expression indexes: one syllabus chapter title per batch + subject, one program name per school and one batch name per program (any letter case). Each fails if duplicates already exist, so check first:

```sql
SELECT "batchId", "subject", lower("title"), count(*) FROM "SyllabusItem" GROUP BY 1, 2, 3 HAVING count(*) > 1;
SELECT "schoolId", lower("name"), count(*) FROM "Program" GROUP BY 1, 2 HAVING count(*) > 1;
SELECT "programId", lower("name"), count(*) FROM "Batch" GROUP BY 1, 2 HAVING count(*) > 1;
```

No rows means it is safe. If rows come back, rename or delete the extras first (the app can do it: edit or delete the chapter, program or batch).

**If it failed anyway:** this migration is not wrapped in a transaction, so the indexes created before the failing one stay behind and a plain re-run fails with "already exists". Recover with:

```sql
DROP INDEX IF EXISTS "SyllabusItem_batchId_subject_lower_title_key";
DROP INDEX IF EXISTS "Program_schoolId_lower_name_key";
DROP INDEX IF EXISTS "Batch_programId_lower_name_key";
```

then fix the duplicates the error names, and:

```bash
pnpm --filter api exec prisma migrate resolve --rolled-back 20261012010000_unique_names_and_chapters
pnpm --filter api exec prisma migrate deploy
```

After it is applied, two people creating the same program, batch or chapter at the same moment get a 409 ("already exists"), never a 500. A syllabus import that loses such a race reports the affected rows as skipped instead of counting them as created.

## Before the curriculum-names migration (`20261012030000_curriculum_unique_names`)

The migration adds two unique expression indexes (one concept name per chapter, one chapter per subject + name + board + class + program, any letter case). It fails if duplicates already exist, so check first:

```sql
SELECT "chapterId", lower("name"), count(*) FROM "CurriculumConcept" GROUP BY 1, 2 HAVING count(*) > 1;
SELECT "schoolId", "subject", lower("name"), coalesce("board", ''), coalesce("classLevel", ''), coalesce("programId", ''), count(*)
  FROM "CurriculumChapter" GROUP BY 1, 2, 3, 4, 5, 6 HAVING count(*) > 1;
```

No rows means it is safe. If rows come back, rename or delete the extras first. Like the email index, these are raw SQL and Prisma leaves them alone.

**If it failed anyway:** the file is not wrapped in a transaction, so the first index may already exist and a plain re-run fails with "already exists". Recover with:

```sql
DROP INDEX IF EXISTS "CurriculumConcept_chapterId_lower_name_key";
DROP INDEX IF EXISTS "CurriculumChapter_natural_key";
```

then remove the duplicates the queries above list, and:

```bash
pnpm --filter api exec prisma migrate resolve --rolled-back 20261012030000_curriculum_unique_names
pnpm --filter api exec prisma migrate deploy
```

With the chapter index in place, removing a program (Delete on the Programs tab, or leaving it out in Edit School) keeps its chapters without a program. If that would duplicate a chapter that already has no program (same subject, name, board and class), the API answers 409 and names the chapters; rename or delete one copy in Curriculum, then remove the program.

Migration folders must sort in the order they were created: use timestamps later than the newest folder in `apps/api/prisma/migrations`.

## Recruitment migrations (`20261012040000_recruitment`, `20261012050000_recruitment_hardening`)

- `20261012040000_recruitment` was renamed from `20261011200000_recruitment` so migration folders sort in the order they were created. A database that already applied it under the old name needs the record renamed once (the file's content, and so its checksum, is unchanged):

  ```sql
  UPDATE "_prisma_migrations" SET migration_name = '20261012040000_recruitment' WHERE migration_name = '20261011200000_recruitment';
  ```

  A database that has not applied it yet needs nothing.
- The hardening migration turns the recruitment tables' timestamps into `timestamptz` (existing values are read as UTC), adds `Candidate.facultyId` and adds a unique index on `TeacherAppraisal (facultyId, period, academicYear)`. The index fails if duplicates exist, so check first:

  ```sql
  SELECT "facultyId", "period", "academicYear", count(*) FROM "TeacherAppraisal" GROUP BY 1, 2, 3 HAVING count(*) > 1;
  ```

  **Run this on production before `migrate deploy`, and expect no rows.** The file is already applied on the dev branch, so it is left unchanged (editing an applied migration changes its checksum, and `prisma migrate dev` then insists on resetting that database). It is not wrapped in a transaction: with duplicates present, the timestamp conversion, `Candidate.facultyId` and its index apply, and only the appraisal index fails.
- **If it failed on the appraisal index anyway, don't `migrate resolve --rolled-back` and re-run it.** The re-run fails on `facultyId`, and converting an already converted column again shifts every value by the session's UTC offset. Finish it instead:

  ```bash
  # remove the duplicate appraisals the query above lists, then:
  psql "$DIRECT_URL" -v ON_ERROR_STOP=1 -1 <<'SQL'
  CREATE UNIQUE INDEX "TeacherAppraisal_facultyId_period_academicYear_key" ON "TeacherAppraisal"("facultyId", "period", "academicYear");
  ALTER TABLE "Candidate" ADD CONSTRAINT "Candidate_facultyId_fkey" FOREIGN KEY ("facultyId") REFERENCES "Faculty"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  SQL
  pnpm --filter api exec prisma migrate resolve --applied 20261012050000_recruitment_hardening
  pnpm --filter api exec prisma migrate deploy
  ```

  If it failed anywhere else (a lost connection, a lock), check which of its statements took effect and run only the remaining ones the same way before `resolve --applied`.
- The timestamp conversion rewrites each recruitment table under an `ACCESS EXCLUSIVE` lock (reads and writes on it wait until it finishes). The tables are tiny now, but `RecruitmentAuditLog` only ever grows: plan any future type change on it for a quiet moment.

- The audit table's trigger rejects `UPDATE`, `DELETE` and `TRUNCATE` from the application, which protects against bugs. It is not protection against the database owner, who can disable a trigger; use a separate, limited database role for the API if you need that. Audit rows keep names, phone numbers and salaries for as long as the table exists: plan for that when handling data-erasure requests.

## After deploying the invite-code change: review existing admins

Before this change, any admin account that entered a school's invite code, the same code teachers use, became an ADMIN of that school. Nothing records which code was used, so review every admin who is not the school's owner:

```bash
pnpm --filter api admins:audit -- --before 2026-10-11T00:00:00Z
```

(use the time the change was deployed for `--before`; the script is read-only). To revoke one that shouldn't have admin rights:

```sql
UPDATE "SchoolMembership" SET "status" = 'REVOKED' WHERE "id" = '<membership id from the report>';
```

A revoked member cannot rejoin with an invite code. Then rotate the school's codes from its dashboard (the refresh button next to each code), since the old teacher code is the one that leaked admin access.

## Admin signup code (`ADMIN123`)

`ADMIN123` is a permanent, public platform code that lets anyone create an **admin account** (it no longer lets them into an existing school: joining a school needs that school's admin invite code). Issue private codes with `pnpm --filter api invite:create`. Making `ADMIN123` development-only is tracked as a follow-up.

## Environment

See `apps/api/.env.example`. Production refuses to start without `WEB_ORIGIN` and SMTP settings, and refuses `REQUIRE_EMAIL_VERIFICATION=false`. Set `TRUST_PROXY` to the number of proxies in front of the API.

## CI

`.github/workflows/ci.yml` runs on every push and pull request (Node 22): install → typecheck → lint → unit tests → build, plus an API e2e job against a throwaway Postgres service container with all migrations applied from scratch. Node 20 isn't supported (the API tests crash a vitest worker).
