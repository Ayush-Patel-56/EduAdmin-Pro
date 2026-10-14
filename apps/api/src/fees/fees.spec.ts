import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { Prisma } from '../generated/prisma/client.js';
import { istToday } from '../common/dates.js';
import type { PrismaService } from '../prisma/prisma.service.js';
import { dueDateIn, outstanding, periodOf, rupees, statusOf, toPaise } from './fee-rules.js';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { AdjustDueDto, type RecordPaymentDto } from './fees.dto.js';
import { FeesImportService } from './fees-import.service.js';
import { FeesService, nextReceipt } from './fees.service.js';

const today = istToday();
const todayIso = today.toISOString().slice(0, 10);
const d = (iso: string) => new Date(`${iso}T00:00:00Z`);

describe('fee rules', () => {
  it('a due day the month lacks becomes its last day', () => {
    expect(dueDateIn('2026-02', 31).toISOString().slice(0, 10)).toBe('2026-02-28');
    expect(dueDateIn('2028-02', 30).toISOString().slice(0, 10)).toBe('2028-02-29');
    expect(dueDateIn('2026-11', 31).toISOString().slice(0, 10)).toBe('2026-11-30');
    expect(dueDateIn('2026-10', 5).toISOString().slice(0, 10)).toBe('2026-10-05');
  });

  it('periods: once, per month, per calendar quarter, per academic year (April start)', () => {
    expect(periodOf('ONE_TIME', d('2026-10-05'), 4)).toBe('ONCE');
    expect(periodOf('MONTHLY', d('2026-10-05'), 4)).toBe('2026-10');
    expect(periodOf('QUARTERLY', d('2026-04-05'), 4)).toBe('2026-Q2');
    expect(periodOf('QUARTERLY', d('2026-06-30'), 4)).toBe('2026-Q2');
    expect(periodOf('YEARLY', d('2027-03-31'), 4)).toBe('2026-27');
    expect(periodOf('YEARLY', d('2027-04-01'), 4)).toBe('2027-28');
  });

  it('status follows the amounts and the date; an override wins', () => {
    const base = { netPaise: 1000, paidPaise: 0, dueDate: d('2026-10-05'), statusOverride: null };
    const on = d('2026-10-01');
    expect(statusOf(base, on)).toBe('PENDING');
    expect(statusOf({ ...base, paidPaise: 400 }, on)).toBe('PARTIAL');
    expect(statusOf({ ...base, paidPaise: 400 }, d('2026-10-06'))).toBe('OVERDUE');
    expect(statusOf({ ...base, paidPaise: 1000 }, d('2026-12-01'))).toBe('PAID');
    expect(statusOf({ ...base, netPaise: 0 }, d('2026-12-01'))).toBe('PAID');
    expect(statusOf({ ...base, statusOverride: 'WAIVED' }, on)).toBe('WAIVED');
    expect(outstanding({ ...base, paidPaise: 400 })).toBe(600);
    expect(outstanding({ ...base, statusOverride: 'WAIVED' })).toBe(0);
  });

  it('money is whole paise, without float drift', () => {
    expect(toPaise(0.1 + 0.2)).toBe(30);
    expect(toPaise(12500.55)).toBe(1250055);
    expect(rupees(1250000)).toBe('₹12,500');
    expect(rupees(1250055)).toBe('₹12,500.55');
  });
});

