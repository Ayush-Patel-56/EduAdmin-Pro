import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { Prisma } from '../generated/prisma/client.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { parseDate, toIsoDate } from '../common/dates.js';
import type { BatchDto } from './academic.dto.js';
import { duplicateAsConflict } from '../common/unique-violation.js';

type Tx = Prisma.TransactionClient;

@Injectable()
export class BatchesService {
  constructor(private readonly prisma: PrismaService) {}

  async list(schoolId: string, programId?: string) {
    const batches = await this.prisma.batch.findMany({
      where: { schoolId, ...(programId && { programId }) },
      orderBy: [{ startDate: 'desc' }, { name: 'asc' }],
      include: {
        program: { select: { id: true, name: true, themeColor: true } },
        coordinator: { select: { id: true, name: true } },
        _count: { select: { facultyBatches: true, syllabusItems: true } },
      },
    });
    return batches.map((b) => ({
      id: b.id,
      name: b.name,
      program: b.program,
      classLevel: b.classLevel,
      capacity: b.capacity,
      startDate: toIsoDate(b.startDate),
      endDate: toIsoDate(b.endDate),
      coordinator: b.coordinator,
      facultyCount: b._count.facultyBatches,
      chapterCount: b._count.syllabusItems,
    }));
  }

  async create(schoolId: string, dto: BatchDto) {
    const data = await this.validate(schoolId, dto);
    return duplicateAsConflict(
      () =>
        this.prisma.$transaction(async (tx) => {
          const batch = await tx.batch.create({ data: { schoolId, ...data } });
          if (data.coordinatorId)
            await assignFaculty(
              tx,
              schoolId,
              data.coordinatorId,
              batch.id,
              data.programId,
            );
          return { id: batch.id };
        }),
      batchClash(dto),
    );
  }

  async update(schoolId: string, batchId: string, dto: BatchDto) {
    const current = await this.find(schoolId, batchId);
    const data = await this.validate(schoolId, dto, batchId);
    return duplicateAsConflict(
      () =>
        this.prisma.$transaction(async (tx) => {
          await tx.batch.update({ where: { id: batchId }, data });
          if (
            data.coordinatorId &&
            data.coordinatorId !== current.coordinatorId
          ) {
            await assignFaculty(
              tx,
              schoolId,
              data.coordinatorId,
              batchId,
              data.programId,
            );
          }
          if (data.programId !== current.programId) {
            // Teachers of a moved batch now teach in its new program as well.
            const teachers = await tx.facultyBatch.findMany({
              where: { batchId },
              select: { facultyId: true },
            });
            await tx.facultyProgram.createMany({
              data: teachers.map((t) => ({
                facultyId: t.facultyId,
                programId: data.programId,
                schoolId,
              })),
              skipDuplicates: true,
            });
            // ...and no longer in the old one unless another batch keeps them there.
            await pruneFacultyPrograms(
              tx,
              schoolId,
              current.programId,
              teachers.map((t) => t.facultyId),
            );
          }
          return { id: batchId };
        }),
      batchClash(dto),
    );
  }

  /**
   * Deleting a batch also removes its syllabus chapters, teacher assignments
   * and enrollment history; its students stay in the program, unassigned.
   */
  async remove(schoolId: string, batchId: string) {
    const batch = await this.find(schoolId, batchId);
    await this.prisma.$transaction(async (tx) => {
      const teachers = await tx.facultyBatch.findMany({
        where: { batchId },
        select: { facultyId: true },
      });
      await tx.student.updateMany({
        where: { schoolId, batchId },
        data: { batchId: null },
      });
      await tx.batch.delete({ where: { id: batchId } });
      await pruneFacultyPrograms(
        tx,
        schoolId,
        batch.programId,
        teachers.map((t) => t.facultyId),
      );
    });
    return { ok: true };
  }

  private async find(schoolId: string, batchId: string) {
    const batch = await this.prisma.batch.findFirst({
      where: { id: batchId, schoolId },
    });
    if (!batch) throw new NotFoundException('Batch not found');
    return batch;
  }

  private async validate(schoolId: string, dto: BatchDto, exceptId?: string) {
    const startDate = parseDate(dto.startDate, 'Start date');
    const endDate = dto.endDate ? parseDate(dto.endDate, 'End date') : null;
    if (endDate && endDate < startDate)
      throw new BadRequestException(
        'End date must be on or after the start date',
      );

    // Both lookups are scoped to this school, so ids from another school fail here
    // (and the composite foreign keys would reject them anyway).
    const program = await this.prisma.program.findFirst({
      where: { id: dto.programId, schoolId },
      select: { id: true, name: true },
    });
    if (!program)
      throw new BadRequestException('Select a program from this school');
    if (dto.coordinatorId) {
      const coordinator = await this.prisma.faculty.findFirst({
        where: { id: dto.coordinatorId, schoolId },
        select: { id: true },
      });
      if (!coordinator)
        throw new BadRequestException(
          'Select a coordinator from this school’s faculty',
        );
    }
    const clash = await this.prisma.batch.findFirst({
      where: {
        programId: program.id,
        name: { equals: dto.name, mode: 'insensitive' },
        ...(exceptId && { id: { not: exceptId } }),
      },
      select: { id: true },
    });
    if (clash)
      throw new ConflictException(
        `${program.name} already has a batch named ${dto.name}`,
      );

    return {
      programId: program.id,
      name: dto.name,
      classLevel: dto.classLevel ?? null,
      capacity: dto.capacity,
      startDate,
      endDate,
      coordinatorId: dto.coordinatorId ?? null,
    };
  }
}

/**
 * Puts a teacher on a batch (keeping an existing role) and on its program,
 * per the PRD: assigning a coordinator or a batch also assigns the program.
 */
export async function assignFaculty(
  tx: Tx,
  schoolId: string,
  facultyId: string,
  batchId: string,
  programId: string,
) {
  await tx.facultyBatch.upsert({
    where: { facultyId_batchId: { facultyId, batchId } },
    create: { facultyId, batchId, schoolId, role: 'PRIMARY' },
    update: {},
  });
  await tx.facultyProgram.upsert({
    where: { facultyId_programId: { facultyId, programId } },
    create: { facultyId, programId, schoolId },
    update: {},
  });
}

/**
 * Teachers get access to a program through its batches. Once none of a
 * teacher's batches is in `programId` any more, drop that program from them,
 * so access doesn't pile up as batches move or close.
 */
export async function pruneFacultyPrograms(
  tx: Tx,
  schoolId: string,
  programId: string,
  facultyIds: string[],
) {
  if (facultyIds.length === 0) return;
  const stillThere = await tx.facultyBatch.findMany({
    where: { facultyId: { in: facultyIds }, batch: { programId } },
    select: { facultyId: true },
  });
  const keep = new Set(stillThere.map((r) => r.facultyId));
  const drop = facultyIds.filter((id) => !keep.has(id));
  if (drop.length === 0) return;
  await tx.facultyProgram.deleteMany({
    where: { schoolId, programId, facultyId: { in: drop } },
  });
}

/** 409 message for a unique-index violation while saving a batch. */
export function batchClash(dto: { name: string }) {
  return (names: string[]) =>
    names.some((n) => n === 'name' || n.startsWith('Batch_'))
      ? `This program already has a batch named ${dto.name}`
      : 'Someone else changed this batch at the same time. Refresh and try again.';
}
