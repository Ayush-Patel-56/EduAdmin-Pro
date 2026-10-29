# Student feedback links: design

Date: 2026-10-30. Status: draft for Ayush's approval.

## Intent

Students have no accounts in EduAdmin Pro, but the school wants their feedback on teachers. An admin makes a **link for a batch** and shares it with the class (for example in the class WhatsApp group). A student opens it on their phone, picks their name from the batch's list, picks a teacher, and gives a star rating and a comment. The feedback appears straight away in the admin's **Feedback** section, with the student's name. The teacher sees feedback about themselves in their own portal, **without** the student's name.

Ayush asked for it to be built responsibly: data must never mix between schools, batches or students, and it must hold up when many students use it at once, on serverless with several API instances.

## Decisions made by Ayush

- Built into the app. No Google Form or Sheet.
- The **admin** creates and shares the link.
- The student **picks their name** from a dropdown of the students in that batch. Nothing else identifies them: no roll number, PIN or device check, for now. Ayush will revisit this later.
- They pick a **teacher**, then give a **rating and a comment**.
- **Admins see the student's name.**
- **Teachers see feedback about themselves, but not the student's name.**
- A student may send **any number** of feedbacks, but at most **one every 15 minutes**.

## Goals

1. **One link per batch.** An admin can create it, copy it, switch it off and back on, or replace it with a new link (the old one stops working).
2. **Public student page** at `/feedback/<token>`, with no login. It shows the school and batch name and has these fields:
   - **Your name:** a dropdown of the batch's **active** students.
   - **Teacher:** a dropdown of the teachers **assigned to that batch** who are not inactive.
   - **Rating:** 1–5 stars.
   - **Comment:** 10–1,000 characters.

   After sending, it shows a thank-you, and the form can be used again after the cool-down.
3. **Stored as feedback** of a new kind, **Student → Teacher**, in the existing Feedback model. It shows in the admin Feedback section with its own direction tab or filter, goes through the existing review workflow (Submitted → Reviewed → Actioned / Dismissed), and counts in the existing KPIs and charts.
4. **The teacher's Feedback page** lists student feedback addressed to them. The API leaves out the student's identity for teachers: the server omits it, the browser doesn't just hide it.
5. **Abuse limits** are enforced on the server and backed by the database, so they hold across instances:
   - 15-minute cool-down per student.
   - A loose request limit per IP on the public endpoints.
6. **Safe at scale:**
   - Every row is tied to its school with composite foreign keys, as elsewhere in the schema.
   - The cool-down check-and-insert is atomic: two submissions at the same moment can't both pass.
   - Indexes support the queries used.
   - The migration is additive.

## Non-goals