function build() {
  const prisma = {
    student: { findFirst: vi.fn(), findMany: vi.fn().mockResolvedValue([]) },
    feeStructure: {
      findFirst: vi.fn(),
      findUniqueOrThrow: vi.fn().mockResolvedValue({ frequency: 'MONTHLY', name: 'Tuition' }),
      findMany: vi.fn().mockResolvedValue([]),
      count: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
    },
    school: { findUniqueOrThrow: vi.fn().mockResolvedValue({ academicYearStartMonth: 4 }) },
    program: { findMany: vi.fn().mockResolvedValue([]), findFirst: vi.fn() },
    batch: { findMany: vi.fn().mockResolvedValue([]), findFirst: vi.fn() },
    feeDue: {
      findUnique: vi.fn().mockResolvedValue(null),
      findUniqueOrThrow: vi.fn(),
      findMany: vi.fn().mockResolvedValue([]),
      create: vi.fn().mockResolvedValue({ id: 'due-1' }),
      createMany: vi.fn().mockResolvedValue({ count: 0 }),
      update: vi.fn(),
      count: vi.fn().mockResolvedValue(0),
      delete: vi.fn(),
      fields: { netPaise: { name: 'netPaise' } },
    },
    feePayment: {
      findUnique: vi.fn().mockResolvedValue(null),
      findUniqueOrThrow: vi.fn(),
      findFirst: vi.fn().mockResolvedValue(null),
      findMany: vi.fn().mockResolvedValue([]),
      create: vi.fn().mockResolvedValue({ id: 'pay-1' }),
      update: vi.fn(),
      count: vi.fn().mockResolvedValue(0),
    },
    $queryRaw: vi.fn().mockResolvedValue([{ id: 'x', last: 7 }]),
    $transaction: vi.fn(),
  };
  prisma.$transaction.mockImplementation((run: (tx: typeof prisma) => unknown) => run(prisma));
  const service = new FeesService(prisma as unknown as PrismaService);
  return { prisma, service, imports: new FeesImportService(prisma as unknown as PrismaService, service) };
}

const student = { id: 'st-1', fullName: 'Aarav', batchId: 'b1', programId: 'p1', batch: { name: 'Batch 1A' } };
const structure = { id: 'fs-1', name: 'Tuition', frequency: 'MONTHLY', batchId: null, programId: null, batch: null, program: null };
const record = (over: Partial<RecordPaymentDto> = {}) =>
  ({ studentId: 'st-1', structureId: 'fs-1', amountDue: 12500, discount: 0, lateFee: 0, dueDate: todayIso, amountPaid: 5000, method: 'UPI', ...over }) as RecordPaymentDto;

