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

## Students (`20261013090000_students`)

New tables only (students, guardians, batch history, uploaded-file metadata), wrapped in a transaction, so there is nothing to check before deploying.

## Students hardening (`20261013100000_students_hardening`)

One transaction: a unique index on `Student.photoFileId` (a photo belongs to one student), batch history that keeps the batch and program names and survives deleting the batch (`StudentEnrollment.batchId` becomes nullable, `ON DELETE SET NULL`), and roll numbers stored upper-cased. The unique indexes fail if duplicates already exist, so check first and expect no rows:

```sql
SELECT "photoFileId", count(*) FROM "Student" WHERE "photoFileId" IS NOT NULL GROUP BY 1 HAVING count(*) > 1;
SELECT "batchId", upper("rollNumber"), count(*) FROM "Student"
WHERE "batchId" IS NOT NULL AND "rollNumber" IS NOT NULL GROUP BY 1, 2 HAVING count(*) > 1;
```

If either returns rows, fix those students (another photo, another roll number) and run the check again. A failed run rolls back completely, so after fixing the data, `prisma migrate resolve --rolled-back 20261013100000_students_hardening` and `migrate deploy` again.

## Teacher portal (`20261013150000_teacher_portal`)

New tables (study material, assignments with staff-recorded submissions, counseling sessions), new nullable or defaulted faculty columns (designation, primary subject and stream, uploaded photo) and four new upload kinds. Wrapped in a transaction; nothing to check before deploying. Adding enum values inside a transaction needs PostgreSQL 12 or later (Neon runs 16+).

Study material accepts PDF, DOCX, ZIP and MP4 up to 50 MB; question sheets and submitted work accept PDF, DOCX and images up to 10 MB. With R2, the bucket's CORS rule below covers these uploads too.

## Teacher portal hardening (`20261013160000_teacher_portal_hardening`)

One transaction: unique indexes so an uploaded file belongs to one record (`Faculty.photoFileId`, `StudyMaterial.fileId`, `Assignment.questionFileId`, `AssignmentSubmission.fileId`). The API already checks this before attaching a file; the indexes decide when two requests race past that check (the loser gets a 409). They fail if duplicates exist, so check first and expect no rows:

```sql
SELECT "photoFileId", count(*) FROM "Faculty" WHERE "photoFileId" IS NOT NULL GROUP BY 1 HAVING count(*) > 1;
SELECT "fileId", count(*) FROM "StudyMaterial" GROUP BY 1 HAVING count(*) > 1;
SELECT "questionFileId", count(*) FROM "Assignment" WHERE "questionFileId" IS NOT NULL GROUP BY 1 HAVING count(*) > 1;
SELECT "fileId", count(*) FROM "AssignmentSubmission" WHERE "fileId" IS NOT NULL GROUP BY 1 HAVING count(*) > 1;
```

## Schedule and attendance (`20261014090000_schedule_attendance`)

New tables only (weekly slots, special classes, class occurrences and attendance records), wrapped in a transaction, so there is nothing to check before deploying. CHECK constraints keep the weekday (0–6), times (minutes after midnight, end after start) and effective periods valid.

Attendance is kept as a record: a slot or special class with attendance can't be deleted (end it or mark it inactive), a batch with attendance can't be deleted (set its end date), and a student with attendance can't be deleted (set them Inactive or Transferred). `20261014120000_attendance_keeps_students` makes the student foreign key NO ACTION to back that up; nothing to check before deploying it. Clear All Data removes schedules and attendance with the rest of the academic data.

## Fee Management (`20261014150000_fees`)

New tables only (fee structures, student dues, payments, receipt counters), wrapped in a transaction, so there is nothing to check before deploying. Money is stored as whole paise (integers). CHECK constraints keep amounts non-negative, keep each due's net payable equal to amount − discount + late fee, and require a reason for a status override and for a voided payment. Unique indexes keep fee names (any letter case) and receipt numbers unique per school, and a live transaction reference can't be recorded twice.

Fee records are kept: a payment is voided (with who, when and why), never deleted; a due with payment history, a fee structure with dues, and a student with dues can't be deleted. A program or batch that a fee structure is scoped to can't be deleted until the fee is moved. Clear All Data removes all fee data with the rest of the academic data.

`20261014160000_fees_paid_check` adds a CHECK that a due's paid total never exceeds its net payable (the API already refuses it under a lock). Before deploying, expect no rows from `SELECT "id" FROM "FeeDue" WHERE "paidPaise" > "netPaise";`.

## Meetings (`20261014180000_meetings`)

New tables only (meetings and their agenda items), wrapped in a transaction, so there is nothing to check before deploying. CHECK constraints keep the meeting time valid and the next meeting date on or after the meeting. Deleting a meeting deletes its agenda items; Clear All Data removes meetings.

## Academic Calendar (`20261014200000_calendar_events`)

A new table only (calendar events), wrapped in a transaction, so there is nothing to check before deploying. CHECK constraints keep each event's end on or after its start, allow Repeat Until only for repeating events, and stop a repeating event from overlapping its own next repeat (daily: one day; weekly: under 7 days; monthly: under 28 days). Repeats are expanded when read, so nothing is generated ahead of time. An event scoped to a program or batch is deleted with it (the delete confirmations say how many); Clear All Data removes events.