- Student accounts or logins.
- Anonymous feedback (admins always see the student).
- Feedback about anything other than a teacher (courses, the school).
- Proving who the student is: no roll number, PIN, date of birth or device tracking or blocking. Anyone with the link can pick any name. **Accepted by Ayush for now**, to revisit later. The design shouldn't make adding a check later hard: the submission goes through one service method.
- Notifications to the teacher when feedback arrives.
- Moderation or profanity filtering. Admins can Dismiss entries.
- Importing student feedback through Bulk Upload. Student → Teacher is not added to the importer.
- Links for a whole program or the whole school (one link = one batch).
- Editing or deleting feedback after sending (the student can't).

## Anti-goals: failures even if it "works"

- **Data crossing boundaries.** A link must only ever show and accept its own batch's students and that batch's teachers, in its own school. A submission naming a student or teacher from elsewhere is refused.
- **Leaking more than the form needs.** The public page returns only:
  - school name and batch name;
  - student **id and name** (no roll numbers, contact details or anything else);
  - teacher **id, name and subjects**.
- **The student's identity reaching the teacher** through any API response, export, or a field the UI merely hides.
- **Bypassing the cool-down** by sending two requests at once, or by using a different instance.
- **A switched-off or replaced link still working**, or a link working after its batch or school is deleted.

## Data model (Prisma, additive migration)

**`FeedbackDirection`** gains `STUDENT_TO_TEACHER`.

**`Feedback`** gains three fields:
- `studentId String?`, the student who sent it (student feedback only). It's a composite FK `(studentId, schoolId)` → `Student(id, schoolId)` with `ON DELETE SET NULL ("studentId")`, matching how `senderFacultyId` and `targetFacultyId` work.
- `studentName String?`, the student's name when sent, so the entry still reads right if the student is deleted.
- `batchId String?`, the batch the link was for. It's a composite FK `(batchId, schoolId)` → `Batch(id, schoolId)` with `ON DELETE SET NULL ("batchId")`. A `batchName String?` snapshot sits alongside it.
- The teacher goes in the existing `targetFacultyId` and `targetName`. `toAllFaculty` is false.
- `senderName` holds the student's name, for the admin list.
- New index `@@index([studentId, createdAt])`, used by the cool-down check.

**`FeedbackLink`** (new) has these fields:
- `id`, `schoolId`;
- `batchId`, with a composite FK to `Batch(id, schoolId)` `ON DELETE CASCADE` (a deleted batch's link goes);
- `token String @unique`: 32 random bytes, base64url;
- `active Boolean @default(true)`;
- `createdById String?`, `createdAt`, `updatedAt` (Timestamptz(3), as elsewhere).

It has `@@unique([batchId])` (one link per batch) and `@@index([schoolId])`, and cascades from School.

*My call:* the token is stored as-is, not hashed, so the admin can copy the link again later. It is a capability token. Anyone who can read the database can already read every feedback row, so hashing would add little.

**Migration:**
- One folder, wrapped in `BEGIN; SET LOCAL lock_timeout = '10s'; … COMMIT;` per the repo pattern.
- `ALTER TYPE … ADD VALUE` is fine inside the transaction as long as nothing in the same transaction uses the new value.
- Verified on a scratch database (`migrate deploy` + `migrate diff` empty), then applied to dev.
- Production gets it through the release pipeline. The change is additive, so it's safe under expand/contract.
- **Clear All Data** must also remove a school's `FeedbackLink` rows. Feedback rows already go.

## API

**Admin**, under `schools/:schoolId/feedback/links`, with `assertAdmin` and the school-scoped guards used by the existing feedback controller:

| Method | Path | Does |
|---|---|---|
| GET | `/feedback/links` | Every batch of the school with its link, if any: `{ batchId, batchName, programName, token \| null, active, url }` |
| POST | `/feedback/links` `{ batchId }` | Creates the batch's link, or returns the existing one (idempotent: `@@unique(batchId)` with an upsert) |
| PATCH | `/feedback/links/:batchId` `{ active }` | Switches the link on or off |
| POST | `/feedback/links/:batchId/regenerate` | A new token; the old link stops working |

**Public**, a new controller `public/feedback` with no `SessionGuard`:
- `GET /api/public/feedback/:token` returns `{ schoolName, batchName, students: [{id, name}], teachers: [{id, name, subjects}], cooldownMinutes: 15 }`.
  - Students: ACTIVE students whose `Student.batchId` is the link's batch, sorted by name (*my call*: `Student.batchId`, the student's current batch).
  - Teachers: faculty assigned to the batch (`FacultyBatch`) whose status is not INACTIVE, sorted by name.
  - An unknown token, an inactive link, or a deleted batch all get **404**, with the same body ("This feedback link isn't active").
  - Responses send `Cache-Control: no-store`.
- `POST /api/public/feedback/:token` with `{ studentId, facultyId, rating, comment }`:
  - The DTO is validated with whitelist and `forbidNonWhitelisted`, as the app does everywhere.
  - Rating is an integer 1–5. The comment is trimmed, 10–1,000 characters, with whitespace collapsed.
  - The student must belong to the link's batch and be active. The teacher must be assigned to the batch and not inactive.
  - A student outside the batch gets **400** "Pick your name from the list".
  - A teacher outside the batch gets **400** "Pick a teacher from the list".
  - Success returns **201** `{ ok: true, nextAllowedAt }`. Nothing else comes back: no ids, no names.

**Cool-down (atomic):** in one transaction,
1. `SELECT … FOR UPDATE` on the Student row, serialising that student's submissions across instances;
2. read their latest `STUDENT_TO_TEACHER` feedback `createdAt`;
3. if it's less than 15 minutes ago, respond **429** "You can send feedback again in N minutes" with `retryAfter`;
4. otherwise insert.

**Limits** use the existing durable (Postgres-backed) rate limiter. A whole class often shares one school Wi-Fi or mobile-carrier IP, so the per-IP limit is deliberately loose (*my call*): public GET and POST, 120 requests a minute per IP (`durableThrottle`). The real spam guard is the per-student 15-minute cool-down.

**Admin list and filters:**
- The existing feedback query, KPIs and direction tabs gain `STUDENT_TO_TEACHER`. The **All** tab keeps counting every direction, as it already mixes the two existing ones; the new **Student → Teacher** tab shows student feedback alone (*my call*).
- Admin rows show the student name and batch name.
- The status workflow is unchanged.

**Teacher:** the existing teacher feedback endpoint adds a "From students" list or section. It's `direction STUDENT_TO_TEACHER` with `targetFacultyId` = their profile, and **selects only** `id, rating, content, batchName, feedbackDate, createdAt, status`. It must not select `studentId`, `studentName` or `senderName`.
- It follows the existing `receivedBy` rules (*my call*): **Dismissed entries are hidden from the teacher**, which is the admin's moderation tool for abusive comments. Submitted and Reviewed show immediately. An inactive teacher (`scope.active` false) gets nothing.

## Web

- **Admin Feedback page:**
  - a **"Student feedback links"** panel or dialog listing batches, each with **Create link**, then **Copy link** (with a "Copied" state), a **Switch off / Switch on** toggle, and **Replace link** (with a confirm, since the old link stops working);
  - a new direction tab or filter, **Student → Teacher**;
  - rows showing "*Student name* (Batch) → *Teacher*".
- **Public page** `/feedback/:token`:
  - its own route outside the admin and teacher shells, with no login;
  - mobile-first, single column, the app's styling (the existing auth pages are a good reference);
  - **states:** loading, invalid or inactive link, form, sending, sent ("Thanks! You can send more feedback after 15 minutes"), cooling down (a 429 shows the minutes left), and mismatch error;
  - name and teacher are searchable selects. The page uses the default accent; no per-school theming.
- **Teacher Feedback page:** a "From students" section showing rating, comment, batch and date, with no name.

## Testing

- **Unit:**
  - the DTO;
  - the cool-down maths;
  - the teacher select excludes identity fields.
- **e2e** (shared dev database, unique per-run data):
  - a link per batch;
  - the GET returns only that batch's active students (id and name only) and assigned teachers;
  - a POST with another batch's student or teacher is refused;
  - a valid submission shows in the admin list with the name, and in the teacher list without it;
  - **two concurrent submissions by the same student give exactly one 201 and one 429**;
  - an inactive or replaced link gets 404;
  - deleting the batch makes the link 404, while the feedback stays with `batchName`;
  - Clear All Data removes links.
- **Web:** a public page test for each state, plus a test that the copy-link builds the URL from `window.location.origin`.
- **Migration:** verified on a scratch database before dev; `schema-constraints` e2e covers any new CHECKs.

## Left to the builder

- Exact component split and file names, following the existing feedback feature folders.
- The panel's layout on the Feedback page.
- Whether the public page is lazy-loaded.
