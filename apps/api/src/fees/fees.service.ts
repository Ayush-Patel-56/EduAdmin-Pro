import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { istMonthStart, istToday, parseDate, toIsoDate } from '../common/dates.js';
import { uniqueViolation } from '../common/unique-violation.js';
import { Prisma } from '../generated/prisma/client.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { dueDateIn, net, outstanding, periodOf, rupees, statusOf, toPaise } from './fee-rules.js';
import type {
  AddPaymentDto,
  AdjustDueDto,
  AssessDto,
  DueQuery,
  FeeStatus,
  FeeStructureDto,
  PaymentFields,
  PaymentMethod,
  RecordPaymentDto,
  StructureQuery,
  VoidPaymentDto,
} from './fees.dto.js';

type Db = Prisma.TransactionClient;
const TX = { timeout: 20_000, maxWait: 10_000 };
const iso = (d: Date) => d.toISOString().slice(0, 10);

const structureInclude = {
  program: { select: { id: true, name: true } },
  batch: { select: { id: true, name: true } },
  _count: { select: { dues: true } },
} satisfies Prisma.FeeStructureInclude;

const dueInclude = {
  student: {
    select: { id: true, fullName: true, rollNumber: true, admissionNumber: true, batch: { select: { name: true } } },
  },
  structure: { select: { id: true, name: true, category: true, frequency: true } },
  payments: { orderBy: [{ paidOn: 'desc' }, { createdAt: 'desc' }] },
} satisfies Prisma.FeeDueInclude;

type StructureRow = Prisma.FeeStructureGetPayload<{ include: typeof structureInclude }>;
type DueRow = Prisma.FeeDueGetPayload<{ include: typeof dueInclude }>;

/** A due's figures as they will be saved. */
type Figures = {
  amountPaise: number;
  discountPaise: number;
  lateFeePaise: number;
  dueDate: Date;
  statusOverride: FeeStatus | null;
  overrideReason: string | null;
  notes: string | null;
};

/** A payment to add to a due. */
export type PaymentInput = {
  amountPaise: number;
  method: PaymentMethod;
  receiptNumber: string | null;
  transactionRef: string | null;
  paidOn: Date;
  idempotencyKey: string | null;
  source: 'MANUAL' | 'IMPORT';
  notes?: string | null;
};

/**
 * Fee Management (PRD 4.9), admin only. Fees are recorded, not collected
 * online (HLD 8.4): a fee structure is assessed into dues per student and
 * period, and payments are recorded against a due. Money is whole paise.
 * Payments are never edited or deleted, only voided with a reason; every
 * change to a due happens under a lock on that due, so its paid total always
 * matches its live payments.
 */
@Injectable()
export class FeesService {
  constructor(private readonly prisma: PrismaService) {}

  // KPIs

  async summary(schoolId: string) {
    const today = iso(istToday());
    const [paid] = await this.prisma.$queryRaw<{ month: bigint; total: bigint }[]>`
      SELECT coalesce(sum("amountPaise") FILTER (WHERE "paidOn" >= ${iso(istMonthStart())}::date), 0)::bigint AS month,
             coalesce(sum("amountPaise"), 0)::bigint AS total
      FROM "FeePayment" WHERE "schoolId" = ${schoolId} AND "voidedAt" IS NULL`;
    const [dues] = await this.prisma.$queryRaw<
      { pending: bigint; pendingStudents: number; overdue: number; recovered: bigint; billed: bigint; dues: number }[]
    >`
      SELECT
        coalesce(sum(greatest("netPaise" - "paidPaise", 0)) FILTER (WHERE "statusOverride" IS NULL OR "statusOverride" NOT IN ('PAID', 'WAIVED')), 0)::bigint AS pending,
        count(DISTINCT "studentId") FILTER (WHERE ("statusOverride" IS NULL OR "statusOverride" NOT IN ('PAID', 'WAIVED')) AND "paidPaise" < "netPaise")::int AS "pendingStudents",
        count(DISTINCT "studentId") FILTER (WHERE "statusOverride" = 'OVERDUE' OR ("statusOverride" IS NULL AND "paidPaise" < "netPaise" AND "dueDate" < ${today}::date))::int AS overdue,
        coalesce(sum(least("paidPaise", "netPaise")) FILTER (WHERE "statusOverride" IS DISTINCT FROM 'WAIVED'), 0)::bigint AS recovered,
        coalesce(sum("netPaise") FILTER (WHERE "statusOverride" IS DISTINCT FROM 'WAIVED'), 0)::bigint AS billed,
        count(*)::int AS dues
      FROM "FeeDue" WHERE "schoolId" = ${schoolId}`;
    const billed = Number(dues.billed);
    return {
      collectedThisMonthPaise: Number(paid.month),
      collectedAllTimePaise: Number(paid.total),
      pendingPaise: Number(dues.pending),
      pendingStudents: dues.pendingStudents,
      overdueAccounts: dues.overdue,
      // Of what was billed (not waived), how much came in; null before anything is billed.
      collectionRate: billed > 0 ? Math.round((Number(dues.recovered) / billed) * 1000) / 10 : null,
      dueCount: dues.dues,
    };
  }

