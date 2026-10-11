import { ConflictException } from '@nestjs/common';
import type { Prisma } from '../generated/prisma/client.js';
import { duplicateAsConflict } from '../common/unique-violation.js';

type Chapter = {
  subject: string;
  name: string;
  board: string | null;
  classLevel: string | null;
};

// Same columns as the CurriculumChapter_natural_key index, with no program.
const unlinkedKey = (c: Chapter) =>
  [c.subject, c.name.toLowerCase(), c.board ?? '', c.classLevel ?? ''].join(
    '|',
  );

export const chapterLabel = (c: Chapter) => {
  const details = [c.board, c.classLevel].filter(Boolean).join(', ');
  return `${c.subject} › ${c.name}${details ? ` (${details})` : ''}`;
};

/**
 * Removing a program keeps its curriculum chapters, without a program. A
 * chapter whose program-less twin (same subject, name, board and class)
 * already exists, or two removed programs' copies of one chapter, would
 * break the chapter uniqueness index; that is a 409 naming the chapters
 * instead of a 500. Must run inside the transaction that deletes the program.
 */
export async function unlinkProgramChapters(
  tx: Prisma.TransactionClient,
  schoolId: string,
  programIds: string[],
): Promise<void> {
  const linked = await tx.curriculumChapter.findMany({
    where: { schoolId, programId: { in: programIds } },
    select: { subject: true, name: true, board: true, classLevel: true },
    orderBy: [{ subject: 'asc' }, { name: 'asc' }],
  });
  if (linked.length === 0) return;

  const unlinked = await tx.curriculumChapter.findMany({
    where: {
      schoolId,
      programId: null,
      OR: linked.map((c) => ({
        subject: c.subject,
        name: { equals: c.name, mode: 'insensitive' as const },
      })),
    },
    select: { subject: true, name: true, board: true, classLevel: true },
  });
  const taken = new Set(unlinked.map(unlinkedKey));
  const clashes = new Map<string, Chapter>();
  for (const c of linked) {
    const key = unlinkedKey(c);
    if (taken.has(key)) clashes.set(key, c);
    taken.add(key);
  }
  if (clashes.size > 0) {
    const labels = [...clashes.values()].map(chapterLabel);
    const shown = labels.slice(0, 5).join('; ');
    const more = labels.length > 5 ? ` and ${labels.length - 5} more` : '';
    throw new ConflictException(
      `Can't remove the program: its curriculum chapters are kept without a program, and these would then duplicate existing chapters: ${shown}${more}. Rename or delete one copy of each in Curriculum first.`,
    );
  }

  await duplicateAsConflict(
    () =>
      tx.curriculumChapter.updateMany({
        where: { schoolId, programId: { in: programIds } },
        data: { programId: null },
      }),
    'A curriculum chapter was added while removing the program and would now be a duplicate. Refresh and try again.',
  );
}
