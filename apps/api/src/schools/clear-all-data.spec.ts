import { Test } from '@nestjs/testing';
import { AccessService } from '../academic/access.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { SchoolsService } from './schools.service.js';

const auth = { userId: 'owner-1', sessionId: 's', activeSchoolId: null };

describe('Clear All Data is one transaction', () => {
  const deleteMany = vi.fn().mockResolvedValue({ count: 1 });
  const count = vi.fn().mockResolvedValue(1);
  const tx = new Proxy(
    {
      user: { findUniqueOrThrow: vi.fn().mockResolvedValue({ fullName: 'Owner' }) },
      recruitmentAuditLog: { create: vi.fn() },
    } as Record<string, unknown>,
    {
      get: (target, key: string) =>
        key in target ? target[key] : { deleteMany, count },
    },
  );
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
    deleteMany.mockResolvedValue({ count: 1 });
    const moduleRef = await Test.createTestingModule({ providers: [SchoolsService] })
      .useMocker((token) => {
        if (token === PrismaService) return prisma;
        if (token === AccessService) return { assertOwner: vi.fn() };
        return {};
      })
      .compile();
    schools = moduleRef.get(SchoolsService);
  });

  it('clears recruitment and academic data in the same transaction', async () => {
    await schools.clearAllData(auth, 'school-1', 'Demo School');
    expect(transaction).toHaveBeenCalledTimes(1);
    expect(outside).not.toHaveBeenCalled();
    // recruitment (4) + academic (10) deletes all went through the transaction
    expect(deleteMany.mock.calls.length).toBeGreaterThanOrEqual(14);
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
  });
});
