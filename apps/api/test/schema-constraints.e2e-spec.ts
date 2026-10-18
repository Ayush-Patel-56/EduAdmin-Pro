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
  ])('%s', async (name, definition) => {
    const [row] = await prisma.$queryRaw<{ def: string }[]>`SELECT pg_get_constraintdef(oid) AS def FROM pg_constraint WHERE conname = ${name}`;
    expect(row?.def).toBe(definition);
  });
});
