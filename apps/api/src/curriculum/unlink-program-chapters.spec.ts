import { ConflictException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import { realUniqueError } from '../common/prisma-errors.fixture.js';
import type { PrismaService } from '../prisma/prisma.service.js';
import type { AccessService } from '../academic/access.service.js';
import { ProgramsService } from '../academic/programs.service.js';
import type { AuthContext } from '../auth/session.guard.js';
import type { CreateSchoolDto } from '../schools/schools.dto.js';
import { SchoolsService } from '../schools/schools.service.js';
import { unlinkProgramChapters } from './unlink-program-chapters.js';

const fluids = (over: Record<string, unknown> = {}) => ({
  subject: 'Physics',
  name: 'Fluids',
  board: 'CBSE',
  classLevel: '11th',
  ...over,
});

// findMany #1: chapters of the removed program(s); #2: program-less chapters.
function txWith(linked: object[], unlinked: object[]) {
  return {
    curriculumChapter: {
      findMany: vi
        .fn()
        .mockResolvedValueOnce(linked)
        .mockResolvedValueOnce(unlinked),
      updateMany: vi.fn().mockResolvedValue({ count: linked.length }),
    },
    program: { delete: vi.fn(), deleteMany: vi.fn(), findMany: vi.fn() },
    school: { update: vi.fn() },
  };
}

describe('unlinkProgramChapters (#8)', () => {
  it('a chapter whose program-less twin exists is a 409 naming it; nothing is unlinked', async () => {
    const tx = txWith([fluids()], [fluids({ name: 'FLUIDS' })]);
    const err = await unlinkProgramChapters(tx as never, 's1', ['p1']).catch(
      (e: unknown) => e,
    );
    expect(err).toBeInstanceOf(ConflictException);
    expect((err as Error).message).toContain('Physics › Fluids (CBSE, 11th)');
    expect(tx.curriculumChapter.updateMany).not.toHaveBeenCalled();
  });

  it('two removed programs holding the same chapter clash with each other', async () => {
    const tx = txWith([fluids(), fluids({ name: 'fluids' })], []);
    await expect(
      unlinkProgramChapters(tx as never, 's1', ['p1', 'p2']),
    ).rejects.toThrow(/Physics › fluids \(CBSE, 11th\)/);
  });

  it('a twin with a different board or class is not a clash', async () => {
    const tx = txWith(
      [fluids()],
      [fluids({ board: 'ICSE' }), fluids({ classLevel: '12th' })],
    );
    await unlinkProgramChapters(tx as never, 's1', ['p1']);
    expect(tx.curriculumChapter.updateMany).toHaveBeenCalledWith({
      where: { schoolId: 's1', programId: { in: ['p1'] } },
      data: { programId: null },
    });
  });

  it('only looks at this school', async () => {
    const tx = txWith([fluids()], []);
    await unlinkProgramChapters(tx as never, 's1', ['p1']);
    for (const [args] of tx.curriculumChapter.findMany.mock.calls)
      expect(args.where.schoolId).toBe('s1');
  });

  it('a twin created concurrently (unique index) is still a 409', async () => {
    const tx = txWith([fluids()], []);
    tx.curriculumChapter.updateMany.mockRejectedValue(
      realUniqueError('CurriculumChapter_natural_key', 'CurriculumChapter'),
    );
    await expect(
      unlinkProgramChapters(tx as never, 's1', ['p1']),
    ).rejects.toBeInstanceOf(ConflictException);
  });
});

describe('both ways of removing a program use it', () => {
  it('DELETE programs/:id: 409 and the program is kept', async () => {
    const tx = txWith([fluids()], [fluids()]);
    const prisma = {
      program: {
        findFirst: vi.fn().mockResolvedValue({ id: 'p1', name: 'JEE' }),
      },
      batch: { count: vi.fn().mockResolvedValue(0) },
      $transaction: vi.fn((fn: (t: typeof tx) => unknown) => fn(tx)),
    } as unknown as PrismaService;
    await expect(
      new ProgramsService(prisma).remove('s1', 'p1'),
    ).rejects.toThrow(/Physics › Fluids/);
    expect(tx.program.delete).not.toHaveBeenCalled();
  });

  it('Edit School leaving a program out: 409 and nothing is deleted', async () => {
    const tx = txWith([fluids()], [fluids()]);
    tx.program.findMany.mockResolvedValue([
      { id: 'p1', name: 'JEE', sortOrder: 0, _count: { batches: 0 } },
    ]);
    const prisma = {
      $transaction: vi.fn((fn: (t: typeof tx) => unknown) => fn(tx)),
    } as unknown as PrismaService;
    const access = { assertOwner: vi.fn() } as unknown as AccessService;
    await expect(
      new SchoolsService(prisma, access, {} as never).updateSchool(
        { userId: 'u1' } as AuthContext,
        's1',
        {
          name: 'S',
          board: 'CBSE',
          classes: ['11th'],
          programs: [],
        } as CreateSchoolDto,
      ),
    ).rejects.toThrow(/Physics › Fluids/);
    expect(tx.program.deleteMany).not.toHaveBeenCalled();
    expect(tx.school.update).not.toHaveBeenCalled();
  });
});
