import type { PrismaService } from '../prisma/prisma.service.js';

/**
 * Programs and batches of one school for the sidebar filters, optionally
 * narrowed to a teacher's assignments. Batches carry their programId so the
 * Batch filter can follow the Program filter.
 */
export async function loadStructure(
  prisma: PrismaService,
  schoolId: string,
  scope?: { programIds: string[]; batchIds: string[] },
) {
  const [programs, batches] = await Promise.all([
    prisma.program.findMany({
      where: { schoolId, ...(scope && { id: { in: scope.programIds } }) },
      orderBy: { sortOrder: 'asc' },
      select: { id: true, name: true, isActive: true, themeColor: true },
    }),
    prisma.batch.findMany({
      where: { schoolId, ...(scope && { id: { in: scope.batchIds } }) },
      orderBy: [{ startDate: 'desc' }, { name: 'asc' }],
      select: { id: true, name: true, programId: true, classLevel: true },
    }),
  ]);
  return { programs, batches };
}
