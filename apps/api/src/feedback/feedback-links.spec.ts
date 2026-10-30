import { NotFoundException } from '@nestjs/common';
import type { PrismaService } from '../prisma/prisma.service.js';
import { FeedbackLinksService } from './feedback-links.service.js';

const OLD_TOKEN = 'old-token-old-token-old-token-old-token-old';
const batch = (links: { token: string; active: boolean }[] = []) => ({ id: 'batch-1', name: 'JEE A', program: { name: 'JEE' }, feedbackLinks: links });

function build() {
  const prisma = {
    batch: {
      findFirst: vi.fn().mockResolvedValue(batch()),
      findMany: vi.fn().mockResolvedValue([]),
    },
    feedbackLink: {
      upsert: vi.fn().mockResolvedValue({ token: 'new-token', active: true }),
      updateMany: vi.fn().mockResolvedValue({ count: 1 }),
    },
  };
  return { prisma, service: new FeedbackLinksService(prisma as unknown as PrismaService) };
}

describe('FeedbackLinksService', () => {
  it("create is idempotent per batch and refuses another school's batch", async () => {
    const { prisma, service } = build();
    await expect(service.create('school-1', 'admin-1', 'batch-1')).resolves.toEqual({
      batchId: 'batch-1',
      batchName: 'JEE A',
      programName: 'JEE',
      token: 'new-token',
      active: true,
    });
    expect(prisma.batch.findFirst.mock.calls[0][0].where).toEqual({ id: 'batch-1', schoolId: 'school-1' });
    const upsert = prisma.feedbackLink.upsert.mock.calls[0][0];
    expect(upsert.where).toEqual({ batchId: 'batch-1' });
    expect(upsert.update).toEqual({}); // a second create keeps the link (and its token) as it is
    expect(upsert.create).toMatchObject({ schoolId: 'school-1', batchId: 'batch-1', createdById: 'admin-1' });

    prisma.batch.findFirst.mockResolvedValueOnce(null);
    await expect(service.create('school-1', 'admin-1', 'batch-of-another-school')).rejects.toThrow(NotFoundException);
    expect(prisma.feedbackLink.upsert).toHaveBeenCalledTimes(1);
  });

  it('regenerate gives a different 43-character base64url token', async () => {
    const { prisma, service } = build();
    prisma.batch.findFirst.mockResolvedValue(batch([{ token: OLD_TOKEN, active: true }]));
    await service.regenerate('school-1', 'batch-1');
    const call = prisma.feedbackLink.updateMany.mock.calls[0][0];
    expect(call.where).toEqual({ batchId: 'batch-1', schoolId: 'school-1' });
    expect(call.data.token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(call.data.token).not.toBe(OLD_TOKEN);
    expect(FeedbackLinksService.newToken()).not.toBe(FeedbackLinksService.newToken());
  });

  it('setActive and regenerate on a batch with no link are 404', async () => {
    const { prisma, service } = build();
    prisma.feedbackLink.updateMany.mockResolvedValue({ count: 0 });
    await expect(service.setActive('school-1', 'batch-1', false)).rejects.toThrow(NotFoundException);
    await expect(service.regenerate('school-1', 'batch-1')).rejects.toThrow(NotFoundException);
    expect(prisma.feedbackLink.updateMany.mock.calls[0][0]).toEqual({ where: { batchId: 'batch-1', schoolId: 'school-1' }, data: { active: false } });
  });

  it('lists every batch of the school with its link, or none', async () => {
    const { prisma, service } = build();
    prisma.batch.findMany.mockResolvedValue([batch([{ token: 't1', active: false }]), { ...batch(), id: 'batch-2', name: 'JEE B' }]);
    await expect(service.list('school-1')).resolves.toEqual([
      { batchId: 'batch-1', batchName: 'JEE A', programName: 'JEE', token: 't1', active: false },
      { batchId: 'batch-2', batchName: 'JEE B', programName: 'JEE', token: null, active: false },
    ]);
    const call = prisma.batch.findMany.mock.calls[0][0];
    expect(call.where).toEqual({ schoolId: 'school-1' });
    expect(call.orderBy).toEqual([{ program: { name: 'asc' } }, { name: 'asc' }]);
  });
});
