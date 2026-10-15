import { BadRequestException, ConflictException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import type { PrismaService } from '../prisma/prisma.service.js';
import type { BatchDto } from './academic.dto.js';
import { BatchesService } from './batches.service.js';
import { ProgramsService } from './programs.service.js';

// #24: deleting a program while a batch is created in it used to answer 500
// (a foreign-key error) on one side. Both sides now lock the program row.

const sqlOf = (call: unknown[]) => (call[0] as TemplateStringsArray).join('?');

describe('ProgramsService.remove: batches are counted under the program lock', () => {
  const build = (batches: number) => {
    const tx = {
      $queryRaw: vi.fn().mockResolvedValue([]),
      batch: { count: vi.fn().mockResolvedValue(batches) },
      feeStructure: { count: vi.fn().mockResolvedValue(0) },
      curriculumChapter: { findMany: vi.fn().mockResolvedValue([]), updateMany: vi.fn() },
      student: { updateMany: vi.fn() },
      program: { delete: vi.fn() },
    };
    const prisma = {
      program: { findFirst: vi.fn().mockResolvedValue({ id: 'p1', name: 'JEE' }) },
      batch: { count: vi.fn().mockResolvedValue(0) }, // a stale count outside the lock must not be trusted
      $transaction: vi.fn((fn: (t: typeof tx) => unknown) => fn(tx)),
    } as unknown as PrismaService;
    return { tx, programs: new ProgramsService(prisma) };
  };

  it('a batch that appeared meanwhile is a 409, and the program is kept', async () => {
    const { tx, programs } = build(1);
    await expect(programs.remove('s1', 'p1')).rejects.toEqual(new ConflictException('JEE has 1 batch. Delete or move them first.'));
    expect(sqlOf(tx.$queryRaw.mock.calls[0])).toMatch(/FROM "Program".*FOR UPDATE/);
    expect(tx.$queryRaw.mock.invocationCallOrder[0]).toBeLessThan(tx.batch.count.mock.invocationCallOrder[0]);
    expect(tx.batch.count.mock.calls[0][0]).toEqual({ where: { schoolId: 's1', programId: 'p1' } });
    expect(tx.program.delete).not.toHaveBeenCalled();
  });

  it('with no batches it is deleted', async () => {
    const { tx, programs } = build(0);
    await expect(programs.remove('s1', 'p1')).resolves.toEqual({ ok: true });
    expect(tx.program.delete).toHaveBeenCalledWith({ where: { id: 'p1' } });
  });
});

describe('BatchesService: a batch locks its program before joining it', () => {
  const build = (programLeft: boolean) => {
    const tx = {
      $queryRaw: vi.fn().mockResolvedValue(programLeft ? [{ '?column?': 1 }] : []),
      batch: { create: vi.fn().mockResolvedValue({ id: 'b1' }), update: vi.fn() },
    };
    const prisma = {
      program: { findFirst: vi.fn().mockResolvedValue({ id: 'p2', name: 'NEET' }) },
      batch: { findFirst: vi.fn().mockResolvedValue(null) },
      faculty: { findFirst: vi.fn() },
      $transaction: vi.fn((fn: (t: typeof tx) => unknown) => fn(tx)),
    } as unknown as PrismaService;
    return { tx, prisma, batches: new BatchesService(prisma) };
  };
  const dto = { name: 'Morning', programId: 'p2', startDate: '2026-04-01' } as BatchDto;

  it('create: locks the program FOR SHARE, in this school, before inserting', async () => {
    const { tx, batches } = build(true);
    await expect(batches.create('s1', dto)).resolves.toEqual({ id: 'b1' });
    const [sql, ...values] = tx.$queryRaw.mock.calls[0] as [TemplateStringsArray, ...unknown[]];
    expect(sql.join('?')).toMatch(/FROM "Program".*FOR SHARE/);
    expect(values).toEqual(['p2', 's1']);
    expect(tx.$queryRaw.mock.invocationCallOrder[0]).toBeLessThan(tx.batch.create.mock.invocationCallOrder[0]);
  });

  it('create: a program deleted meanwhile is a 400, not a foreign-key 500', async () => {
    const { tx, batches } = build(false);
    await expect(batches.create('s1', dto)).rejects.toEqual(new BadRequestException('Select a program from this school'));
    expect(tx.batch.create).not.toHaveBeenCalled();
  });

  it('update: moving to another program locks it first; staying in the same one does not', async () => {
    const { tx, prisma, batches } = build(false);
    (prisma.batch.findFirst as ReturnType<typeof vi.fn>).mockResolvedValueOnce({ id: 'b1', programId: 'p1', coordinatorId: null });
    await expect(batches.update('s1', 'b1', dto)).rejects.toBeInstanceOf(BadRequestException);
    expect(tx.batch.update).not.toHaveBeenCalled();

    tx.$queryRaw.mockClear();
    (prisma.batch.findFirst as ReturnType<typeof vi.fn>).mockResolvedValueOnce({ id: 'b1', programId: 'p2', coordinatorId: null });
    await batches.update('s1', 'b1', dto);
    expect(tx.$queryRaw).not.toHaveBeenCalled();
    expect(tx.batch.update).toHaveBeenCalled();
  });
});

describe('event counts for the delete confirmations (#22)', () => {
  it('programs list how many calendar events each has', async () => {
    const findMany = vi.fn().mockResolvedValue([
      { id: 'p1', name: 'JEE', code: null, type: 'OTHER', targetExams: [], durationYears: null, themeColor: 'BLUE', isActive: true, _count: { batches: 2, facultyPrograms: 1, calendarEvents: 3 } },
    ]);
    const programs = new ProgramsService({ program: { findMany } } as unknown as PrismaService);
    const [p] = await programs.list('s1');
    expect(p).toMatchObject({ batchCount: 2, facultyCount: 1, eventCount: 3 });
    expect(findMany.mock.calls[0][0].include._count.select.calendarEvents).toBe(true);
  });

  it('batches list how many calendar events each has', async () => {
    const findMany = vi.fn().mockResolvedValue([
      {
        id: 'b1', name: 'M1', program: null, classLevel: 11, capacity: 30, startDate: new Date('2026-04-01T00:00:00Z'), endDate: null, coordinator: null,
        _count: { facultyBatches: 0, syllabusItems: 0, students: 4, materials: 0, assignments: 0, calendarEvents: 5 },
      },
    ]);
    const batches = new BatchesService({ batch: { findMany } } as unknown as PrismaService);
    const [b] = await batches.list('s1');
    expect(b).toMatchObject({ studentCount: 4, eventCount: 5 });
    expect(findMany.mock.calls[0][0].include._count.select.calendarEvents).toBe(true);
  });
});
