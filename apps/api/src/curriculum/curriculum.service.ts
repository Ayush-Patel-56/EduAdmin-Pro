import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '../generated/prisma/client.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { CURRICULUM_BOARDS, SUBJECTS } from '../academic/academic-options.js';
import type { ImportPreview } from '../academic/import-utils.js';
import { CLASS_OPTIONS } from '../schools/school-options.js';
import {
  CODE_PATTERN,
  type ChapterDto,
  type ConceptDto,
  type CurriculumImportDto,
} from './curriculum.dto.js';

export type MasterFilters = {
  subject?: string;
  board?: string;
  classLevel?: string;
  programId?: string;
};

/** One Master Sheet row: a concept with its chapter's fields (concept fields null for a bare chapter). */
export type MasterRow = {
  chapterId: string;
  subject: string;
  chapterName: string;
  chapterCode: string | null;
  board: string | null;
  classLevel: string | null;
  program: string | null;
  expectedHours: number | null;
  conceptId: string | null;
  conceptName: string | null;
  conceptCode: string | null;
};

const chapterInclude = {
  program: { select: { id: true, name: true } },
  _count: { select: { concepts: true } },
} as const;

type ChapterRow = Prisma.CurriculumChapterGetPayload<{
  include: typeof chapterInclude;
}>;

/** Display order for classes: the school-form order (6th … 12th, 12th Pass, Repeater). */
const classRank = (c: string | null) => {
  const i = c ? CLASS_OPTIONS.indexOf(c as (typeof CLASS_OPTIONS)[number]) : -1;
  return i === -1 ? CLASS_OPTIONS.length : i;
};

/** "11", "11th", "Class 11" -> "11th"; other values matched case-insensitively. */
export function normalizeClass(
  input: string,
  allowed: string[],
): string | null {
  const text = input.trim().replace(/^class\s*/i, '');
  const digits = /^(\d{1,2})(st|nd|rd|th)?$/i.exec(text);
  const candidate = digits ? `${Number(digits[1])}th` : text;
  return (
    allowed.find((c) => c.toLowerCase() === candidate.toLowerCase()) ?? null
  );
}

const naturalKey = (c: {
  subject: string;
  name: string;
  board: string | null;
  classLevel: string | null;
  programId: string | null;
}) =>
  [
    c.subject,
    c.name.toLowerCase(),
    c.board ?? '',
    c.classLevel ?? '',
    c.programId ?? '',
  ].join('|');

@Injectable()
export class CurriculumService {
  constructor(private readonly prisma: PrismaService) {}

  /** Choices for the curriculum forms, from this school's own setup. */
  async options(schoolId: string) {
    const school = await this.prisma.school.findUniqueOrThrow({
      where: { id: schoolId },
      select: {
        classes: true,
        programs: {
          orderBy: { sortOrder: 'asc' },
          select: { id: true, name: true },
        },
      },
    });
    return {
      subjects: SUBJECTS,
      boards: CURRICULUM_BOARDS,
      classes: [...school.classes].sort((a, b) => classRank(a) - classRank(b)),
      programs: school.programs,
    };
  }

  // Chapters

  async listChapters(schoolId: string, subject: string) {
    const chapters = await this.prisma.curriculumChapter.findMany({
      where: { schoolId, subject },
      include: chapterInclude,
    });
    return sortChapters(chapters).map(toChapter);
  }

  async createChapter(schoolId: string, dto: ChapterDto) {
    const data = await this.validateChapter(schoolId, dto);
    const chapter = await this.withCodeCheck(() =>
      this.prisma.curriculumChapter.create({
        data: { schoolId, ...data },
        include: chapterInclude,
      }),
    );
    return toChapter(chapter);
  }

  async updateChapter(schoolId: string, chapterId: string, dto: ChapterDto) {
    const current = await this.findChapter(schoolId, chapterId);
    const data = await this.validateChapter(schoolId, dto, current);
    const chapter = await this.withCodeCheck(() =>
      this.prisma.curriculumChapter.update({
        where: { id: chapterId },
        data,
        include: chapterInclude,
      }),
    );
    return toChapter(chapter);
  }

  /** Deleting a chapter deletes its concepts too. */
  async deleteChapter(schoolId: string, chapterId: string) {
    await this.findChapter(schoolId, chapterId);
    await this.prisma.curriculumChapter.delete({ where: { id: chapterId } });
    return { ok: true };
  }

  // Concepts

