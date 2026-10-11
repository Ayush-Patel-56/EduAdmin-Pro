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

## Before the curriculum-names migration (`20261012030000_curriculum_unique_names`)

The migration adds two unique expression indexes (one concept name per chapter, one chapter per subject + name + board + class + program, any letter case). It fails if duplicates already exist, so check first:

```sql
SELECT "chapterId", lower("name"), count(*) FROM "CurriculumConcept" GROUP BY 1, 2 HAVING count(*) > 1;
SELECT "schoolId", "subject", lower("name"), coalesce("board", ''), coalesce("classLevel", ''), coalesce("programId", ''), count(*)
  FROM "CurriculumChapter" GROUP BY 1, 2, 3, 4, 5, 6 HAVING count(*) > 1;
```

No rows means it is safe. If rows come back, rename or delete the extras first. Like the email index, these are raw SQL and Prisma leaves them alone.

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
