import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../src/generated/prisma/client.js';

/**
 * Constraints Prisma can't express, checked on the migrated database. Prisma
 * writes `ON DELETE SET NULL` for these school-tied keys and would null
 * schoolId too; the migrations narrow it to one column. `migrate diff` can't
 * see the difference, so a later regenerated migration could drop the column
 * list silently (and deleting a batch would then fail on schoolId NOT NULL).
 */
describe('school-tied foreign keys keep their SET NULL column list (e2e)', () => {
  const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL! }) });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it.each([
    ['PtmNote_batchId_schoolId_fkey', 'FOREIGN KEY ("batchId", "schoolId") REFERENCES "Batch"(id, "schoolId") ON UPDATE CASCADE ON DELETE SET NULL ("batchId")'],
    ['PtmNote_facultyId_schoolId_fkey', 'FOREIGN KEY ("facultyId", "schoolId") REFERENCES "Faculty"(id, "schoolId") ON UPDATE CASCADE ON DELETE SET NULL ("facultyId")'],
    ['Question_facultyId_schoolId_fkey', 'FOREIGN KEY ("facultyId", "schoolId") REFERENCES "Faculty"(id, "schoolId") ON UPDATE CASCADE ON DELETE SET NULL ("facultyId")'],
    ['Test_facultyId_schoolId_fkey', 'FOREIGN KEY ("facultyId", "schoolId") REFERENCES "Faculty"(id, "schoolId") ON UPDATE CASCADE ON DELETE SET NULL ("facultyId")'],
    ['TestQuestion_questionId_schoolId_fkey', 'FOREIGN KEY ("questionId", "schoolId") REFERENCES "Question"(id, "schoolId") ON UPDATE CASCADE ON DELETE SET NULL ("questionId")'],
    ['Feedback_senderFacultyId_schoolId_fkey', 'FOREIGN KEY ("senderFacultyId", "schoolId") REFERENCES "Faculty"(id, "schoolId") ON UPDATE CASCADE ON DELETE SET NULL ("senderFacultyId")'],
    ['Feedback_targetFacultyId_schoolId_fkey', 'FOREIGN KEY ("targetFacultyId", "schoolId") REFERENCES "Faculty"(id, "schoolId") ON UPDATE CASCADE ON DELETE SET NULL ("targetFacultyId")'],
    ['DailyReport_facultyId_schoolId_fkey', 'FOREIGN KEY ("facultyId", "schoolId") REFERENCES "Faculty"(id, "schoolId") ON UPDATE CASCADE ON DELETE SET NULL ("facultyId")'],
    ['DailyRating_batchId_schoolId_fkey', 'FOREIGN KEY ("batchId", "schoolId") REFERENCES "Batch"(id, "schoolId") ON UPDATE CASCADE ON DELETE SET NULL ("batchId")'],
    ['DailyRating_facultyId_schoolId_fkey', 'FOREIGN KEY ("facultyId", "schoolId") REFERENCES "Faculty"(id, "schoolId") ON UPDATE CASCADE ON DELETE SET NULL ("facultyId")'],
    ['Assignment_chapterId_schoolId_fkey', 'FOREIGN KEY ("chapterId", "schoolId") REFERENCES "CurriculumChapter"(id, "schoolId") ON UPDATE CASCADE ON DELETE SET NULL ("chapterId")'],
  ])('%s', async (name, definition) => {
    const [row] = await prisma.$queryRaw<{ def: string }[]>`SELECT pg_get_constraintdef(oid) AS def FROM pg_constraint WHERE conname = ${name}`;
    expect(row?.def).toBe(definition);
  });

  it('no school-tied key nulls schoolId (every SET NULL on a composite school key names its column)', async () => {
    const rows = await prisma.$queryRaw<{ name: string }[]>`
      SELECT conname AS name FROM pg_constraint
      WHERE contype = 'f' AND pg_get_constraintdef(oid) LIKE '%"schoolId") REFERENCES%' AND pg_get_constraintdef(oid) LIKE '%ON DELETE SET NULL'`;
    expect(rows.map((r) => r.name)).toEqual([]);
  });
});

/** CHECKs Prisma can't express: the student reports (HLD 8.3: rating levels, report-import rules) and profile pictures. */
describe('student report CHECK constraints (e2e)', () => {
  const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL! }) });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it.each([
    ['DailyRating_levels_check', 'CHECK ((((attitude >= 1) AND (attitude <= 5)) AND ((behaviour >= 1) AND (behaviour <= 5)) AND ((focus >= 1) AND (focus <= 5)) AND ((interaction >= 1) AND (interaction <= 5))))'],
    ['StudentMark_marks_check', 'CHECK ((("maxMarks" > (0)::numeric) AND (marks >= (0)::numeric) AND (marks <= "maxMarks")))'],
    ['StudentMark_attendance_check', 'CHECK (((attendance IS NULL) OR ((attendance >= (0)::numeric) AND (attendance <= (100)::numeric))))'],
    ['StudentMark_year_check', 'CHECK ((("academicYear" >= 2000) AND ("academicYear" <= 2100)))'],
    ['ProgressReport_year_check', 'CHECK ((("academicYear" >= 2000) AND ("academicYear" <= 2100)))'],
    ['UserAvatar_image_check', "CHECK (((\"contentType\" = ANY (ARRAY['image/jpeg'::text, 'image/png'::text, 'image/webp'::text])) AND ((octet_length(data) >= 1) AND (octet_length(data) <= 262144))))"],
    ['User_avatarUrl_check', "CHECK (((\"avatarUrl\" IS NULL) OR ((\"avatarUrl\" ~~ 'https://%'::text) AND (length(\"avatarUrl\") <= 500))))"],
  ])('%s', async (name, definition) => {
    const [row] = await prisma.$queryRaw<{ def: string }[]>`SELECT pg_get_constraintdef(oid) AS def FROM pg_constraint WHERE conname = ${name}`;
    expect(row?.def).toBe(definition);
  });
});