  // Fee structures

  async structures(schoolId: string, query: StructureQuery) {
    const q = query.q?.trim();
    const rows = await this.prisma.feeStructure.findMany({
      where: {
        schoolId,
        ...(query.category && { category: query.category }),
        ...(q && {
          OR: [
            { name: { contains: q, mode: 'insensitive' } },
            { description: { contains: q, mode: 'insensitive' } },
            { academicYear: { contains: q } },
            { program: { name: { contains: q, mode: 'insensitive' } } },
            { batch: { name: { contains: q, mode: 'insensitive' } } },
          ],
        }),
      },
      orderBy: [{ createdAt: 'desc' }, { name: 'asc' }],
      include: structureInclude,
    });
    return rows.map(toStructure);
  }

  async createStructure(schoolId: string, userId: string, dto: FeeStructureDto) {
    const data = await this.structureData(schoolId, dto);
    const row = await nameConflict(dto.name, () =>
      this.prisma.feeStructure.create({ data: { schoolId, createdById: userId, ...data }, select: { id: true } }),
    );
    return { id: row.id };
  }

  /**
   * Amount, due day, name and description apply to dues assessed from now on
   * (existing dues keep their amounts). Once students have dues, the
   * frequency and who it applies to are fixed: billing periods come from the
   * frequency, so changing it would bill the same student twice.
   */
  async updateStructure(schoolId: string, id: string, dto: FeeStructureDto) {
    const data = await this.structureData(schoolId, dto);
    await nameConflict(dto.name, () =>
      this.prisma.$transaction(async (tx) => {
        await lock(tx, 'FeeStructure', schoolId, id, 'Fee structure not found');
        const current = await tx.feeStructure.findUniqueOrThrow({
          where: { id },
          select: { frequency: true, programId: true, batchId: true, _count: { select: { dues: true } } },
        });
        if (current._count.dues > 0) checkFixedRules(current, data, current._count.dues);
        await tx.feeStructure.update({ where: { id }, data });
      }),
    );
    return { id };
  }

  async deleteStructure(schoolId: string, id: string) {
    await this.prisma.$transaction(async (tx) => {
      await lock(tx, 'FeeStructure', schoolId, id, 'Fee structure not found');
      const dues = await tx.feeDue.count({ where: { structureId: id } });
      if (dues > 0) {
        throw new ConflictException(
          `${dues} student due${dues === 1 ? '' : 's'} use this fee structure, so it stays. Edit it for future dues instead.`,
        );
      }
      await tx.feeStructure.delete({ where: { id } });
    });
    return { ok: true };
  }

