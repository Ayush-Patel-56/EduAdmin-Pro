import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { STANDARD_PROGRAMS } from '../schools/school-options.js';
import type { ProgramDto } from './academic.dto.js';

@Injectable()
export class ProgramsService {
  constructor(private readonly prisma: PrismaService) {}

  async list(schoolId: string) {
    const programs = await this.prisma.program.findMany({
      where: { schoolId },
      orderBy: { sortOrder: 'asc' },
      include: { _count: { select: { batches: true, facultyPrograms: true } } },
    });
    return programs.map(({ _count, ...p }) => ({
      id: p.id,
      name: p.name,
      code: p.code,
      type: p.type,
      targetExams: p.targetExams,
      durationYears: p.durationYears,
      themeColor: p.themeColor,
      isActive: p.isActive,
      batchCount: _count.batches,
      facultyCount: _count.facultyPrograms,
    }));
  }

  async create(schoolId: string, dto: ProgramDto) {
    await this.assertUnique(schoolId, dto);
    const last = await this.prisma.program.findFirst({
      where: { schoolId },
      orderBy: { sortOrder: 'desc' },
      select: { sortOrder: true },
    });
    const program = await this.prisma.program.create({
      data: {
        schoolId,
        ...this.fields(dto),
        isStandard: STANDARD_PROGRAMS.some(
          (s) => s.toLowerCase() === dto.name.toLowerCase(),
        ),
        sortOrder: (last?.sortOrder ?? -1) + 1,
      },
    });
    return { id: program.id };
  }

  async update(schoolId: string, programId: string, dto: ProgramDto) {
    await this.find(schoolId, programId);
    await this.assertUnique(schoolId, dto, programId);
    await this.prisma.program.update({
      where: { id: programId },
      data: this.fields(dto),
    });
    return { id: programId };
  }

  /** Batches depend on their program, so a program with batches can't be deleted. */
  async remove(schoolId: string, programId: string) {
    const program = await this.find(schoolId, programId);
    const batches = await this.prisma.batch.count({
      where: { schoolId, programId },
    });
    if (batches > 0) {
      throw new ConflictException(
        `${program.name} has ${batches} batch${batches === 1 ? '' : 'es'}. Delete or move them first.`,
      );
    }
    // Curriculum chapters may name a program optionally; they stay, unlinked.
    await this.prisma.$transaction([
      this.prisma.curriculumChapter.updateMany({
        where: { schoolId, programId },
        data: { programId: null },
      }),
      this.prisma.program.delete({ where: { id: programId } }),
    ]);
    return { ok: true };
  }

  private fields(dto: ProgramDto) {
    return {
      name: dto.name,
      code: dto.code ?? null,
      type: dto.type,
      targetExams: dedupe(dto.targetExams),
      durationYears: dto.durationYears ?? null,
      themeColor: dto.themeColor,
      isActive: dto.isActive,
    };
  }

  private async find(schoolId: string, programId: string) {
    // Scoped by school: another school's program id is simply "not found".
    const program = await this.prisma.program.findFirst({
      where: { id: programId, schoolId },
    });
    if (!program) throw new NotFoundException('Program not found');
    return program;
  }

  private async assertUnique(
    schoolId: string,
    dto: ProgramDto,
    exceptId?: string,
  ) {
    const clash = await this.prisma.program.findFirst({
      where: {
        schoolId,
        ...(exceptId && { id: { not: exceptId } }),
        OR: [
          { name: { equals: dto.name, mode: 'insensitive' } },
          ...(dto.code ? [{ code: dto.code }] : []),
        ],
      },
      select: { name: true, code: true },
    });
    if (!clash) return;
    if (clash.name.toLowerCase() === dto.name.toLowerCase()) {
      throw new ConflictException(
        `A program named ${clash.name} already exists`,
      );
    }
    throw new ConflictException(
      `Code ${dto.code} is already used by ${clash.name}`,
    );
  }
}

function dedupe(values: string[]) {
  const seen = new Set<string>();
  return values.filter((v) => {
    const key = v.toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