describe('FeesService.record', () => {
  it("a fee scoped to another batch can't be charged to the student", async () => {
    const { service, prisma } = build();
    prisma.student.findFirst.mockResolvedValue(student);
    prisma.feeStructure.findFirst.mockResolvedValue({ ...structure, batchId: 'b2', batch: { name: 'Batch 2' } });
    await expect(service.record('school-1', 'u', record())).rejects.toThrow('Tuition is for Batch 2; Aarav is in Batch 1A');
    expect(prisma.student.findFirst.mock.calls[0][0].where).toEqual({ id: 'st-1', schoolId: 'school-1' });
    expect(prisma.feeStructure.findFirst.mock.calls[0][0].where).toEqual({ id: 'fs-1', schoolId: 'school-1' });
  });

  it('a new due is created with its net, then the payment gets the next receipt and raises the paid total', async () => {
    const { service, prisma } = build();
    prisma.student.findFirst.mockResolvedValue(student);
    prisma.feeStructure.findFirst.mockResolvedValue(structure);
    prisma.feeDue.findUniqueOrThrow.mockResolvedValue({ netPaise: 1200000, paidPaise: 0 });
    const result = await service.record('school-1', 'admin', record({ discount: 500, lateFee: 0, transactionRef: 'UPI123' }));
    expect(prisma.feeDue.create.mock.calls[0][0].data).toMatchObject({
      period: todayIso.slice(0, 7),
      amountPaise: 1250000,
      discountPaise: 50000,
      netPaise: 1200000,
    });
    expect(result).toMatchObject({ dueId: 'due-1', created: true, receiptNumber: `REC-${todayIso.slice(0, 4)}-000007` });
    expect(prisma.feePayment.create.mock.calls[0][0].data).toMatchObject({ amountPaise: 500000, method: 'UPI', transactionRef: 'UPI123', source: 'MANUAL' });
    expect(prisma.feeDue.update.mock.calls.at(-1)![0]).toEqual({ where: { id: 'due-1' }, data: { paidPaise: { increment: 500000 } } });
  });

  it('paying more than is still due, or on a fully paid fee, is refused', async () => {
    const { service, prisma } = build();
    prisma.student.findFirst.mockResolvedValue(student);
    prisma.feeStructure.findFirst.mockResolvedValue(structure);
    prisma.feeDue.findUniqueOrThrow.mockResolvedValue({ netPaise: 1250000, paidPaise: 1000000 });
    await expect(service.record('school-1', 'u', record({ amountPaid: 5000 }))).rejects.toThrow('more than the ₹2,500 still due');
    prisma.feeDue.findUniqueOrThrow.mockResolvedValue({ netPaise: 1250000, paidPaise: 1250000 });
    await expect(service.record('school-1', 'u', record({ amountPaid: 1 }))).rejects.toThrow('already fully paid');
    expect(prisma.feePayment.create).not.toHaveBeenCalled();
  });

  it('a retried submit with the same idempotency key returns the first payment', async () => {
    const { service, prisma } = build();
    prisma.feePayment.findUnique.mockResolvedValueOnce({ id: 'pay-1', dueId: 'due-1', receiptNumber: 'REC-2026-000001', amountPaise: 500000, voidedAt: null, due: { studentId: 'st-1', structureId: 'fs-1' } });
    await expect(service.record('school-1', 'u', record({ idempotencyKey: '00000000-0000-4000-8000-000000000001' }))).resolves.toMatchObject({
      paymentId: 'pay-1',
      replayed: true,
    });
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it("an existing due: the amount is fixed once paid, and the net can't drop below what was paid", async () => {
    const { service, prisma } = build();
    prisma.student.findFirst.mockResolvedValue(student);
    prisma.feeStructure.findFirst.mockResolvedValue(structure);
    prisma.feeDue.findUnique.mockResolvedValue({ id: 'due-9' });
    prisma.feeDue.findUniqueOrThrow.mockResolvedValue({ amountPaise: 1250000, paidPaise: 500000, statusOverride: null, overrideReason: null });
    await expect(service.record('school-1', 'u', record({ amountDue: 10000, amountPaid: 0 }))).rejects.toThrow('fixed once a payment is recorded');
    await expect(service.record('school-1', 'u', record({ discount: 9000, amountPaid: 0 }))).rejects.toThrow("can't be lower than that");
  });

  it('an override needs a reason; who set it and when is stored', async () => {
    const { service, prisma } = build();
    prisma.student.findFirst.mockResolvedValue(student);
    prisma.feeStructure.findFirst.mockResolvedValue(structure);
    await expect(service.record('school-1', 'u', record({ amountPaid: 0, statusOverride: 'WAIVED' }))).rejects.toBeInstanceOf(BadRequestException);
    await service.record('school-1', 'admin-7', record({ amountPaid: 0, statusOverride: 'WAIVED', overrideReason: 'Scholarship' }));
    expect(prisma.feeDue.create.mock.calls[0][0].data).toMatchObject({ statusOverride: 'WAIVED', overrideReason: 'Scholarship', overrideById: 'admin-7' });
  });
});

/** Which row a raw lock query was for ("FeeDue" FOR UPDATE, "FeeStructure" FOR SHARE, …). */
const lockOf = (call: unknown[]) => {
  const sql = (call[0] as string[]).join('?');
  const raw = call.slice(1).find((v) => v && typeof v === 'object' && 'strings' in (v as object)) as { strings: string[] } | undefined;
  const table = (raw?.strings.join('') ?? sql.match(/FROM "(\w+)"/)?.[1] ?? '').replace(/"/g, '');
  return `${table} ${sql.includes('FOR SHARE') ? 'SHARE' : 'UPDATE'}`;
};

describe('review of #20', () => {
  it("Record Payment on an existing due locks it before checking and changing its figures", async () => {
    const { service, prisma } = build();
    prisma.student.findFirst.mockResolvedValue(student);
    prisma.feeStructure.findFirst.mockResolvedValue(structure);
    prisma.feeDue.findUnique.mockResolvedValue({ id: 'due-9' });
    prisma.feeDue.findUniqueOrThrow.mockResolvedValue({ amountPaise: 1250000, discountPaise: 0, lateFeePaise: 0, paidPaise: 0, netPaise: 1250000, statusOverride: null, overrideReason: null });
    await service.record('school-1', 'u', record({ amountPaid: 0, discount: 600 }));
    const locks = prisma.$queryRaw.mock.calls.map(lockOf);
    expect(locks).toEqual(['FeeStructure SHARE', 'FeeDue UPDATE']);
    const dueLock = prisma.$queryRaw.mock.invocationCallOrder[1];
    expect(dueLock).toBeLessThan(prisma.feeDue.findUniqueOrThrow.mock.invocationCallOrder[0]);
    expect(prisma.$queryRaw.mock.calls[1].slice(-2)).toEqual(['due-9', 'school-1']);
  });

  it('Add Payment locks the due before reading what is left to pay', async () => {
    const { service, prisma } = build();
    prisma.feeDue.findUniqueOrThrow.mockResolvedValue({ netPaise: 100000, paidPaise: 0 });
    await service.addPayment('school-1', 'u', 'due-1', { amountPaid: 100, method: 'CASH' });
    expect(lockOf(prisma.$queryRaw.mock.calls[0])).toBe('FeeDue UPDATE');
    expect(prisma.$queryRaw.mock.invocationCallOrder[0]).toBeLessThan(prisma.feeDue.findUniqueOrThrow.mock.invocationCallOrder[0]);
  });

  it("once a fee has dues, its frequency and scope can't change (that would bill twice); its amount can", async () => {
    const { service, prisma } = build();
    prisma.feeStructure.findUniqueOrThrow.mockResolvedValue({ frequency: 'MONTHLY', programId: null, batchId: null, _count: { dues: 2 } });
    const body = { category: 'MONTHLY_TUITION', name: 'Tuition', amount: 1000, frequency: 'MONTHLY', dueDay: 5, mandatory: true, academicYear: '2026-27' } as never;
    await expect(service.updateStructure('school-1', 'fs-1', { ...(body as object), frequency: 'YEARLY' } as never)).rejects.toThrow(
      "2 student dues are already billed from this fee, so its frequency can't change",
    );
    prisma.batch.findFirst.mockResolvedValue({ programId: 'p1' });
    prisma.program.findFirst.mockResolvedValue({ id: 'p1' });
    await expect(service.updateStructure('school-1', 'fs-1', { ...(body as object), batchId: 'b1' } as never)).rejects.toThrow('program or batch');
    expect(prisma.feeStructure.update).not.toHaveBeenCalled();
    await service.updateStructure('school-1', 'fs-1', { ...(body as object), amount: 1500 } as never);
    expect(prisma.feeStructure.update.mock.calls[0][0].data).toMatchObject({ amountPaise: 150000 });
    expect(lockOf(prisma.$queryRaw.mock.calls[0])).toBe('FeeStructure UPDATE');
  });

  it('assessing reads the fee under a shared lock', async () => {
    const { service, prisma } = build();
    prisma.feeStructure.findUniqueOrThrow.mockResolvedValue({ id: 'fs-1', mandatory: true, dueDay: 5, frequency: 'MONTHLY', amountPaise: 100, programId: null, batchId: null });
    await service.assess('school-1', 'u', 'fs-1', { month: '2026-11' });
    expect(lockOf(prisma.$queryRaw.mock.calls[0])).toBe('FeeStructure SHARE');
  });

  it('an idempotency key reused for another payment, or for a voided one, is a 409', async () => {
    const { service, prisma } = build();
    const key = '00000000-0000-4000-8000-000000000001';
    prisma.feePayment.findUnique.mockResolvedValueOnce({ id: 'p1', dueId: 'due-1', receiptNumber: 'R1', amountPaise: 500000, voidedAt: null, due: { studentId: 'other', structureId: 'fs-1' } });
    await expect(service.record('school-1', 'u', record({ idempotencyKey: key }))).rejects.toThrow('already used for a different payment');
    prisma.feePayment.findUnique.mockResolvedValueOnce({ id: 'p1', dueId: 'due-1', receiptNumber: 'R1', amountPaise: 10000, voidedAt: new Date(), due: { studentId: 'st-1', structureId: 'fs-1' } });
    await expect(service.addPayment('school-1', 'u', 'due-1', { amountPaid: 100, method: 'CASH', idempotencyKey: key })).rejects.toThrow('Receipt R1 from this form was voided');
  });

  it('a lost idempotency race returns the payment that won', async () => {
    const { service, prisma } = build();
    const key = '00000000-0000-4000-8000-000000000002';
    prisma.feePayment.findUnique
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ id: 'p-won', dueId: 'due-1', receiptNumber: 'R9', amountPaise: 10000, voidedAt: null, due: { studentId: 'st-1', structureId: 'fs-1' } });
    prisma.$transaction.mockRejectedValueOnce(
      new Prisma.PrismaClientKnownRequestError('dup', { code: 'P2002', clientVersion: 't', meta: { target: ['FeePayment_schoolId_idempotencyKey_key'] } }),
    );
    await expect(service.addPayment('school-1', 'u', 'due-1', { amountPaid: 100, method: 'CASH', idempotencyKey: key })).resolves.toMatchObject({ paymentId: 'p-won', replayed: true });
  });

  it('a discount above the amount plus late fee, or a fee for another program, is refused', async () => {
    const { service, prisma } = build();
    prisma.student.findFirst.mockResolvedValue(student);
    prisma.feeStructure.findFirst.mockResolvedValue(structure);
    await expect(service.record('school-1', 'u', record({ discount: 13000, lateFee: 400, amountPaid: 0 }))).rejects.toThrow("discount can't be more than");
    prisma.feeStructure.findFirst.mockResolvedValue({ ...structure, programId: 'p-other', program: { name: 'NEET' } });
    await expect(service.record('school-1', 'u', record())).rejects.toThrow("Tuition is for the NEET program; Aarav isn't in it");
    expect(prisma.feeDue.create).not.toHaveBeenCalled();
  });

  it('a due becomes Overdue the day after its due date, not on it', async () => {
    const due = { netPaise: 1000, paidPaise: 0, dueDate: d('2026-10-05'), statusOverride: null };
    expect(statusOf(due, d('2026-10-05'))).toBe('PENDING');
    expect(statusOf(due, d('2026-10-06'))).toBe('OVERDUE');
    const { service, prisma } = build();
    prisma.feeDue.count = vi.fn().mockResolvedValue(0);
    await service.dues('school-1', { status: 'OVERDUE' });
    const where = prisma.feeDue.findMany.mock.calls[0][0].where.AND[1].OR[1];
    expect(where.dueDate).toEqual({ lt: today });
  });

  it('a missing override reason says so (not a length error)', async () => {
    const dto = plainToInstance(AdjustDueDto, { amountDue: 100, discount: 0, lateFee: 0, dueDate: '2026-10-05', statusOverride: 'WAIVED', overrideReason: '  ' });
    const errors = await validate(dto);
    // The API reports the first message, as main.ts does.
    expect(errors.flatMap((e) => Object.values(e.constraints ?? {}))[0]).toBe('Give a reason for overriding the status');
  });

  it('the payment import locks each due before changing it, and stops if a fee changed since the preview', async () => {
    const { imports, prisma } = build();
    prisma.student.findMany.mockResolvedValue([{ id: 'st-1', fullName: 'A', rollNumber: '1', admissionNumber: null, batchId: null, programId: null }]);
    prisma.feeStructure.findMany.mockResolvedValue([{ id: 'fs-1', name: 'Tuition', frequency: 'MONTHLY', dueDay: 5, amountPaise: 1000, batchId: null, programId: null }]);
    prisma.feeStructure.findUniqueOrThrow.mockResolvedValue({ frequency: 'MONTHLY', name: 'Tuition' });
    prisma.feeDue.findUniqueOrThrow.mockResolvedValue({ amountPaise: 1000, discountPaise: 0, lateFeePaise: 0, netPaise: 1000, paidPaise: 0, statusOverride: null, overrideReason: null });
    prisma.feeDue.findUnique.mockResolvedValue({ id: 'due-1', statusOverride: null, overrideReason: null, notes: null });
    await imports.payments('school-1', 'u', { dryRun: false, rows: [{ rollNumber: '1', structureName: 'Tuition', amountPaid: '5', method: 'Cash' }] });
    const locks = prisma.$queryRaw.mock.calls.map(lockOf);
    expect(locks.slice(0, 2)).toEqual(['FeeStructure SHARE', 'FeeDue UPDATE']);
    expect(prisma.$queryRaw.mock.invocationCallOrder[1]).toBeLessThan(prisma.feeDue.findUniqueOrThrow.mock.invocationCallOrder[0]);
    prisma.feeStructure.findUniqueOrThrow.mockResolvedValue({ frequency: 'YEARLY', name: 'Tuition' });
    await expect(imports.payments('school-1', 'u', { dryRun: false, rows: [{ rollNumber: '1', structureName: 'Tuition', amountPaid: '5', method: 'Cash' }] })).rejects.toThrow('Tuition changed while the file was being checked');
  });
});

describe('FeesService payments', () => {
  it('a transaction ID or receipt number already in use is a 409; a future paid date is refused', async () => {
    const { service, prisma } = build();
    prisma.feeDue.findUniqueOrThrow.mockResolvedValue({ netPaise: 100000, paidPaise: 0 });
    const pay = { amountPaise: 1000, method: 'UPI' as const, receiptNumber: null, transactionRef: 'T1', paidOn: today, idempotencyKey: null, source: 'MANUAL' as const };
    prisma.feePayment.findFirst.mockResolvedValueOnce({ receiptNumber: 'REC-2026-000003' });
    await expect(service.addPaymentLocked(prisma as never, 's', 'u', 'due-1', pay)).rejects.toThrow('Transaction ID T1 is already recorded (receipt REC-2026-000003)');
    expect(prisma.feePayment.findFirst.mock.calls[0][0].where).toEqual({ schoolId: 's', voidedAt: null, transactionRef: { equals: 'T1', mode: 'insensitive' } });
    prisma.feePayment.findUnique.mockResolvedValueOnce({ id: 'other' });
    await expect(service.addPaymentLocked(prisma as never, 's', 'u', 'due-1', { ...pay, transactionRef: null, receiptNumber: 'R-1' })).rejects.toBeInstanceOf(ConflictException);
    await expect(service.addPaymentLocked(prisma as never, 's', 'u', 'due-1', { ...pay, paidOn: d('2999-01-01') })).rejects.toThrow('future');
    expect(prisma.feePayment.create).not.toHaveBeenCalled();
  });

  it('automatic receipts skip a number already typed by hand', async () => {
    const { prisma } = build();
    prisma.$queryRaw.mockResolvedValueOnce([{ last: 4 }]).mockResolvedValueOnce([{ last: 5 }]);
    prisma.feePayment.findUnique.mockResolvedValueOnce({ id: 'typed' }).mockResolvedValueOnce(null);
    await expect(nextReceipt(prisma as never, 's', 2026)).resolves.toBe('REC-2026-000005');
  });

  it('voiding locks the due, keeps the payment with a reason and lowers the paid total; twice is a 409', async () => {
    const { service, prisma } = build();
    prisma.feePayment.findFirst.mockResolvedValue({ dueId: 'due-1' });
    prisma.feePayment.findUniqueOrThrow.mockResolvedValue({ id: 'pay-1', dueId: 'due-1', amountPaise: 5000, voidedAt: null, receiptNumber: 'R1' });
    await service.voidPayment('school-1', 'admin', 'pay-1', { reason: 'Entered twice' });
    expect(prisma.$queryRaw.mock.invocationCallOrder[0]).toBeLessThan(prisma.feePayment.update.mock.invocationCallOrder[0]);
    expect(prisma.feePayment.update.mock.calls[0][0].data).toMatchObject({ voidedById: 'admin', voidReason: 'Entered twice' });
    expect(prisma.feeDue.update.mock.calls[0][0]).toEqual({ where: { id: 'due-1' }, data: { paidPaise: { decrement: 5000 } } });
    prisma.feePayment.findUniqueOrThrow.mockResolvedValue({ voidedAt: new Date(), receiptNumber: 'R1' });
    await expect(service.voidPayment('school-1', 'admin', 'pay-1', { reason: 'x' })).rejects.toBeInstanceOf(ConflictException);
    prisma.feePayment.findFirst.mockResolvedValue(null);
    await expect(service.voidPayment('school-1', 'admin', 'foreign', { reason: 'x' })).rejects.toBeInstanceOf(NotFoundException);
  });

  it('a due with payment history and a fee structure with dues are kept', async () => {
    const { service, prisma } = build();
    prisma.feePayment.count.mockResolvedValueOnce(1);
    await expect(service.deleteDue('school-1', 'due-1')).rejects.toThrow('payment history');
    prisma.feeDue.count.mockResolvedValueOnce(3);
    await expect(service.deleteStructure('school-1', 'fs-1')).rejects.toThrow('3 student dues use this fee structure');
    expect(prisma.feeDue.delete).not.toHaveBeenCalled();
    expect(prisma.feeStructure.delete).not.toHaveBeenCalled();
  });
});

describe('FeesService.assess', () => {
  it('only a mandatory fee is assessed, for the active students in its scope, once per period', async () => {
    const { service, prisma } = build();
    prisma.feeStructure.findUniqueOrThrow.mockResolvedValueOnce({ id: 'fs-1', mandatory: false });
    await expect(service.assess('school-1', 'u', 'fs-1', { month: '2026-11' })).rejects.toThrow('Only mandatory fees');
    prisma.feeStructure.findUniqueOrThrow.mockResolvedValueOnce({ id: 'fs-1', mandatory: true, dueDay: 31, frequency: 'MONTHLY', amountPaise: 100, programId: 'p1', batchId: null });
    prisma.student.findMany.mockResolvedValueOnce([{ id: 'a' }, { id: 'b' }]);
    prisma.feeDue.createMany.mockResolvedValueOnce({ count: 1 });
    await expect(service.assess('school-1', 'u', 'fs-1', { month: '2026-11' })).resolves.toEqual({ period: '2026-11', dueDate: '2026-11-30', created: 1, alreadyAssessed: 1 });
    expect(prisma.student.findMany.mock.calls[0][0].where).toEqual({ schoolId: 'school-1', status: 'ACTIVE', programId: 'p1' });
    expect(prisma.feeDue.createMany.mock.calls[0][0].skipDuplicates).toBe(true);
  });
});

describe('FeesService.summary', () => {
  it('reads sums as numbers; no rate before anything is billed', async () => {
    const { service, prisma } = build();
    prisma.$queryRaw
      .mockResolvedValueOnce([{ month: 500n, total: 900n }])
      .mockResolvedValueOnce([{ pending: 0n, pendingStudents: 0, overdue: 0, recovered: 0n, billed: 0n, dues: 0 }]);
    await expect(service.summary('school-1')).resolves.toMatchObject({ collectedThisMonthPaise: 500, collectedAllTimePaise: 900, collectionRate: null });
    prisma.$queryRaw
      .mockResolvedValueOnce([{ month: 0n, total: 0n }])
      .mockResolvedValueOnce([{ pending: 100n, pendingStudents: 1, overdue: 1, recovered: 300n, billed: 400n, dues: 2 }]);
    await expect(service.summary('school-1')).resolves.toMatchObject({ collectionRate: 75, pendingPaise: 100, overdueAccounts: 1 });
  });
});

describe('FeesImportService', () => {
  it('fee structures: names, categories and frequencies are read leniently; problems are listed per row', async () => {
    const { imports, prisma } = build();
    prisma.program.findMany.mockResolvedValue([{ id: 'p1', name: 'STEM' }]);
    prisma.batch.findMany.mockResolvedValue([{ id: 'b1', name: 'JEE 2026-A', programId: 'p1' }]);
    prisma.feeStructure.findMany.mockResolvedValue([{ id: 'fs-old', name: 'Exam Fee', frequency: 'QUARTERLY', programId: null, batchId: null, _count: { dues: 0 } }]);
    const result = await imports.structures('school-1', 'u', {
      dryRun: true,
      rows: [
        { name: 'Tuition', category: 'Monthly Tuition', amount: '12,500', frequency: 'Monthly', mandatory: 'Yes', program: 'STEM', batch: 'JEE 2026-A', academicYear: '2026-27' },
        { name: 'exam fee', category: 'Exam Fee', amount: '2500', frequency: 'Quarterly', program: 'All Programs', batch: 'All Batches' },
        { name: 'Tuition', category: 'Bus', amount: 'abc', frequency: 'Weekly', dueDay: '40', academicYear: '2026-28' },
      ],
    });
    expect(result.rows.map((r) => r.action)).toEqual(['create', 'update', 'error']);
    expect(result.rows[2].errors).toEqual([
      'Fee Category must be Registration Fee, Monthly Tuition, Exam Fee, Material Fee or Other',
      'Amount must be an amount in rupees, like 12500',
      'Frequency must be One-time, Monthly, Quarterly or Yearly',
      'Due Day must be a day of the month (1-31)',
      'Academic Year must look like 2026-27',
      'Same fee name as row 2',
    ]);
  });

  it('fee payments: the roll number must be the named student, and rows for one due add up', async () => {
    const { imports, prisma } = build();
    prisma.student.findMany.mockResolvedValue([{ id: 'st-1', fullName: 'Aarav Sharma', rollNumber: 'RN-101', admissionNumber: null, batchId: 'b1', programId: 'p1' }]);
    prisma.feeStructure.findMany.mockResolvedValue([{ id: 'fs-1', name: 'Tuition', frequency: 'MONTHLY', dueDay: 5, amountPaise: 1000000, batchId: null, programId: null }]);
    const month = todayIso.slice(0, 7);
    const result = await imports.payments('school-1', 'u', {
      dryRun: true,
      rows: [
        { rollNumber: 'rn-101', studentName: 'Aarav Sharma', structureName: 'tuition', amountPaid: '6000', method: 'UPI/QR', transactionRef: 'T-9', dueDate: `${month}-01` },
        { rollNumber: 'RN-101', studentName: 'Aarav Sharma', structureName: 'Tuition', amountPaid: '5000', method: 'Cash', dueDate: `${month}-01` },
        { rollNumber: 'RN-101', studentName: 'Someone Else', structureName: 'Tuition', amountPaid: '100', method: 'Cash' },
        { rollNumber: 'RN-101', studentName: 'Aarav Sharma', structureName: 'Tuition', amountPaid: '100', method: 'Bitcoin', transactionRef: 't-9' },
      ],
    });
    expect(result.rows.map((r) => r.action)).toEqual(['create', 'error', 'error', 'error']);
    expect(result.rows[1].errors).toEqual(['Amount Paid is more than what is still due']);
    expect(result.rows[2].errors).toEqual(['Roll No RN-101 is Aarav Sharma, not Someone Else']);
    expect(result.rows[3].errors).toEqual([
      'Payment Method must be UPI, Cash, Card, Net Banking, Cheque or DD',
      'Transaction ID t-9 is already recorded',
    ]);
  });

  it('applying: a problem found at save time names the row and saves nothing', async () => {
    const { imports, prisma } = build();
    prisma.student.findMany.mockResolvedValue([{ id: 'st-1', fullName: 'A', rollNumber: '1', admissionNumber: null, batchId: null, programId: null }]);
    prisma.feeStructure.findMany.mockResolvedValue([{ id: 'fs-1', name: 'Tuition', frequency: 'MONTHLY', dueDay: 5, amountPaise: 1000, batchId: null, programId: null }]);
    prisma.feeDue.findUniqueOrThrow.mockResolvedValue({ netPaise: 1000, paidPaise: 1000 });
    await expect(
      imports.payments('school-1', 'u', { dryRun: false, rows: [{ rollNumber: '1', structureName: 'Tuition', amountPaid: '5', method: 'Cash' }] }),
    ).rejects.toThrow('Row 2: This fee is already fully paid. Nothing was imported');
  });
});

describe('FeesService: a lost race on a unique index is a 409, not a 500', () => {
  it('maps the receipt and transaction indexes', async () => {
    const { service, prisma } = build();
    prisma.student.findFirst.mockResolvedValue(student);
    prisma.feeStructure.findFirst.mockResolvedValue(structure);
    prisma.$transaction.mockRejectedValueOnce(
      new Prisma.PrismaClientKnownRequestError('dup', { code: 'P2002', clientVersion: 't', meta: { target: ['FeePayment_schoolId_transactionRef_key'] } }),
    );
    await expect(service.record('school-1', 'u', record())).rejects.toEqual(new ConflictException('That transaction ID is already recorded'));
  });
});