  /**
   * Assess a mandatory fee: a due for every active student it applies to, for
   * the billing period of `month`. Students who already have it for that
   * period are left alone, so assessing twice is harmless.
   */
  async assess(schoolId: string, userId: string, id: string, dto: AssessDto) {
    const school = await this.prisma.school.findUniqueOrThrow({ where: { id: schoolId }, select: { academicYearStartMonth: true } });
    return this.prisma.$transaction(async (tx) => {
      // Read under a shared lock, so the frequency can't change while dues are made from it.
      await lockShared(tx, schoolId, id);
      const structure = await tx.feeStructure.findUniqueOrThrow({ where: { id } });
      if (!structure.mandatory) {
        throw new BadRequestException('Only mandatory fees are assessed for every student. Record an optional fee per student.');
      }
      const dueDate = dueDateIn(dto.month, structure.dueDay);
      const period = periodOf(structure.frequency, dueDate, school.academicYearStartMonth);
      const students = await tx.student.findMany({
        where: {
          schoolId,
          status: 'ACTIVE',
          ...(structure.batchId ? { batchId: structure.batchId } : structure.programId ? { programId: structure.programId } : {}),
        },
        select: { id: true },
      });
      const amount = structure.amountPaise;
      const { count } = await tx.feeDue.createMany({
        data: students.map((s) => ({
          schoolId,
          studentId: s.id,
          structureId: id,
          period,
          dueDate,
          amountPaise: amount,
          netPaise: amount,
          createdById: userId,
        })),
        skipDuplicates: true,
      });
      return { period, dueDate: iso(dueDate), created: count, alreadyAssessed: students.length - count };
    }, TX);
  }

  // Dues and payments