  async listConcepts(schoolId: string, chapterId: string) {
    await this.findChapter(schoolId, chapterId);
    return this.prisma.curriculumConcept.findMany({
      where: { schoolId, chapterId },
      orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
      select: { id: true, chapterId: true, name: true, code: true },
    });
  }

  async createConcept(schoolId: string, chapterId: string, dto: ConceptDto) {
    await this.findChapter(schoolId, chapterId);
    await this.assertConceptUnique(schoolId, chapterId, dto);
    const last = await this.prisma.curriculumConcept.findFirst({
      where: { chapterId },
      orderBy: { sortOrder: 'desc' },
      select: { sortOrder: true },
    });
    return this.withCodeCheck(() =>
      this.prisma.curriculumConcept.create({
        data: {
          schoolId,
          chapterId,
          name: dto.name,
          code: dto.code ?? null,
          sortOrder: (last?.sortOrder ?? -1) + 1,
        },
        select: { id: true, chapterId: true, name: true, code: true },
      }),
    );
  }

  async updateConcept(schoolId: string, conceptId: string, dto: ConceptDto) {
    const concept = await this.findConcept(schoolId, conceptId);
    await this.assertConceptUnique(schoolId, concept.chapterId, dto, conceptId);
    return this.withCodeCheck(() =>
      this.prisma.curriculumConcept.update({
        where: { id: conceptId },
        data: { name: dto.name, code: dto.code ?? null },
        select: { id: true, chapterId: true, name: true, code: true },
      }),
    );
  }

  async deleteConcept(schoolId: string, conceptId: string) {
    await this.findConcept(schoolId, conceptId);
    await this.prisma.curriculumConcept.delete({ where: { id: conceptId } });
    return { ok: true };
  }

  // Master sheet

  /**
   * Every chapter and concept as one flat table (PRD: 8 fields). A chapter
   * without concepts still gets one row, with the concept columns empty.
   */
  async master(schoolId: string, filters: MasterFilters) {
    const chapters = await this.prisma.curriculumChapter.findMany({
      where: {
        schoolId,
        ...(filters.subject && { subject: filters.subject }),
        ...(filters.board && { board: filters.board }),
        ...(filters.classLevel && { classLevel: filters.classLevel }),
        ...(filters.programId && { programId: filters.programId }),
      },
      include: {
        ...chapterInclude,
        concepts: {
          orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
          select: { id: true, name: true, code: true },
        },
      },
    });
    const ordered = sortChapters(chapters).sort(
      (a, b) =>
        SUBJECTS.indexOf(a.subject as never) -
        SUBJECTS.indexOf(b.subject as never),
    );
    return ordered.flatMap((c): MasterRow[] => {
      const chapter = {
        chapterId: c.id,
        subject: c.subject,
        chapterName: c.name,
        chapterCode: c.code,
        board: c.board,
        classLevel: c.classLevel,
        program: c.program?.name ?? null,
        expectedHours: c.expectedHours,
      };
      return c.concepts.length === 0
        ? [
            {
              ...chapter,
              conceptId: null,
              conceptName: null,
              conceptCode: null,
            },
          ]
        : c.concepts.map((k) => ({
            ...chapter,
            conceptId: k.id,
            conceptName: k.name,
            conceptCode: k.code,
          }));
    });
  }

  // Import

