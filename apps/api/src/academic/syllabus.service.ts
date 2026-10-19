import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { SyllabusStatus } from '../generated/prisma/client.js';
import { PrismaService } from '../prisma/prisma.service.js';
import type { SyllabusImportDto, SyllabusItemDto } from './academic.dto.js';
import { SUBJECTS } from './academic-options.js';
import type { ImportPreview } from './import-utils.js';
import { duplicateAsConflict } from '../common/unique-violation.js';
import { NotificationsService } from '../notifications/notifications.service.js';

const CHAPTER_EXISTS =
  'A chapter with this title already exists for this batch and subject (or it was just added by someone else). Refresh and try again.';

/** Batches a teacher may work on; `null` means an admin (every batch in the school). */
export type BatchScope = string[] | null;

const STATUS_ALIASES: Record<string, SyllabusStatus> = {
  NOTSTARTED: 'NOT_STARTED',
  PENDING: 'NOT_STARTED',
  TODO: 'NOT_STARTED',
  INPROGRESS: 'IN_PROGRESS',
  ONGOING: 'IN_PROGRESS',
  STARTED: 'IN_PROGRESS',
  COMPLETED: 'COMPLETED',
  COMPLETE: 'COMPLETED',
  DONE: 'COMPLETED',
};

const itemSelect = {
  id: true,
  batchId: true,
  subject: true,
  title: true,
  estimatedHours: true,
  targetDates: true,
  status: true,
  remarks: true,
  updatedAt: true,
} as const;