`20261014210000_calendar_batch_scope` makes a batch event store only its batch: its program is read through the batch, so moving a batch to another program takes its events along, and deleting the old program can't delete them. It clears `programId` on existing batch events and adds a CHECK that an event has a program or a batch, not both. Nothing to check before deploying.

## Enrollment end dates (`20261014220000_enrollment_end_check`)

Promotion used to end the open enrollment of a student leaving a class batch on the year boundary, even when they had joined the batch after it, so the history read e.g. "2026-10-13 → 2026-04-01". Promotion now ends it on `GREATEST(enrolledOn, boundary)`. This migration repairs existing rows the same way (their end becomes their start date) and adds a CHECK that an enrollment never ends before it begins. It runs in one transaction.

Before deploying, see which rows it will repair (it's fine if there are some; nothing else is changed):

```sql
SELECT "id", "studentId", "batchName", "enrolledOn", "endedOn" FROM "StudentEnrollment" WHERE "endedOn" < "enrolledOn";
```

## Timestamps become `timestamptz` (`20261014230000_timestamptz`)

This finishes the conversion to `timestamptz` and adds the UTC session guard. Every module added since recruitment (students and files, the teacher portal, schedule and attendance, fees, meetings, calendar) already declares its instants as `timestamptz(3)`: 51 columns, which already rely on a UTC session. This migration converts the remaining 28 `timestamp without time zone` columns (users, sessions, schools, programs, batches, faculty, syllabus, curriculum, ...) to `timestamptz(3)`. Calendar dates (`@db.Date`: MOU dates, joining date, batch start/end, ...) are untouched. Existing values are read as UTC explicitly (`USING ... AT TIME ZONE 'UTC'`), so nothing shifts whatever the session time zone of the migration.

- **Why a UTC session matters.** Prisma's pg adapter sends `DateTime` values as UTC wall-clock text without an offset and reads `timestamptz` values back assuming they are UTC. In an Asia/Kolkata session it would store `10:00Z` as `04:30Z`: the app wouldn't notice, because it reads its own values back the same way, but SQL, BI tools and exports would. That is already true today for the 51 `timestamptz` columns on `main`; after this migration it holds for all of them, and the startup guard below makes a wrong setting fail loudly instead of shifting data quietly.
- **Before deploying, check the time zone on dev and prod, over both the pooled (`DATABASE_URL`) and direct (`DIRECT_URL`) connections:**

  ```sql
  SHOW timezone;  -- must be UTC, GMT or Etc/UTC (Neon's default is GMT)
  ```

  If it isn't, set it **on the database or on the API's role**, never per session (a pooled connection doesn't keep session settings), then reconnect:

  ```sql
  ALTER DATABASE <db> SET timezone TO 'UTC';   -- or: ALTER ROLE <api user> SET timezone TO 'UTC';
  ```

- **Startup guard:** the API checks the time zone of its connection once, at startup, and refuses to boot if it isn't UTC. It does not check every pooled connection or later sessions, so it catches a database or role that is set wrong, but not a client that changes `timezone` on its own connection. Keep the setting on the database or role, as above, and nobody's session needs to set it.
- **Locking:** each table is rewritten once under an `ACCESS EXCLUSIVE` lock (reads and writes on it wait). The tables are small, so this takes well under a second today. The migration sets `lock_timeout = 10s`: if a long-running query holds a table, it fails instead of queueing every request behind it.
- **If it fails** (e.g. lock timeout), it is wrapped in `BEGIN; ... COMMIT;`, so nothing was converted. Mark it rolled back and deploy again:

  ```bash
  pnpm --filter api exec prisma migrate resolve --rolled-back 20261014230000_timestamptz
  pnpm --filter api exec prisma migrate deploy
  ```

- The previous API release keeps working against the converted tables (verified on a UTC session), so the usual order applies: migration → API → web. Roll back the API alone if needed: the previous release works with either column type.
- Verify afterwards (expect 0):

  ```sql
  SELECT count(*) FROM information_schema.columns
  WHERE table_schema = 'public' AND data_type = 'timestamp without time zone' AND table_name <> '_prisma_migrations';
  ```

## Daily reports (`20261018090000_daily_reports`)

A new table only (teachers' daily class reports), wrapped in a transaction, so there is nothing to check before deploying.

- **On Time or Late.** A report is On Time only when it is first submitted on the day it is about, in India (IST). One submitted the next day or later, or for an earlier day, is Late; a day still to come is refused. The API works this out, and a CHECK constraint holds `late` to the same rule against `submittedAt`. Editing a report keeps its status (it was submitted when it was); moving it to another day makes it a report for that day, submitted at that moment.
- **One per class.** A unique index allows one report per teacher, batch, subject (any letter case) and day, so a double submit is a 409 and the first report can be edited instead.
- **Kept as records.** A batch with daily reports can't be deleted (set an end date instead; the batch delete confirmation says so). A report keeps its teacher's name if the faculty profile is deleted later. Clear All Data removes daily reports with the rest of the academic data.

## Feedback (`20261018120000_feedback`)

New enums and a new table only (feedback between management and faculty), wrapped in a transaction, so there is nothing to check before deploying.

- **Both ways.** Teachers send feedback to management; admins send to one teacher or to all faculty. CHECK constraints keep the rating at 1-5, the content non-blank, and the direction consistent: Teacher -> Management has no target, and Management -> Teacher goes to all faculty or to one named teacher.
- **Review workflow.** Admins move every entry Submitted -> Reviewed -> Actioned, or Dismissed (archived), recording who and when; a CHECK ties that record to the status. Dismissed feedback no longer shows to teachers.
- **Kept as records.** An entry keeps the sender's and the target teacher's names, so it still reads right if a faculty profile is deleted later. Clear All Data removes feedback with the rest of the school's data.
- **Bulk upload.** A sheet's teacher sender must match a faculty member, and a teacher target an active one (name, email or employee ID).
- **`20261018130000_feedback_import_key`** keys each imported row by its cells as written (a hash, unique per school through a partial unique index), so the same sheet uploaded again (by another admin, on another day, or twice at once) never stores a row twice; any imported rows from before get a key of their own. It also records the id of the admin who last changed an entry's status, next to their name.
- Both migrations set `lock_timeout = 10s`: if a long-running query holds `School` or `Faculty`, they fail cleanly (and roll back) instead of queueing requests; mark the failed one `--rolled-back` and deploy again.

## PTM notes (`20261018150000_ptm_notes`)

A new table only (parent-teacher meeting notes), wrapped in a transaction with `lock_timeout = 10s`, so there is nothing to check before deploying.

- **Faculty only.** Teachers log meetings with the parents of students in their own batches, and read, correct or delete only the notes they logged. There is no admin screen; the notes are kept for the student's record (the 5-in-1 report).
- **Checks.** Discussion notes are required, a meeting can't be logged for a day still to come (API), and a CHECK keeps the follow-up date on or after the meeting.
- **Kept as records.** A note names its batch and teacher as they were, so it still reads right after either is deleted (the links become null). Deleting a student removes their notes, as it does their counseling sessions; Clear All Data removes them with the rest.

## File storage (Cloudflare R2)

Uploaded files (student photos now) are private. The browser uploads straight to the bucket with a short-lived signed URL, the API then checks the size and the file's real type before using it, and every download is a signed URL valid for 15 minutes.

1. Create an R2 bucket (keep public access off) and an API token with Object Read & Write on it.
2. Set `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY` and `R2_BUCKET` on the API (all four, or none).
3. Add a CORS rule to the bucket so the web app can upload and show files:

   ```json
   [{ "AllowedOrigins": ["https://<your web origin>"], "AllowedMethods": ["PUT", "GET"], "AllowedHeaders": ["Content-Type"], "MaxAgeSeconds": 3600 }]
   ```

4. Add a lifecycle rule that deletes objects under the `uploads/` prefix after 1 day. The browser uploads to `uploads/<school>/<file>`; completing the upload checks the bytes and moves them to the key they are served from. The signed upload URL stays valid for its few minutes even after that, so a second PUT with it could leave bytes behind under `uploads/`. They are never served, and this rule removes them.

Without these settings, production refuses uploads with a clear message (everything else works). For development without R2, set `FILE_STORAGE=local` (the API refuses to start with it in production): files then go to `apps/api/.storage` (git-ignored, served through the API with signed links that stop working when the API restarts), and an upload link stops working once its file is completed. Uploads that are never completed, and photos never attached to a student, are removed after a day; deleting a student, Clear All Data and deleting a school remove their files too.

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

## Admin signup code (`ADMIN123`) is development-only (`20261012060000_revoke_admin123`)

`ADMIN123` used to be a permanent public code that let anyone create an admin account. The migration revokes it in every environment (a migration can't tell production from development). Accounts already created with it keep working; only new signups with it are refused.

- **Production:** issue a private code per client with `pnpm --filter api invite:create -- "Client name" --max-uses 1 --days 14`. After deploying, confirm the revoke:

  ```sql
  SELECT code, "revokedAt" FROM "AdminInviteCode" WHERE code = 'ADMIN123';  -- revokedAt must be set
  ```

  Also review admins who signed up with it (`pnpm --filter api admins:audit`, see above).
- **Development** (local database or the Neon `dev` branch): `NODE_ENV=development pnpm --filter api seed:dev` re-enables it. The script refuses to run when `NODE_ENV` is `production` or unset.

## Environment

See `apps/api/.env.example`. Production refuses to start without `WEB_ORIGIN` and SMTP settings, and refuses `REQUIRE_EMAIL_VERIFICATION=false`. Set `TRUST_PROXY` to the number of proxies in front of the API.

## CI

`.github/workflows/ci.yml` runs on every push and pull request (Node 22): install → typecheck → lint → unit tests → build, plus an API e2e job against a throwaway Postgres service container with all migrations applied from scratch. Node 20 isn't supported (the API tests crash a vitest worker).