  /**
   * PRD §7: one row per concept with the chapter columns repeated. Rows of the
   * same chapter (same code, or same subject/name/board/class/program) share
   * one chapter. Existing chapters and concepts are matched and updated with
   * the cells the file fills in; everything else is created. Program must be
   * blank or match one of this school's programs (case-insensitive).
   */
  async import(
    schoolId: string,
    dto: CurriculumImportDto,
  ): Promise<ImportPreview> {
    const [{ classes, programs }, existingChapters] = await Promise.all([
      this.prisma.school.findUniqueOrThrow({
        where: { id: schoolId },
        select: {
          classes: true,
          programs: { select: { id: true, name: true } },
        },
      }),
      this.prisma.curriculumChapter.findMany({
        where: { schoolId },
        include: { concepts: { select: { id: true, name: true, code: true } } },
      }),
    ]);
    const existingConceptCodes = await this.prisma.curriculumConcept.findMany({
      where: { schoolId, code: { not: null } },
      select: { id: true, code: true, chapterId: true },
    });
    const chapterByCode = new Map(
      existingChapters.filter((c) => c.code).map((c) => [c.code!, c]),
    );
    const chapterByKey = new Map(
      existingChapters.map((c) => [naturalKey(c), c]),
    );
    const conceptByCode = new Map(
      existingConceptCodes.map((c) => [c.code!, c]),
    );

    type ChapterPlan = {
      key: string;
      existingId?: string;
      data: {
        subject: string;
        name: string;
        code: string | null;
        board: string | null;
        classLevel: string | null;
        programId: string | null;
        expectedHours: number | null;
      };
    };
    const chapterPlans = new Map<string, ChapterPlan>();
    const planByNatural = new Map<string, string>(); // natural key -> plan key
    const conceptCodeOwner = new Map<string, number>(); // concept code -> row
    const conceptNamesPerChapter = new Map<string, Set<string>>();

    const rows = dto.rows.map((raw, i) => {
      const row = i + 2;
      const errors: string[] = [];
      const text = (v?: string) => v?.trim().replace(/\s+/g, ' ') ?? '';

      const name = text(raw.chapterName);
      if (!name) errors.push('Chapter Name is required');

      const subjectText = dto.subject ?? text(raw.subject);
      const subject = SUBJECTS.find(
        (s) => s.toLowerCase() === subjectText.toLowerCase(),
      );
      if (!subject)
        errors.push(
          subjectText
            ? `Unknown subject "${subjectText}"`
            : 'Subject is required',
        );

      const chapterCode = text(raw.chapterCode).toUpperCase() || null;
      if (chapterCode && !CODE_PATTERN.test(chapterCode))
        errors.push(`Chapter Code "${chapterCode}" is invalid`);

      const boardText = text(raw.board);
      const board = boardText
        ? (CURRICULUM_BOARDS.find(
            (b) => b.toLowerCase() === boardText.toLowerCase(),
          ) ?? null)
        : null;
      if (boardText && !board)
        errors.push(`Board must be one of ${CURRICULUM_BOARDS.join(', ')}`);

      const classText = text(raw.classLevel);
      const classLevel = classText ? normalizeClass(classText, classes) : null;
      if (classText && !classLevel)
        errors.push(`This school doesn't offer class "${classText}"`);

      const programText = text(raw.program);
      const program = programText
        ? programs.find(
            (p) => p.name.toLowerCase() === programText.toLowerCase(),
          )
        : undefined;
      if (programText && !program)
        errors.push(`No program named "${programText}" in this school`);

      const hoursText = text(raw.expectedHours);
      const hours = hoursText
        ? Number(/\d+/.exec(hoursText)?.[0] ?? NaN)
        : null;
      if (
        hoursText &&
        (hours === null || Number.isNaN(hours) || hours > 1000)
      ) {
        errors.push('Expected Hours must be a number');
      }

      const conceptName = text(raw.conceptName);
      const conceptCode = text(raw.conceptCode).toUpperCase() || null;
      if (conceptCode && !conceptName)
        errors.push('Concept Code given without a Concept Name');
      if (conceptCode && !CODE_PATTERN.test(conceptCode))
        errors.push(`Concept Code "${conceptCode}" is invalid`);

      const label = conceptName
        ? `${name || '—'} → ${conceptName}`
        : name || '—';
      if (errors.length > 0)
        return { row, label, action: 'error' as const, errors };

      const data = {
        subject: subject!,
        name,
        code: chapterCode,
        board,
        classLevel,
        programId: program?.id ?? null,
        expectedHours: hours,
      };
      const natural = naturalKey(data);
      // Rows without a code join a coded row of the same chapter earlier in the file.
      const key = chapterCode
        ? `code:${chapterCode}`
        : (planByNatural.get(natural) ?? `key:${natural}`);
      const fail = (message: string) => ({
        row,
        label,
        action: 'error' as const,
        errors: [message],
      });
      if (chapterCode) {
        const other = planByNatural.get(natural);
        if (other && other !== key)
          return fail('Use the same Chapter Code on every row of this chapter');
      }

      let plan = chapterPlans.get(key);
      if (!plan) {
        let match = chapterCode
          ? chapterByCode.get(chapterCode)
          : chapterByKey.get(natural);
        if (chapterCode && !match) {
          // A chapter that exists without a code adopts the code from the file.
          const byKey = chapterByKey.get(natural);
          if (byKey?.code)
            return fail(`This chapter already exists with code ${byKey.code}`);
          match = byKey;
        }
        if (match && match.subject !== data.subject) {
          return fail(
            `Chapter Code ${chapterCode} belongs to a ${match.subject} chapter`,
          );
        }
        plan = { key, existingId: match?.id, data };
        chapterPlans.set(key, plan);
        if (!planByNatural.has(natural)) planByNatural.set(natural, key);
      }

      if (!conceptName) {
        return {
          row,
          label,
          action: plan.existingId ? ('update' as const) : ('create' as const),
          errors,
          planKey: key,
        };
      }

      const names = conceptNamesPerChapter.get(key) ?? new Set<string>();
      if (names.has(conceptName.toLowerCase())) {
        return fail('This concept appears twice for the chapter');
      }
      names.add(conceptName.toLowerCase());
      conceptNamesPerChapter.set(key, names);

      if (conceptCode) {
        const earlier = conceptCodeOwner.get(conceptCode);
        if (earlier) {
          return fail(
            `Concept Code ${conceptCode} is also used on row ${earlier}`,
          );
        }
        conceptCodeOwner.set(conceptCode, row);
        const owner = conceptByCode.get(conceptCode);
        if (owner && owner.chapterId !== plan.existingId) {
          return fail(`Concept Code ${conceptCode} is used by another chapter`);
        }
      }
      const existingChapter = existingChapters.find(
        (c) => c.id === plan.existingId,
      );
      const existingConcept = existingChapter?.concepts.find(
        (k) =>
          (conceptCode && k.code === conceptCode) ||
          k.name.toLowerCase() === conceptName.toLowerCase(),
      );
      return {
        row,
        label,
        action: existingConcept ? ('update' as const) : ('create' as const),
        errors,
        planKey: key,
        concept: {
          planKey: key,
          name: conceptName,
          code: conceptCode,
          existingId: existingConcept?.id,
        },
      };
    });

    if (!dto.dryRun) {
      // Only chapters that a valid row needs are written; a skipped row never creates one.
      const usedKeys = new Set(
        rows
          .filter((r) => r.action !== 'error')
          .map((r) => ('planKey' in r ? r.planKey : '')),
      );
      await this.applyImport(
        schoolId,
        [...chapterPlans.values()].filter((p) => usedKeys.has(p.key)),
        rows,
      );
    }

    return {
      applied: !dto.dryRun,
      created: rows.filter((r) => r.action === 'create').length,
      updated: rows.filter((r) => r.action === 'update').length,
      skipped: rows.filter((r) => r.action === 'error').length,
      rows: rows.map(({ row, label, action, errors }) => ({
        row,
        label,
        action,
        errors,
      })),
    };
  }

