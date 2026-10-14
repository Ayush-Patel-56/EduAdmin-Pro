import { BadRequestException, ConflictException, HttpException, Injectable } from '@nestjs/common';
import { type ImportPreview, parseImportDate } from '../academic/import-utils.js';
import { istToday } from '../common/dates.js';
import { uniqueViolation } from '../common/unique-violation.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { academicYearOf, dueDateIn, net, periodOf, toPaise } from './fee-rules.js';
import type { FeeCategory, FeeFrequency, PaymentImportDto, PaymentMethod, StructureImportDto } from './fees.dto.js';
import { checkFixedRules, FeesService, lock, lockShared, lockStructures } from './fees.service.js';

const TX = { timeout: 60_000, maxWait: 10_000 };
const key = (s: string) => s.trim().toLowerCase().replace(/[^a-z0-9]/g, '');

const CATEGORIES: Record<string, FeeCategory> = {
  registration: 'REGISTRATION', registrationfee: 'REGISTRATION', admission: 'REGISTRATION', admissionfee: 'REGISTRATION',
  monthlytuition: 'MONTHLY_TUITION', tuition: 'MONTHLY_TUITION', tuitionfee: 'MONTHLY_TUITION',
  exam: 'EXAM', examfee: 'EXAM', examination: 'EXAM',
  material: 'MATERIAL', materialfee: 'MATERIAL', studymaterial: 'MATERIAL',
  other: 'OTHER', others: 'OTHER',
};
const FREQUENCIES: Record<string, FeeFrequency> = {
  onetime: 'ONE_TIME', once: 'ONE_TIME', monthly: 'MONTHLY', quarterly: 'QUARTERLY', yearly: 'YEARLY', annual: 'YEARLY', annually: 'YEARLY',
};
const METHODS: Record<string, PaymentMethod> = {
  upi: 'UPI', upiqr: 'UPI', qr: 'UPI', cash: 'CASH', card: 'CARD', debitcard: 'CARD', creditcard: 'CARD',
  netbanking: 'NET_BANKING', neft: 'NET_BANKING', imps: 'NET_BANKING', rtgs: 'NET_BANKING', banktransfer: 'NET_BANKING',
  cheque: 'CHEQUE', check: 'CHEQUE', dd: 'DD', demanddraft: 'DD',
};
const YES = new Set(['yes', 'y', 'true', '1']);
const NO = new Set(['no', 'n', 'false', '0']);

/** "12,500" / "₹12500.50" -> 12500.5 rupees; null when blank; an error when not an amount. */
function amount(value: string | undefined, label: string, errors: string[]) {
  const text = value?.replace(/[₹,\s]/g, '').replace(/^rs\.?/i, '');
  if (!text) return null;
  if (!/^\d+(\.\d{1,2})?$/.test(text) || Number(text) > 10_000_000) {
    errors.push(`${label} must be an amount in rupees, like 12500`);
    return null;
  }
  return toPaise(Number(text));
}

/** "All Programs", "All Batches", blank -> no restriction. */
const isAll = (value: string | undefined) => !value || /^all\b/i.test(value.trim()) || value.trim() === '-';

/**
 * Bulk import for fee structures and fee payments (PRD 4.9). Every row is
 * checked first (a dry run shows the result); applying runs in one
 * transaction and uses the same rules as the forms. Rows with errors are
 * skipped, never half-saved.
 */
