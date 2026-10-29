import { Test } from '@nestjs/testing';
import { AccessService } from '../academic/access.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { FilesService } from '../storage/files.service.js';
import { SchoolsService } from './schools.service.js';

const auth = { userId: 'owner-1', sessionId: 's', activeSchoolId: null };

describe('Clear All Data is one transaction', () => {
  const deleteMany = vi.fn().mockResolvedValue({ count: 1 });
  const count = vi.fn().mockResolvedValue(1);
  const findMany = vi.fn().mockResolvedValue([{ key: 'schools/s/photo/1' }]);
  const removeObjects = vi.fn();
  const tx = new Proxy(
    {
      user: { findUniqueOrThrow: vi.fn().mockResolvedValue({ fullName: 'Owner' }) },
      recruitmentAuditLog: { create: vi.fn() },
    } as Record<string, unknown>,
    {
      get: (target, key: string) =>
        key in target
          ? target[key]
          : {
              deleteMany: (...args: unknown[]) => {
                deleted.push(key);
                return deleteMany(...args);
              },
              count,
              findMany,
            },
    },
  );
  /** Which models were cleared, in order. */
  const deleted: string[] = [];
  const transaction = vi.fn(async (run: (t: unknown) => unknown) => run(tx));
  // Outside the transaction, no model may be written.
  const outside = vi.fn();
  const prisma = new Proxy(
    {
      $transaction: transaction,
      school: { findUniqueOrThrow: vi.fn().mockResolvedValue({ name: 'Demo School' }) },
    } as Record<string, unknown>,
    {
      get: (target, key: string) =>
        key in target ? target[key] : { deleteMany: outside },
    },
  );
  let schools: SchoolsService;

  beforeEach(async () => {
    vi.clearAllMocks();
    deleted.length = 0;
    deleteMany.mockResolvedValue({ count: 1 });
    const moduleRef = await Test.createTestingModule({ providers: [SchoolsService] })
      .useMocker((token) => {
        if (token === PrismaService) return prisma;
        if (token === AccessService) return { assertOwner: vi.fn() };
        if (token === FilesService) return { removeObjects };
        return {};
      })
      .compile();
    schools = moduleRef.get(SchoolsService);
  });

  it('clears fee records, payments before the dues and fees they point at', async () => {
    await schools.clearAllData(auth, 'school-1', 'Demo School');
    const at = (model: string) => deleted.indexOf(model);
    for (const model of ['feePayment', 'feeDue', 'feeStructure', 'feeReceiptCounter']) expect(at(model)).toBeGreaterThanOrEqual(0);
    expect(at('feePayment')).toBeLessThan(at('feeDue'));
    expect(at('feeDue')).toBeLessThan(at('feeStructure'));
    expect(at('feeDue')).toBeLessThan(at('student'));
  });

  it("clears daily reports before the batches and faculty profiles they name", async () => {
    await schools.clearAllData(auth, 'school-1', 'Demo School');
    const i = deleted.indexOf('dailyReport');
    expect(i).toBeGreaterThanOrEqual(0);
    expect(deleteMany.mock.calls[i][0]).toEqual({ where: { schoolId: 'school-1' } });
    expect(i).toBeLessThan(deleted.indexOf('batch'));
    expect(i).toBeLessThan(deleted.indexOf('faculty'));
  });

  it('clears feedback before the faculty profiles it names', async () => {
    await schools.clearAllData(auth, 'school-1', 'Demo School');
    const i = deleted.indexOf('feedback');
    expect(i).toBeGreaterThanOrEqual(0);
    expect(deleteMany.mock.calls[i][0]).toEqual({ where: { schoolId: 'school-1' } });
    expect(i).toBeLessThan(deleted.indexOf('faculty'));
  });

  it('clears PTM notes before the students they are about', async () => {
    await schools.clearAllData(auth, 'school-1', 'Demo School');
    const i = deleted.indexOf('ptmNote');
    expect(i).toBeGreaterThanOrEqual(0);
    expect(deleteMany.mock.calls[i][0]).toEqual({ where: { schoolId: 'school-1' } });
    expect(i).toBeLessThan(deleted.indexOf('student'));
  });

  it('clears test results before students, tests before batches, questions before chapters and faculty', async () => {
    await schools.clearAllData(auth, 'school-1', 'Demo School');
    const at = (model: string) => deleted.indexOf(model);
    for (const model of ['testResult', 'test', 'question']) expect(deleteMany.mock.calls[at(model)][0]).toEqual({ where: { schoolId: 'school-1' } });
    expect(at('testResult')).toBeLessThan(at('student'));
    expect(at('test')).toBeLessThan(at('batch'));
    expect(at('question')).toBeLessThan(at('curriculumChapter'));
    expect(at('question')).toBeLessThan(at('faculty'));
  });

  it('clears daily ratings, progress reports and term marks before the students, batches and faculty they name', async () => {
    await schools.clearAllData(auth, 'school-1', 'Demo School');
    const at = (model: string) => deleted.indexOf(model);
    for (const model of ['dailyRating', 'progressReport', 'studentMark']) {
      expect(at(model)).toBeGreaterThanOrEqual(0);
      expect(deleteMany.mock.calls[at(model)][0]).toEqual({ where: { schoolId: 'school-1' } });
      expect(at(model)).toBeLessThan(at('student'));
      expect(at(model)).toBeLessThan(at('batch'));
    }
    expect(at('dailyRating')).toBeLessThan(at('faculty'));
  });

  it("clears the school's notifications (they are about chapters and reports that go)", async () => {
    await schools.clearAllData(auth, 'school-1', 'Demo School');
    const i = deleted.indexOf('notification');
    expect(i).toBeGreaterThanOrEqual(0);
    expect(deleteMany.mock.calls[i][0]).toEqual({ where: { schoolId: 'school-1' } });
  });

  it('clears calendar events', async () => {
    await schools.clearAllData(auth, 'school-1', 'Demo School');
    const i = deleted.indexOf('calendarEvent');
    expect(i).toBeGreaterThanOrEqual(0);
    expect(deleteMany.mock.calls[i][0]).toEqual({ where: { schoolId: 'school-1' } });
  });

  it('clears meetings (their agenda items go with them)', async () => {
    await schools.clearAllData(auth, 'school-1', 'Demo School');
    const i = deleted.indexOf('meeting');
    expect(i).toBeGreaterThanOrEqual(0);
    expect(deleteMany.mock.calls[i][0]).toEqual({ where: { schoolId: 'school-1' } });
  });

  it('the typed name must match, ignoring stray spaces but not capitals', async () => {
    await expect(schools.clearAllData(auth, 'school-1', 'demo school')).rejects.toThrow('Type the school name exactly to confirm');
    expect(transaction).not.toHaveBeenCalled();
    await schools.clearAllData(auth, 'school-1', '  Demo   School ');
    expect(transaction).toHaveBeenCalledTimes(1);
  });

  it('clears recruitment and academic data in the same transaction', async () => {
    await schools.clearAllData(auth, 'school-1', 'Demo School');
    expect(transaction).toHaveBeenCalledTimes(1);
    expect(outside).not.toHaveBeenCalled();
    // recruitment (4) + students, files and academic (12) deletes all went through the transaction
    expect(deleteMany.mock.calls.length).toBeGreaterThanOrEqual(16);
    // Stored files are removed only after the rows are gone.
    expect(removeObjects).toHaveBeenCalledWith(['schools/s/photo/1']);
  });

  it('linked faculty stay, and so do their photos; every other file of the school goes', async () => {
    await schools.clearAllData(auth, 'school-1', 'Demo School');
    const wheres = deleteMany.mock.calls.map((c) => (c[0] as { where: unknown }).where);
    expect(wheres).toContainEqual({ schoolId: 'school-1', userId: null });
    const unused = { schoolId: 'school-1', faculty: { none: {} } };
    expect(wheres).toContainEqual(unused);
    expect(findMany.mock.calls.map((c) => (c[0] as { where: unknown }).where)).toContainEqual(unused);
  });

  it('a failure part-way rolls everything back: no second transaction, nothing committed outside', async () => {
    // The academic half fails; recruitment data must not already be gone.
    deleteMany.mockImplementation(async () => {
      if (deleteMany.mock.calls.length > 5) throw new Error('boom');
      return { count: 1 };
    });
    await expect(
      schools.clearAllData(auth, 'school-1', 'Demo School'),
    ).rejects.toThrow('boom');
    expect(transaction).toHaveBeenCalledTimes(1);
    expect(outside).not.toHaveBeenCalled();
    // Nothing was committed, so no stored file may be deleted.
    expect(removeObjects).not.toHaveBeenCalled();
  });
});