  private async applyImport(
    schoolId: string,
    chapterPlans: {
      key: string;
      existingId?: string;
      data: Record<string, unknown> & { name: string };
    }[],
    rows: {
      action: string;
      concept?: {
        planKey: string;
        name: string;
        code: string | null;
        existingId?: string;
      };
    }[],
  ) {
    const validConcepts = rows
      .filter((r) => r.action !== 'error' && r.concept)
      .map((r) => r.concept!);
    await this.prisma.$transaction(
      async (tx) => {
        const chapterIds = new Map<string, string>();
        for (const plan of chapterPlans) {
          if (plan.existingId) {
            // Only cells the file filled in overwrite the existing chapter.
            const data = Object.fromEntries(
              Object.entries(plan.data).filter(
                ([, v]) => v !== null && v !== undefined && v !== '',
              ),
            );
            await tx.curriculumChapter.update({
              where: { id: plan.existingId },
              data,
            });
            chapterIds.set(plan.key, plan.existingId);
          } else {
            const created = await tx.curriculumChapter.create({
              data: { schoolId, ...(plan.data as ChapterCreateData) },
              select: { id: true },
            });
            chapterIds.set(plan.key, created.id);
          }
        }
        const nextOrder = new Map<string, number>();
        for (const concept of validConcepts) {
          const chapterId = chapterIds.get(concept.planKey)!;
          if (concept.existingId) {
            await tx.curriculumConcept.update({
              where: { id: concept.existingId },
              data: {
                name: concept.name,
                ...(concept.code && { code: concept.code }),
              },
            });
            continue;
          }
          if (!nextOrder.has(chapterId)) {
            const last = await tx.curriculumConcept.findFirst({
              where: { chapterId },
              orderBy: { sortOrder: 'desc' },
              select: { sortOrder: true },
            });
            nextOrder.set(chapterId, (last?.sortOrder ?? -1) + 1);
          }
          const sortOrder = nextOrder.get(chapterId)!;
          nextOrder.set(chapterId, sortOrder + 1);
          await tx.curriculumConcept.create({
            data: {
              schoolId,
              chapterId,
              name: concept.name,
              code: concept.code,
              sortOrder,
            },
          });
        }
      },
      { timeout: 120_000, maxWait: 10_000 },
    );
  }