  async dues(schoolId: string, query: DueQuery) {
    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? 10;
    const today = istToday();
    const q = query.q?.trim();
    const where: Prisma.FeeDueWhereInput = {
      schoolId,
      AND: [
        q
          ? {
              OR: [
                { student: { fullName: { contains: q, mode: 'insensitive' } } },
                { student: { rollNumber: { contains: q, mode: 'insensitive' } } },
                { student: { admissionNumber: { contains: q, mode: 'insensitive' } } },
                { structure: { name: { contains: q, mode: 'insensitive' } } },
                { payments: { some: { receiptNumber: { contains: q, mode: 'insensitive' } } } },
                { payments: { some: { transactionRef: { contains: q, mode: 'insensitive' } } } },
              ],
            }
          : {},
        query.status ? this.statusWhere(query.status, today) : {},
      ],
    };
    const [total, rows] = await Promise.all([
      this.prisma.feeDue.count({ where }),
      this.prisma.feeDue.findMany({
        where,
        orderBy: [{ dueDate: 'desc' }, { createdAt: 'desc' }, { id: 'asc' }],
        include: dueInclude,
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
    ]);
    return { total, page, pageSize, items: rows.map((d) => toDue(d, today)) };
  }

  /**
   * Record Payment Transaction: the student's due for this fee and billing
   * period (created if it's new, its figures updated if not) and, when an
   * amount is paid, a payment with a receipt. One transaction; retrying with
   * the same idempotency key returns the first result.
   */
  async record(schoolId: string, userId: string, dto: RecordPaymentDto) {
    const payment = paymentOf(dto, 'MANUAL');
    const expect = { studentId: dto.studentId, structureId: dto.structureId, amountPaise: payment?.amountPaise ?? null };
    const replay = await this.replay(schoolId, dto.idempotencyKey, expect);
    if (replay) return replay;
    const [student, structure, school] = await Promise.all([
      this.prisma.student.findFirst({
        where: { id: dto.studentId, schoolId },
        select: { id: true, fullName: true, batchId: true, programId: true, batch: { select: { name: true } } },
      }),
      this.prisma.feeStructure.findFirst({
        where: { id: dto.structureId, schoolId },
        select: { id: true, name: true, frequency: true, batchId: true, programId: true, batch: { select: { name: true } }, program: { select: { name: true } } },
      }),
      this.prisma.school.findUniqueOrThrow({ where: { id: schoolId }, select: { academicYearStartMonth: true } }),
    ]);
    if (!student) throw new BadRequestException('Select a student of this school');
    if (!structure) throw new BadRequestException('Select a fee structure of this school');
    if (structure.batchId && structure.batchId !== student.batchId) {
      throw new BadRequestException(`${structure.name} is for ${structure.batch!.name}; ${student.fullName} is in ${student.batch?.name ?? 'no batch'}`);
    }
    if (!structure.batchId && structure.programId && structure.programId !== student.programId) {
      throw new BadRequestException(`${structure.name} is for the ${structure.program!.name} program; ${student.fullName} isn't in it`);
    }
    const figures = figuresOf(dto);

    return this.withIdempotency(schoolId, dto.idempotencyKey, expect, () =>
      this.prisma.$transaction(async (tx) => {
        // The frequency is read under a shared lock: it decides the period.
        await lockShared(tx, schoolId, structure.id);
        const { frequency } = await tx.feeStructure.findUniqueOrThrow({ where: { id: structure.id }, select: { frequency: true } });
        const period = periodOf(frequency, figures.dueDate, school.academicYearStartMonth);
        const existing = await tx.feeDue.findUnique({
          where: { structureId_studentId_period: { structureId: structure.id, studentId: student.id, period } },
          select: { id: true },
        });
        let dueId: string;
        if (existing) {
          dueId = existing.id;
          // Locked before its figures are checked and changed, like every other write to a due.
          await lock(tx, 'FeeDue', schoolId, dueId, 'Due not found');
          await this.adjustLocked(tx, schoolId, userId, dueId, figures);
        } else {
          checkOverride(figures);
          dueId = (
            await tx.feeDue.create({
              data: {
                schoolId,
                studentId: student.id,
                structureId: structure.id,
                period,
                ...figures,
                netPaise: net(figures),
                ...overrideStamp(figures, userId),
                createdById: userId,
              },
              select: { id: true },
            })
          ).id;
          await lock(tx, 'FeeDue', schoolId, dueId, 'Due not found');
        }
        const receipt = payment ? await this.addPaymentLocked(tx, schoolId, userId, dueId, payment) : null;
        return { dueId, created: !existing, ...receipt };
      }, TX),
    );
  }

  async adjust(schoolId: string, userId: string, dueId: string, dto: AdjustDueDto) {
    await this.prisma.$transaction(async (tx) => {
      await lock(tx, 'FeeDue', schoolId, dueId, 'Due not found');
      await this.adjustLocked(tx, schoolId, userId, dueId, figuresOf(dto));
    }, TX);
    return { id: dueId };
  }

  async addPayment(schoolId: string, userId: string, dueId: string, dto: AddPaymentDto) {
    const payment = paymentOf(dto, 'MANUAL');
    if (!payment) throw new BadRequestException('Enter the amount paid');
    const expect = { dueId, amountPaise: payment.amountPaise };
    const replay = await this.replay(schoolId, dto.idempotencyKey, expect);
    if (replay) return replay;
    return this.withIdempotency(schoolId, dto.idempotencyKey, expect, () =>
      this.prisma.$transaction(async (tx) => {
        await lock(tx, 'FeeDue', schoolId, dueId, 'Due not found');
        return { dueId, created: false, ...(await this.addPaymentLocked(tx, schoolId, userId, dueId, payment)) };
      }, TX),
    );
  }

  /** A payment recorded by mistake is voided (kept, with who, when and why), never deleted. */
  async voidPayment(schoolId: string, userId: string, paymentId: string, dto: VoidPaymentDto) {
    await this.prisma.$transaction(async (tx) => {
      const found = await tx.feePayment.findFirst({ where: { id: paymentId, schoolId }, select: { dueId: true } });
      if (!found) throw new NotFoundException('Payment not found');
      await lock(tx, 'FeeDue', schoolId, found.dueId, 'Due not found');
      const payment = await tx.feePayment.findUniqueOrThrow({ where: { id: paymentId } });
      if (payment.voidedAt) throw new ConflictException(`Receipt ${payment.receiptNumber} is already voided`);
      await tx.feePayment.update({
        where: { id: paymentId },
        data: { voidedAt: new Date(), voidedById: userId, voidReason: dto.reason },
      });
      await tx.feeDue.update({ where: { id: payment.dueId }, data: { paidPaise: { decrement: payment.amountPaise } } });
    }, TX);
    return { ok: true };
  }

  /** A due without any payment history can be removed (e.g. assessed by mistake); one with payments stays. */
  async deleteDue(schoolId: string, dueId: string) {
    await this.prisma.$transaction(async (tx) => {
      await lock(tx, 'FeeDue', schoolId, dueId, 'Due not found');
      const payments = await tx.feePayment.count({ where: { dueId } });
      if (payments > 0) {
        throw new ConflictException('This due has payment history, so it stays. Set its status to Waived if it shouldn’t be charged.');
      }
      await tx.feeDue.delete({ where: { id: dueId } });
    });
    return { ok: true };
  }

  /** For the Record Payment form: the school's fee structures (students come from the roster search). */
  async options(schoolId: string) {
    const structures = await this.prisma.feeStructure.findMany({
      where: { schoolId },
      orderBy: { name: 'asc' },
      select: { id: true, name: true, amountPaise: true, frequency: true, dueDay: true, batchId: true, programId: true },
    });
    return { structures };
  }

  // Shared with the import

  /**
   * Updates a locked due's figures. The amount due is fixed once money is in
   * (adjust with a discount or late fee), and the net payable can't drop
   * below what was already paid.
   */
  async adjustLocked(tx: Db, schoolId: string, userId: string, dueId: string, figures: Figures) {
    checkOverride(figures);
    const due = await tx.feeDue.findUniqueOrThrow({ where: { id: dueId } });
    if (figures.amountPaise !== due.amountPaise && due.paidPaise > 0) {
      throw new BadRequestException('The amount due is fixed once a payment is recorded; adjust it with a discount or late fee');
    }
    const netPaise = net(figures);
    if (netPaise < due.paidPaise) {
      throw new BadRequestException(`${rupees(due.paidPaise)} is already paid, so the net payable can't be lower than that`);
    }
    const overrideChanged =
      figures.statusOverride !== due.statusOverride || (figures.overrideReason ?? null) !== (due.overrideReason ?? null);
    await tx.feeDue.update({
      where: { id: dueId },
      data: {
        ...figures,
        netPaise,
        ...(overrideChanged ? overrideStamp(figures, userId) : {}),
      },
    });
  }

  /** Adds a payment to a locked due: a receipt number, the duplicate checks, and the paid total. */
  async addPaymentLocked(tx: Db, schoolId: string, userId: string, dueId: string, p: PaymentInput) {
    if (p.paidOn > istToday()) throw new BadRequestException("Paid date can't be in the future");
    const due = await tx.feeDue.findUniqueOrThrow({ where: { id: dueId }, select: { netPaise: true, paidPaise: true } });
    const left = due.netPaise - due.paidPaise;
    if (left <= 0) throw new BadRequestException('This fee is already fully paid');
    if (p.amountPaise > left) throw new BadRequestException(`That's more than the ${rupees(left)} still due`);
    if (p.transactionRef) {
      const taken = await tx.feePayment.findFirst({
        where: { schoolId, voidedAt: null, transactionRef: { equals: p.transactionRef, mode: 'insensitive' } },
        select: { receiptNumber: true },
      });
      if (taken) throw new ConflictException(`Transaction ID ${p.transactionRef} is already recorded (receipt ${taken.receiptNumber})`);
    }
    if (p.receiptNumber) {
      const used = await tx.feePayment.findUnique({
        where: { schoolId_receiptNumber: { schoolId, receiptNumber: p.receiptNumber } },
        select: { id: true },
      });
      if (used) throw new ConflictException(`Receipt number ${p.receiptNumber} is already used`);
    }
    const receiptNumber = p.receiptNumber ?? (await nextReceipt(tx, schoolId, p.paidOn.getUTCFullYear()));
    const row = await tx.feePayment.create({
      data: {
        schoolId,
        dueId,
        receiptNumber,
        amountPaise: p.amountPaise,
        method: p.method,
        transactionRef: p.transactionRef,
        paidOn: p.paidOn,
        source: p.source,
        idempotencyKey: p.idempotencyKey,
        notes: p.notes ?? null,
        recordedById: userId,
      },
      select: { id: true },
    });
    await tx.feeDue.update({ where: { id: dueId }, data: { paidPaise: { increment: p.amountPaise } } });
    return { paymentId: row.id, receiptNumber };
  }

  // Helpers

  /** Where-conditions for a status, matching `statusOf`. */
  private statusWhere(status: FeeStatus, today: Date): Prisma.FeeDueWhereInput {
    const netField = this.prisma.feeDue.fields.netPaise;
    const auto = (where: Prisma.FeeDueWhereInput): Prisma.FeeDueWhereInput => ({
      OR: [{ statusOverride: status }, { statusOverride: null, ...where }],
    });
    switch (status) {
      case 'WAIVED':
        return { statusOverride: 'WAIVED' };
      case 'PAID':
        return auto({ paidPaise: { gte: netField } });
      case 'OVERDUE':
        return auto({ paidPaise: { lt: netField }, dueDate: { lt: today } });
      case 'PARTIAL':
        return auto({ AND: [{ paidPaise: { lt: netField } }, { paidPaise: { gt: 0 } }], dueDate: { gte: today } });
      case 'PENDING':
        return auto({ AND: [{ paidPaise: { lt: netField } }, { paidPaise: 0 }], dueDate: { gte: today } });
    }
  }

  /**
   * A retried submit (same idempotency key) gets the first payment back, but
   * only if it is the same payment: a key reused for another student, fee,
   * due or amount, or one whose payment was voided since, is a 409.
   */
  private async replay(schoolId: string, key: string | null | undefined, expect: ReplayExpect) {
    if (!key) return null;
    const done = await this.prisma.feePayment.findUnique({
      where: { schoolId_idempotencyKey: { schoolId, idempotencyKey: key } },
      select: { id: true, dueId: true, receiptNumber: true, amountPaise: true, voidedAt: true, due: { select: { studentId: true, structureId: true } } },
    });
    if (!done) return null;
    const same =
      done.amountPaise === expect.amountPaise &&
      (!expect.dueId || done.dueId === expect.dueId) &&
      (!expect.studentId || done.due.studentId === expect.studentId) &&
      (!expect.structureId || done.due.structureId === expect.structureId);
    if (!same) throw new ConflictException('This form was already used for a different payment. Close it and record the payment again.');
    if (done.voidedAt) throw new ConflictException(`Receipt ${done.receiptNumber} from this form was voided. Close it and record the payment again.`);
    return { dueId: done.dueId, created: false, paymentId: done.id, receiptNumber: done.receiptNumber, replayed: true };
  }

  /**
   * Runs a write that records a payment. A unique index decides races: the
   * same idempotency key returns the first payment, a receipt number or
   * transaction ID taken meanwhile is a 409.
   */
  private async withIdempotency<T>(schoolId: string, key: string | null | undefined, expect: ReplayExpect, write: () => Promise<T>) {
    try {
      return await write();
    } catch (err) {
      const names = uniqueViolation(err);
      if (!names) throw err;
      const hit = (part: string) => names.some((n) => n.includes(part));
      if (hit('idempotencyKey')) {
        const replay = await this.replay(schoolId, key, expect);
        if (replay) return replay;
      }
      if (hit('receiptNumber')) throw new ConflictException('That receipt number is already used');
      if (hit('transactionRef')) throw new ConflictException('That transaction ID is already recorded');
      throw new ConflictException('This student already has this fee for that period. Refresh and try again.');
    }
  }

  private async findStructure(schoolId: string, id: string) {
    const row = await this.prisma.feeStructure.findFirst({ where: { id, schoolId } });
    if (!row) throw new NotFoundException('Fee structure not found');
    return row;
  }

  /** Checks the program, batch (a batch implies its program) and academic year. */
  private async structureData(schoolId: string, dto: FeeStructureDto) {
    const [start, end] = dto.academicYear.split('-').map(Number);
    if ((start + 1) % 100 !== end) throw new BadRequestException('Academic year must be two years in a row, like 2026-27');
    let programId = dto.programId ?? null;
    if (dto.batchId) {
      const batch = await this.prisma.batch.findFirst({ where: { id: dto.batchId, schoolId }, select: { programId: true } });
      if (!batch) throw new BadRequestException('Select a batch of this school');
      if (programId && programId !== batch.programId) throw new BadRequestException('That batch belongs to another program');
      programId = batch.programId;
    }
    if (programId) {
      const program = await this.prisma.program.findFirst({ where: { id: programId, schoolId }, select: { id: true } });
      if (!program) throw new BadRequestException('Select a program of this school');
    }
    return {
      name: dto.name,
      category: dto.category,
      description: dto.description ?? null,
      amountPaise: toPaise(dto.amount),
      frequency: dto.frequency,
      dueDay: dto.dueDay,
      mandatory: dto.mandatory,
      programId,
      batchId: dto.batchId ?? null,
      academicYear: dto.academicYear,
    };
  }
}

type ReplayExpect = { amountPaise: number | null; dueId?: string; studentId?: string; structureId?: string };

/** A shared lock on a fee structure: dues can be made from it, but it can't be edited meanwhile. */
export async function lockShared(tx: Db, schoolId: string, id: string) {
  const rows = await tx.$queryRaw<{ id: string }[]>`
    SELECT "id" FROM "FeeStructure" WHERE "id" = ${id} AND "schoolId" = ${schoolId} FOR SHARE`;
  if (rows.length === 0) throw new NotFoundException('Fee structure not found');
}

/** Refuses changing what billing periods and dues are based on, once dues exist. */
export function checkFixedRules(
  current: { frequency: string; programId: string | null; batchId: string | null },
  next: { frequency: string; programId: string | null; batchId: string | null },
  dues: number,
) {
  const changed = [
    current.frequency !== next.frequency && 'frequency',
    (current.programId !== next.programId || current.batchId !== next.batchId) && 'program or batch',
  ].filter(Boolean);
  if (changed.length) {
    throw new ConflictException(
      `${dues} student due${dues === 1 ? ' is' : 's are'} already billed from this fee, so its ${changed.join(' and ')} can't change. Create a new fee structure for the new rule.`,
    );
  }
}

/** Locks one row of this school until the transaction ends (404 for anything else). */
export async function lock(tx: Db, table: 'FeeDue' | 'FeeStructure', schoolId: string, id: string, missing: string) {
  const rows = await tx.$queryRaw<{ id: string }[]>`
    SELECT "id" FROM ${Prisma.raw(`"${table}"`)} WHERE "id" = ${id} AND "schoolId" = ${schoolId} FOR UPDATE`;
  if (rows.length === 0) throw new NotFoundException(missing);
}

/** The next automatic receipt number for the school and year, allocated atomically. */
export async function nextReceipt(tx: Db, schoolId: string, year: number) {
  // A receipt typed by hand may already use the next number: skip past it.
  for (;;) {
    const [{ last }] = await tx.$queryRaw<{ last: number }[]>`
      INSERT INTO "FeeReceiptCounter" ("schoolId", "year", "last") VALUES (${schoolId}, ${year}, 1)
      ON CONFLICT ("schoolId", "year") DO UPDATE SET "last" = "FeeReceiptCounter"."last" + 1
      RETURNING "last"`;
    const receipt = `REC-${year}-${String(last).padStart(6, '0')}`;
    const taken = await tx.feePayment.findUnique({
      where: { schoolId_receiptNumber: { schoolId, receiptNumber: receipt } },
      select: { id: true },
    });
    if (!taken) return receipt;
  }
}

function figuresOf(dto: AdjustDueDto): Figures {
  return {
    amountPaise: toPaise(dto.amountDue),
    discountPaise: toPaise(dto.discount),
    lateFeePaise: toPaise(dto.lateFee),
    dueDate: parseDate(dto.dueDate, 'Due date'),
    statusOverride: dto.statusOverride ?? null,
    overrideReason: dto.statusOverride ? (dto.overrideReason ?? null) : null,
    notes: dto.notes ?? null,
  };
}

function paymentOf(dto: PaymentFields, source: 'MANUAL' | 'IMPORT'): PaymentInput | null {
  if (!dto.amountPaid) return null;
  return {
    amountPaise: toPaise(dto.amountPaid),
    method: dto.method!,
    receiptNumber: dto.receiptNumber?.toUpperCase() ?? null,
    transactionRef: dto.transactionRef ?? null,
    paidOn: dto.paidOn ? parseDate(dto.paidOn, 'Paid date') : istToday(),
    idempotencyKey: dto.idempotencyKey ?? null,
    source,
  };
}

function checkOverride(f: Figures) {
  if (f.discountPaise > f.amountPaise + f.lateFeePaise) {
    throw new BadRequestException("The discount can't be more than the amount due plus the late fee");
  }
  if (f.statusOverride && !f.overrideReason) throw new BadRequestException('Give a reason for overriding the status');
}

/** Who set the override and when (cleared with it). */
function overrideStamp(f: Figures, userId: string) {
  return f.statusOverride
    ? { overrideById: userId, overrideAt: new Date() }
    : { overrideById: null, overrideAt: null };
}

async function nameConflict<T>(name: string, write: () => Promise<T>) {
  try {
    return await write();
  } catch (err) {
    if (uniqueViolation(err)) throw new ConflictException(`A fee structure named ${name} already exists`);
    // The program or batch was deleted while this was saved.
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2003') {
      throw new BadRequestException('That program or batch no longer exists. Refresh and pick again.');
    }
    throw err;
  }
}

function toStructure(s: StructureRow) {
  return {
    id: s.id,
    name: s.name,
    category: s.category,
    description: s.description,
    amountPaise: s.amountPaise,
    frequency: s.frequency,
    dueDay: s.dueDay,
    mandatory: s.mandatory,
    program: s.program,
    batch: s.batch,
    academicYear: s.academicYear,
    dueCount: s._count.dues,
    createdAt: s.createdAt.toISOString(),
  };
}

function toDue(d: DueRow, today: Date) {
  const live = d.payments.filter((p) => !p.voidedAt);
  return {
    id: d.id,
    student: {
      id: d.student.id,
      fullName: d.student.fullName,
      rollNumber: d.student.rollNumber,
      admissionNumber: d.student.admissionNumber,
      batch: d.student.batch?.name ?? null,
    },
    structure: d.structure,
    period: d.period,
    dueDate: toIsoDate(d.dueDate)!,
    amountPaise: d.amountPaise,
    discountPaise: d.discountPaise,
    lateFeePaise: d.lateFeePaise,
    netPaise: d.netPaise,
    paidPaise: d.paidPaise,
    outstandingPaise: outstanding(d),
    status: statusOf(d, today),
    statusOverride: d.statusOverride,
    overrideReason: d.overrideReason,
    overrideAt: d.overrideAt?.toISOString() ?? null,
    notes: d.notes,
    lastPaidOn: live[0] ? toIsoDate(live[0].paidOn) : null,
    payments: d.payments.map((p) => ({
      id: p.id,
      receiptNumber: p.receiptNumber,
      amountPaise: p.amountPaise,
      method: p.method,
      transactionRef: p.transactionRef,
      paidOn: toIsoDate(p.paidOn)!,
      source: p.source,
      notes: p.notes,
      voidedAt: p.voidedAt?.toISOString() ?? null,
      voidReason: p.voidReason,
    })),
  };
}