@Injectable()
export class SyllabusService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationsService,
  ) {}

  /** A batch's chapters, for one subject or (for exports) all of them. */
  async list(
    schoolId: string,
    scope: BatchScope,
    batchId: string,
    subject?: string,
  ) {
    await this.assertBatch(schoolId, scope, batchId);
    return this.prisma.syllabusItem.findMany({
      where: { schoolId, batchId, ...(subject && { subject }) },
      orderBy: [{ subject: 'asc' }, { createdAt: 'asc' }],
      select: itemSelect,
    });
  }

  async create(
    schoolId: string,
    scope: BatchScope,
    userId: string,
    dto: SyllabusItemDto,
  ) {
    await this.assertBatch(schoolId, scope, dto.batchId);
    return duplicateAsConflict(
      () =>
        this.prisma.syllabusItem.create({
          data: {
            schoolId,
            ...fields(dto),
            createdById: userId,
            updatedById: userId,
          },
          select: itemSelect,
        }),
      CHAPTER_EXISTS,
    );
  }

  async update(
    schoolId: string,
    scope: BatchScope,
    userId: string,
    itemId: string,
    dto: SyllabusItemDto,
  ) {
    const before = await this.find(schoolId, scope, itemId);
    await this.assertBatch(schoolId, scope, dto.batchId);
    const item = await duplicateAsConflict(
      () =>
        this.prisma.syllabusItem.update({
          where: { id: itemId },
          data: { ...fields(dto), updatedById: userId },
          select: itemSelect,
        }),
      CHAPTER_EXISTS,
    );
    if (item.status !== before.status) await this.notifications.syllabusChanged(schoolId, userId, [item]);
    return item;
  }

  /** Moving a card between Kanban columns. */
  async setStatus(
    schoolId: string,
    scope: BatchScope,
    userId: string,
    itemId: string,
    status: SyllabusStatus,
  ) {
    const before = await this.find(schoolId, scope, itemId);
    const item = await this.prisma.syllabusItem.update({
      where: { id: itemId },
      data: { status, updatedById: userId },
      select: itemSelect,
    });
    if (status !== before.status) await this.notifications.syllabusChanged(schoolId, userId, [item]);
    return item;
  }

  async remove(schoolId: string, scope: BatchScope, itemId: string) {
    await this.find(schoolId, scope, itemId);
    await this.prisma.syllabusItem.delete({ where: { id: itemId } });
    return { ok: true };
  }

  /**
   * Bulk import. Each row resolves its batch from the chosen context or the
   * Batch/Program columns, always within this school. A row naming another
   * school is rejected so data never lands in the wrong tenant. A chapter that
   * already exists (same batch, subject and title) is updated instead of duplicated.
   */
  async import(
    schoolId: string,
    scope: BatchScope,
    userId: string,
    dto: SyllabusImportDto,
  ): Promise<ImportPreview> {
    const [school, batches] = await Promise.all([
      this.prisma.school.findUniqueOrThrow({
        where: { id: schoolId },
        select: { name: true },
      }),
      this.prisma.batch.findMany({
        where: { schoolId, ...(scope && { id: { in: scope } }) },
        select: {
          id: true,
          name: true,
          programId: true,
          program: { select: { name: true } },
        },
      }),
    ]);
    const { defaults } = dto;
    if (defaults.batchId && !batches.some((b) => b.id === defaults.batchId)) {
      throw new BadRequestException(
        'Select a batch you can edit in this school',
      );
    }
    if (defaults.programId) {
      const program = await this.prisma.program.findFirst({
        where: { id: defaults.programId, schoolId },
      });
      if (!program)
        throw new BadRequestException('Select a program from this school');
    }

    const planned = dto.rows.map((raw, i) => {
      const errors: string[] = [];
      const text = (v?: string) => v?.trim().replace(/\s+/g, ' ') ?? '';
      const title = text(raw.title);
      if (!title) errors.push('Chapter title is required');
      if (title.length > 200)
        errors.push('Chapter title must be 200 characters or less');

      const schoolName = text(raw.school);
      if (
        schoolName &&
        schoolName.toLowerCase() !== school.name.toLowerCase()
      ) {
        errors.push(`Row is for "${schoolName}", not ${school.name}`);
      }

      let batch = defaults.batchId
        ? batches.find((b) => b.id === defaults.batchId)
        : undefined;
      if (!batch) {
        const batchName = text(raw.batch);
        const programName = text(raw.program).toLowerCase();
        const candidates = batches.filter(
          (b) =>
            b.name.toLowerCase() === batchName.toLowerCase() &&
            (!defaults.programId || b.programId === defaults.programId) &&
            (!programName || b.program.name.toLowerCase() === programName),
        );
        if (!batchName)
          errors.push('Batch is required (in the file or chosen above)');
        else if (candidates.length === 0)
          errors.push(
            `No batch "${batchName}" you can edit${programName ? ` in ${text(raw.program)}` : ''}`,
          );
        else if (candidates.length > 1)
          errors.push(
            `"${batchName}" exists in several programs; add the Program column`,
          );
        else batch = candidates[0];
      } else if (
        text(raw.program) &&
        batch.program.name.toLowerCase() !== text(raw.program).toLowerCase()
      ) {
        errors.push(
          `Batch ${batch.name} is in ${batch.program.name}, not ${text(raw.program)}`,
        );
      }

      const subjectText = defaults.subject ?? text(raw.subject);
      const subject = SUBJECTS.find(
        (s) => s.toLowerCase() === subjectText.toLowerCase(),
      );
      if (!subject)
        errors.push(
          subjectText
            ? `Unknown subject "${subjectText}"`
            : 'Subject is required',
        );

      const hoursText = text(raw.estimatedHours);
      const hoursMatch = /\d+/.exec(hoursText);
      const estimatedHours = hoursMatch ? Number(hoursMatch[0]) : null;
      if (hoursText && (estimatedHours === null || estimatedHours > 1000))
        errors.push('Estimated hours must be a number');

      // Blank status: new chapters start Not Started, existing ones keep theirs.
      const statusText = text(raw.status);
      const status = statusText
        ? STATUS_ALIASES[statusText.toUpperCase().replace(/[^A-Z]/g, '')]
        : null;
      if (status === undefined)
        errors.push('Status must be Not Started, In Progress or Completed');

      return {
        row: i + 2,
        label: title || '—',
        errors,
        data:
          errors.length === 0
            ? {
                batchId: batch!.id,
                subject: subject!,
                title,
                estimatedHours,
                targetDates: text(raw.targetDates) || null,
                status,
                remarks: text(raw.remarks) || null,
              }
            : null,
      };
    });

    const valid = planned.filter((p) => p.data);
    const existing = await this.prisma.syllabusItem.findMany({
      where: {
        schoolId,
        batchId: { in: [...new Set(valid.map((p) => p.data!.batchId))] },
      },
      select: { id: true, batchId: true, subject: true, title: true },
    });
    const key = (b: string, s: string, t: string) =>
      `${b}|${s}|${t.toLowerCase()}`;
    const existingIds = new Map(
      existing.map((e) => [key(e.batchId, e.subject, e.title), e.id]),
    );
    const firstRow = new Map<string, number>();
    const rows = planned.map((p) => {
      if (!p.data)
        return { ...p, existingId: undefined, action: 'error' } as const;
      const k = key(p.data.batchId, p.data.subject, p.data.title);
      const earlier = firstRow.get(k);
      if (earlier !== undefined) {
        return {
          ...p,
          errors: [`Same chapter as row ${earlier}`] as string[],
          existingId: undefined,
          action: 'error',
        } as const;
      }
      firstRow.set(k, p.row);
      const existingId = existingIds.get(k);
      return {
        ...p,
        existingId,
        action: existingId ? 'update' : 'create',
      } as const;
    });

    // Rows another import (or a double-click) created between our read and our
    // write: the unique index skipped them, so they are reported, not counted.
    const raced = new Set<number>();
    if (!dto.dryRun) {
      const toCreate = rows.filter((r) => r.action === 'create');
      const toUpdate = rows.filter((r) => r.action === 'update');
      // Statuses before, to tell who should hear that a chapter's status changed.
      const before = new Map(
        (toUpdate.length
          ? await this.prisma.syllabusItem.findMany({ where: { schoolId, id: { in: toUpdate.map((r) => r.existingId!) } }, select: { id: true, status: true } })
          : []
        ).map((i) => [i.id, i.status]),
      );
      const [created] = (await duplicateAsConflict(
        () =>
          this.prisma.$transaction(
            [
              this.prisma.syllabusItem.createManyAndReturn({
                // The database's unique index is the last word: a chapter
                // created meanwhile is skipped, not duplicated.
                skipDuplicates: true,
                data: toCreate.map((r) => ({
                  schoolId,
                  ...r.data!,
                  status: r.data!.status ?? 'NOT_STARTED',
                  createdById: userId,
                  updatedById: userId,
                })),
                select: { batchId: true, subject: true, title: true },
              }),
              // An existing chapter only takes the cells the file filled in, so a
              // sparse sheet (e.g. just status) never blanks out hours or remarks.
              ...toUpdate.map((r) =>
                this.prisma.syllabusItem.update({
                  where: { id: r.existingId },
                  data: { ...withoutBlanks(r.data!), updatedById: userId },
                }),
              ),
            ],
            { timeout: 60_000 },
          ),
        CHAPTER_EXISTS,
      )) as [
        { batchId: string; subject: string; title: string }[],
        ...unknown[],
      ];
      const createdKeys = new Set(
        created.map((c) => key(c.batchId, c.subject, c.title)),
      );
      for (const r of toCreate) {
        if (
          !createdKeys.has(key(r.data!.batchId, r.data!.subject, r.data!.title))
        )
          raced.add(r.row);
      }
      const changed = [
        ...toUpdate.filter((r) => r.data!.status && r.data!.status !== before.get(r.existingId!)),
        ...toCreate.filter((r) => !raced.has(r.row) && r.data!.status && r.data!.status !== 'NOT_STARTED'),
      ];
      await this.notifications.syllabusChanged(
        schoolId,
        userId,
        changed.map((r) => ({ batchId: r.data!.batchId, subject: r.data!.subject, title: r.data!.title, status: r.data!.status! })),
      );
    }
    const results = rows.map((r) =>
      raced.has(r.row)
        ? {
            ...r,
            action: 'error' as const,
            errors: [
              'Not imported: this chapter was added by someone else at the same time. Import again to update it.',
            ],
          }
        : r,
    );

    return {
      applied: !dto.dryRun,
      created: results.filter((r) => r.action === 'create').length,
      updated: results.filter((r) => r.action === 'update').length,
      skipped: results.filter((r) => r.action === 'error').length,
      rows: results.map(({ row, label, action, errors }) => ({
        row,
        label,
        action,
        errors,
      })),
    };
  }

  private async assertBatch(
    schoolId: string,
    scope: BatchScope,
    batchId: string,
  ) {
    const batch = await this.prisma.batch.findFirst({
      where: { id: batchId, schoolId },
      select: { id: true },
    });
    if (!batch) throw new NotFoundException('Batch not found');
    if (scope && !scope.includes(batchId))
      throw new ForbiddenException('This batch is not assigned to you');
  }

  private async find(schoolId: string, scope: BatchScope, itemId: string) {
    const item = await this.prisma.syllabusItem.findFirst({
      where: { id: itemId, schoolId },
      select: { batchId: true, status: true },
    });
    if (!item) throw new NotFoundException('Chapter not found');
    if (scope && !scope.includes(item.batchId))
      throw new ForbiddenException('This batch is not assigned to you');
    return item;
  }
}

function fields(dto: SyllabusItemDto) {
  return {
    batchId: dto.batchId,
    subject: dto.subject,
    title: dto.title,
    estimatedHours: dto.estimatedHours ?? null,
    targetDates: dto.targetDates ?? null,
    status: dto.status,
    remarks: dto.remarks ?? null,
  };
}

function withoutBlanks<T extends Record<string, unknown>>(
  data: T,
): { [K in keyof T]?: Exclude<T[K], null> } {
  return Object.fromEntries(
    Object.entries(data).filter(([, v]) => v !== null && v !== undefined),
  ) as { [K in keyof T]?: Exclude<T[K], null> };
}