  // Helpers

  private async validateChapter(
    schoolId: string,
    dto: ChapterDto,
    current?: { id: string; classLevel: string | null },
  ) {
    const school = await this.prisma.school.findUniqueOrThrow({
      where: { id: schoolId },
      select: { classes: true },
    });
    const classLevel = dto.classLevel ?? null;
    // A class the school stopped offering stays valid on chapters that already have it.
    if (
      classLevel &&
      !school.classes.includes(classLevel) &&
      classLevel !== current?.classLevel
    ) {
      throw new BadRequestException(
        `This school doesn't offer class ${classLevel}`,
      );
    }
    const programId = dto.programId ?? null;
    if (programId) {
      const program = await this.prisma.program.findFirst({
        where: { id: programId, schoolId },
        select: { id: true },
      });
      if (!program)
        throw new BadRequestException('Select a program from this school');
    }
    const data = {
      subject: dto.subject,
      name: dto.name,
      code: dto.code ?? null,
      board: dto.board ?? null,
      classLevel,
      programId,
      expectedHours: dto.expectedHours ?? null,
    };
    const clash = await this.prisma.curriculumChapter.findFirst({
      where: {
        schoolId,
        subject: data.subject,
        name: { equals: data.name, mode: 'insensitive' },
        board: data.board,
        classLevel: data.classLevel,
        programId: data.programId,
        ...(current && { id: { not: current.id } }),
      },
      select: { id: true },
    });
    if (clash) {
      throw new ConflictException(
        `${data.subject} already has a chapter "${data.name}" for this board, class and program`,
      );
    }
    return data;
  }

  private async assertConceptUnique(
    schoolId: string,
    chapterId: string,
    dto: ConceptDto,
    exceptId?: string,
  ) {
    const clash = await this.prisma.curriculumConcept.findFirst({
      where: {
        schoolId,
        chapterId,
        name: { equals: dto.name, mode: 'insensitive' },
        ...(exceptId && { id: { not: exceptId } }),
      },
      select: { id: true },
    });
    if (clash)
      throw new ConflictException(
        `This chapter already has a concept "${dto.name}"`,
      );
  }

  /** Codes are unique per school; turn the database's unique error into a clear message. */
  private async withCodeCheck<T>(write: () => Promise<T>): Promise<T> {
    try {
      return await write();
    } catch (err) {
      if (
        err instanceof Prisma.PrismaClientKnownRequestError &&
        err.code === 'P2002'
      ) {
        throw new ConflictException('That code is already used in this school');
      }
      throw err;
    }
  }

  private async findChapter(schoolId: string, chapterId: string) {
    // Scoped by school: another school's chapter id is simply "not found".
    const chapter = await this.prisma.curriculumChapter.findFirst({
      where: { id: chapterId, schoolId },
      select: { id: true, classLevel: true },
    });
    if (!chapter) throw new NotFoundException('Chapter not found');
    return chapter;
  }

  private async findConcept(schoolId: string, conceptId: string) {
    const concept = await this.prisma.curriculumConcept.findFirst({
      where: { id: conceptId, schoolId },
      select: { id: true, chapterId: true },
    });
    if (!concept) throw new NotFoundException('Concept not found');
    return concept;
  }
}

type ChapterCreateData = {
  subject: string;
  name: string;
  code: string | null;
  board: string | null;
  classLevel: string | null;
  programId: string | null;
  expectedHours: number | null;
};

function sortChapters<
  T extends { classLevel: string | null; code: string | null; name: string },
>(chapters: T[]) {
  return [...chapters].sort(
    (a, b) =>
      classRank(a.classLevel) - classRank(b.classLevel) ||
      (a.code ?? '￿').localeCompare(b.code ?? '￿', undefined, {
        numeric: true,
      }) ||
      a.name.localeCompare(b.name, undefined, { numeric: true }),
  );
}

function toChapter(c: ChapterRow) {
  return {
    id: c.id,
    subject: c.subject,
    name: c.name,
    code: c.code,
    board: c.board,
    classLevel: c.classLevel,
    program: c.program,
    expectedHours: c.expectedHours,
    conceptCount: c._count.concepts,
  };
}