@Injectable()
export class FeesImportService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly fees: FeesService,
  ) {}

  async structures(schoolId: string, userId: string, dto: StructureImportDto): Promise<ImportPreview> {
    const [school, programs, batches, existing] = await Promise.all([
      this.prisma.school.findUniqueOrThrow({ where: { id: schoolId }, select: { academicYearStartMonth: true } }),
      this.prisma.program.findMany({ where: { schoolId }, select: { id: true, name: true } }),
      this.prisma.batch.findMany({ where: { schoolId }, select: { id: true, name: true, programId: true } }),
      this.prisma.feeStructure.findMany({
        where: { schoolId },
        select: { id: true, name: true, frequency: true, programId: true, batchId: true, _count: { select: { dues: true } } },
      }),
    ]);
    const byName = new Map(existing.map((s) => [s.name.toLowerCase(), s]));
    const defaultYear = academicYearOf(istToday(), school.academicYearStartMonth);
    const seen = new Map<string, number>();

    const rows = dto.rows.map((raw, i) => {
      const row = i + 2;
      const errors: string[] = [];
      const name = raw.name?.trim().replace(/\s+/g, ' ') ?? '';
      if (!name) errors.push('Fee Name is required');
      const category = raw.category ? CATEGORIES[key(raw.category)] : undefined;
      if (!category) errors.push('Fee Category must be Registration Fee, Monthly Tuition, Exam Fee, Material Fee or Other');
      const amountPaise = amount(raw.amount, 'Amount', errors);
      if (amountPaise === null && !errors.some((e) => e.startsWith('Amount'))) errors.push('Amount is required');
      const frequency = raw.frequency ? FREQUENCIES[key(raw.frequency)] : undefined;
      if (!frequency) errors.push('Frequency must be One-time, Monthly, Quarterly or Yearly');
      const dueDay = raw.dueDay ? Number(raw.dueDay) : 5;
      if (!Number.isInteger(dueDay) || dueDay < 1 || dueDay > 31) errors.push('Due Day must be a day of the month (1-31)');
      const flag = raw.mandatory?.trim().toLowerCase();
      if (flag && !YES.has(flag) && !NO.has(flag)) errors.push('Mandatory must be Yes or No');
      const mandatory = !flag || YES.has(flag);

      let programId: string | null = null;
      if (!isAll(raw.program)) {
        const program = programs.find((p) => p.name.toLowerCase() === raw.program!.trim().toLowerCase());
        if (program) programId = program.id;
        else errors.push(`No program named ${raw.program}`);
      }
      let batchId: string | null = null;
      if (!isAll(raw.batch)) {
        const matches = batches.filter(
          (b) => b.name.toLowerCase() === raw.batch!.trim().toLowerCase() && (!programId || b.programId === programId),
        );
        if (matches.length === 1) {
          batchId = matches[0].id;
          programId = matches[0].programId;
        } else {
          errors.push(matches.length ? `Batch ${raw.batch} is in more than one program; add the Program` : `No batch named ${raw.batch}${programId ? ' in that program' : ''}`);
        }
      }
      const academicYear = raw.academicYear?.trim() || defaultYear;
      const years = /^(\d{4})-(\d{2})$/.exec(academicYear);
      if (!years || (Number(years[1]) + 1) % 100 !== Number(years[2])) errors.push('Academic Year must look like 2026-27');

      const first = seen.get(name.toLowerCase());
      if (name && first) errors.push(`Same fee name as row ${first}`);
      else if (name) seen.set(name.toLowerCase(), row);
      const current = byName.get(name.toLowerCase());
      const id = current?.id;
      // An existing fee with dues keeps its frequency and scope (else students would be billed twice).
      if (current && current._count.dues > 0 && frequency && errors.length === 0) {
        try {
          checkFixedRules(current, { frequency, programId, batchId }, current._count.dues);
        } catch (err) {
          errors.push((err as Error).message);
        }
      }
      return {
        row,
        label: name || `Row ${row}`,
        action: errors.length ? ('error' as const) : id ? ('update' as const) : ('create' as const),
        errors,
        id,
        data: { name, category: category!, amountPaise: amountPaise!, frequency: frequency!, dueDay, mandatory, programId, batchId, academicYear, description: raw.description?.trim() || null },
      };
    });

    if (!dto.dryRun) {
      try {
        await this.prisma.$transaction(async (tx) => {
          // Every fee the file updates is locked up front, in id order, so two imports can't deadlock.
          await lockStructures(tx, schoolId, rows.flatMap((r) => (r.action === 'update' ? [r.id!] : [])));
          for (const r of rows) {
            if (r.action === 'create') await tx.feeStructure.create({ data: { schoolId, createdById: userId, ...r.data } });
            if (r.action === 'update') {
              // Checked again under the lock: dues may have been assessed since the preview.
              const current = await tx.feeStructure.findUniqueOrThrow({
                where: { id: r.id },
                select: { frequency: true, programId: true, batchId: true, _count: { select: { dues: true } } },
              });
              if (current._count.dues > 0) checkFixedRules(current, r.data, current._count.dues);
              await tx.feeStructure.update({ where: { id: r.id }, data: r.data });
            }
          }
        }, TX);
      } catch (err) {
        if (uniqueViolation(err)) throw new ConflictException('A fee structure with one of these names was added meanwhile. Check the file again.');
        throw err;
      }
    }
    return preview(rows, !dto.dryRun);
  }

  async payments(schoolId: string, userId: string, dto: PaymentImportDto): Promise<ImportPreview> {
    const [school, students, structures, receipts, refs] = await Promise.all([
      this.prisma.school.findUniqueOrThrow({ where: { id: schoolId }, select: { academicYearStartMonth: true } }),
      this.prisma.student.findMany({
        where: { schoolId },
        select: { id: true, fullName: true, rollNumber: true, admissionNumber: true, batchId: true, programId: true },
      }),
      this.prisma.feeStructure.findMany({
        where: { schoolId },
        select: { id: true, name: true, frequency: true, dueDay: true, amountPaise: true, batchId: true, programId: true },
      }),
      this.prisma.feePayment.findMany({ where: { schoolId }, select: { receiptNumber: true } }),
      this.prisma.feePayment.findMany({ where: { schoolId, voidedAt: null, transactionRef: { not: null } }, select: { transactionRef: true } }),
    ]);
    const usedReceipts = new Set(receipts.map((r) => r.receiptNumber.toUpperCase()));
    const usedRefs = new Set(refs.map((r) => r.transactionRef!.toLowerCase()));
    const today = istToday();
    // A due's figures as the rows so far leave them (rows can follow up on one another).
    const dues = new Map<string, { amountPaise: number; discountPaise: number; lateFeePaise: number; paidPaise: number; dueDate: Date; exists: boolean }>();
    const existing = await this.prisma.feeDue.findMany({
      where: { schoolId },
      select: { structureId: true, studentId: true, period: true, amountPaise: true, discountPaise: true, lateFeePaise: true, paidPaise: true, dueDate: true },
    });
    for (const d of existing) dues.set(`${d.structureId}|${d.studentId}|${d.period}`, { ...d, exists: true });

    const rows = dto.rows.map((raw, i) => {
      const row = i + 2;
      const errors: string[] = [];
      const roll = raw.rollNumber?.trim().toUpperCase();
      const given = raw.studentName?.trim().toLowerCase();
      if (!roll) errors.push('Student Roll No is required');
      let matches = roll ? students.filter((s) => s.rollNumber?.toUpperCase() === roll) : [];
      if (matches.length > 1 && given) matches = matches.filter((s) => s.fullName.toLowerCase() === given);
      if (roll && matches.length === 0) matches = students.filter((s) => s.admissionNumber?.toUpperCase() === roll);
      const student = matches.length === 1 ? matches[0] : undefined;
      if (roll && !student) errors.push(matches.length ? `Roll No ${roll} matches more than one student; check the Student Name` : `No student with roll number ${roll}`);
      if (student && given && student.fullName.toLowerCase() !== given) {
        errors.push(`Roll No ${roll} is ${student.fullName}, not ${raw.studentName!.trim()}`);
      }

      const structure = raw.structureName
        ? structures.find((s) => s.name.toLowerCase() === raw.structureName!.trim().toLowerCase())
        : undefined;
      if (!raw.structureName) errors.push('Fee Structure Name is required');
      else if (!structure) errors.push(`No fee structure named ${raw.structureName}`);
      if (student && structure) {
        if (structure.batchId && structure.batchId !== student.batchId) errors.push(`${structure.name} is for another batch than ${student.fullName}'s`);
        else if (!structure.batchId && structure.programId && structure.programId !== student.programId) errors.push(`${structure.name} is for another program than ${student.fullName}'s`);
      }

      const paid = amount(raw.amountPaid, 'Amount Paid', errors) ?? 0;
      const paidOn = parseImportDate(raw.paidOn, 'Paid Date', errors) ?? (paid > 0 ? today : null);
      if (paidOn && paidOn > today) errors.push("Paid Date can't be in the future");
      const method = raw.method ? METHODS[key(raw.method)] : undefined;
      if (paid > 0 && !method) errors.push('Payment Method must be UPI, Cash, Card, Net Banking, Cheque or DD');
      const dueGiven = parseImportDate(raw.dueDate, 'Due Date', errors);
      const receipt = raw.receiptNumber?.trim().toUpperCase() || null;
      if (receipt) {
        if (!/^[A-Z0-9][A-Z0-9/_-]*$/.test(receipt)) errors.push('Receipt No can only have letters, digits, - / and _');
        else if (usedReceipts.has(receipt)) errors.push(`Receipt No ${receipt} is already used`);
      }
      const ref = raw.transactionRef?.trim() || null;
      if (ref && usedRefs.has(ref.toLowerCase())) errors.push(`Transaction ID ${ref} is already recorded`);

      let action: 'create' | 'update' | 'error' = 'error';
      let figures: { amountPaise: number; discountPaise: number; lateFeePaise: number; dueDate: Date } | null = null;
      let k = '';
      if (student && structure && errors.length === 0) {
        const month = (dueGiven ?? paidOn ?? today).toISOString().slice(0, 7);
        const dueDate = dueGiven ?? dueDateIn(month, structure.dueDay);
        k = `${structure.id}|${student.id}|${periodOf(structure.frequency, dueDate, school.academicYearStartMonth)}`;
        const before = dues.get(k);
        figures = {
          amountPaise: amount(raw.amountDue, 'Amount Due', errors) ?? before?.amountPaise ?? structure.amountPaise,
          discountPaise: amount(raw.discount, 'Discount', errors) ?? before?.discountPaise ?? 0,
          lateFeePaise: amount(raw.lateFee, 'Late Fee', errors) ?? before?.lateFeePaise ?? 0,
          dueDate: dueGiven ?? before?.dueDate ?? dueDate,
        };
        const paidBefore = before?.paidPaise ?? 0;
        if (before && figures.amountPaise !== before.amountPaise && paidBefore > 0) {
          errors.push('Amount Due differs from the payments already recorded for this fee and period');
        }
        if (figures.discountPaise > figures.amountPaise + figures.lateFeePaise) errors.push("Discount can't be more than the amount due plus the late fee");
        if (paidBefore + paid > net(figures)) errors.push('Amount Paid is more than what is still due');
        if (errors.length === 0) {
          action = before ? 'update' : 'create';
          dues.set(k, { ...figures, paidPaise: paidBefore + paid, exists: before?.exists ?? false });
        }
      }

      if (action !== 'error' && paid > 0) {
        if (receipt) usedReceipts.add(receipt);
        if (ref) usedRefs.add(ref.toLowerCase());
      }

      return {
        row,
        label: [student?.fullName ?? raw.studentName ?? `Row ${row}`, structure?.name].filter(Boolean).join(' · '),
        action,
        errors,
        apply: action === 'error' ? null : { studentId: student!.id, structureId: structure!.id, key: k, figures: figures!, paid, method, receipt, ref, paidOn },
      };
    });

    if (!dto.dryRun) {
      await this.prisma.$transaction(async (tx) => {
        // The periods were worked out from each fee's frequency: lock the fees
        // and make sure none changed since the preview.
        const used = [...new Set(rows.flatMap((r) => (r.apply ? [r.apply.structureId] : [])))];
        for (const id of used) {
          await lockShared(tx, schoolId, id);
          const now = await tx.feeStructure.findUniqueOrThrow({ where: { id }, select: { frequency: true, name: true } });
          if (now.frequency !== structures.find((s) => s.id === id)!.frequency) {
            throw new BadRequestException(`${now.name} changed while the file was being checked. Nothing was imported; check the file again.`);
          }
        }
        for (const r of rows) {
          if (!r.apply) continue;
          const a = r.apply;
          const period = a.key.split('|')[2];
          try {
            const found = await tx.feeDue.findUnique({
              where: { structureId_studentId_period: { structureId: a.structureId, studentId: a.studentId, period } },
              select: { id: true, statusOverride: true, overrideReason: true, notes: true },
            });
            const dueId =
              found?.id ??
              (
                await tx.feeDue.create({
                  data: { schoolId, studentId: a.studentId, structureId: a.structureId, period, ...a.figures, netPaise: net(a.figures), createdById: userId },
                  select: { id: true },
                })
              ).id;
            await lock(tx, 'FeeDue', schoolId, dueId, 'Due not found');
            if (found) {
              await this.fees.adjustLocked(tx, schoolId, userId, dueId, {
                ...a.figures,
                statusOverride: found.statusOverride,
                overrideReason: found.overrideReason,
                notes: found.notes,
              });
            }
            if (a.paid > 0) {
              await this.fees.addPaymentLocked(tx, schoolId, userId, dueId, {
                amountPaise: a.paid,
                method: a.method!,
                receiptNumber: a.receipt,
                transactionRef: a.ref,
                paidOn: a.paidOn!,
                idempotencyKey: null,
                source: 'IMPORT',
              });
            }
          } catch (err) {
            // Something changed since the preview: nothing is saved, and the row says what.
            const message = err instanceof HttpException ? err.message : uniqueViolation(err) ? 'a receipt or transaction ID was recorded meanwhile' : null;
            if (message) throw new BadRequestException(`Row ${r.row}: ${message}. Nothing was imported; check the file again.`);
            throw err;
          }
        }
      }, TX);
    }
    return preview(rows, !dto.dryRun);
  }
}

function preview(rows: { row: number; label: string; action: 'create' | 'update' | 'error'; errors: string[] }[], applied: boolean): ImportPreview {
  return {
    applied,
    created: rows.filter((r) => r.action === 'create').length,
    updated: rows.filter((r) => r.action === 'update').length,
    skipped: rows.filter((r) => r.action === 'error').length,
    rows: rows.map(({ row, label, action, errors }) => ({ row, label, action, errors })),
  };
}
