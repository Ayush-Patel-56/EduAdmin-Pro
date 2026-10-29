import { randomBytes } from 'node:crypto';
import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '../generated/prisma/client.js';
import { PrismaService } from '../prisma/prisma.service.js';

/** A batch and its student feedback link; a batch without one has `token: null`. */
export type LinkRow = { batchId: string; batchName: string; programName: string; token: string | null; active: boolean };

const BATCH_WITH_LINK = {
  id: true,
  name: true,
  program: { select: { name: true } },
  feedbackLinks: { select: { token: true, active: true } },
} satisfies Prisma.BatchSelect;
type BatchWithLink = Prisma.BatchGetPayload<{ select: typeof BATCH_WITH_LINK }>;

const toRow = (batch: BatchWithLink, link = batch.feedbackLinks[0]): LinkRow => ({
  batchId: batch.id,
  batchName: batch.name,
  programName: batch.program.name,
  token: link?.token ?? null,
  active: link?.active ?? false,
});

/**
 * Each batch's public student feedback link (one per batch). Only admins reach
 * this; the token is the link's only secret, so replacing it stops the old link.
 */
@Injectable()
export class FeedbackLinksService {
  constructor(private readonly prisma: PrismaService) {}

  /** 32 random bytes as base64url: 43 characters, safe in a URL. */
  static newToken(): string {
    return randomBytes(32).toString('base64url');
  }

  async list(schoolId: string): Promise<LinkRow[]> {
    const batches = await this.prisma.batch.findMany({
      where: { schoolId },
      select: BATCH_WITH_LINK,
      orderBy: [{ program: { name: 'asc' } }, { name: 'asc' }],
    });
    return batches.map((b) => toRow(b));
  }

  /** Gives the batch a link, or returns the one it has. */
  async create(schoolId: string, userId: string, batchId: string): Promise<LinkRow> {
    const batch = await this.batch(schoolId, batchId);
    try {
      const link = await this.prisma.feedbackLink.upsert({
        where: { batchId },
        create: { schoolId, batchId, token: FeedbackLinksService.newToken(), createdById: userId },
        update: {},
        select: { token: true, active: true },
      });
      return toRow(batch, link);
    } catch (e) {
      // Two admins creating it at once: the other one won, so show theirs.
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') return toRow(await this.batch(schoolId, batchId));
      throw e;
    }
  }

  async setActive(schoolId: string, batchId: string, active: boolean): Promise<LinkRow> {
    return this.updateLink(schoolId, batchId, { active });
  }

  /** A new token: the old link stops working at once. */
  async regenerate(schoolId: string, batchId: string): Promise<LinkRow> {
    return this.updateLink(schoolId, batchId, { token: FeedbackLinksService.newToken() });
  }

  private async updateLink(schoolId: string, batchId: string, data: Prisma.FeedbackLinkUpdateManyMutationInput): Promise<LinkRow> {
    const { count } = await this.prisma.feedbackLink.updateMany({ where: { batchId, schoolId }, data });
    if (!count) throw new NotFoundException('This batch has no feedback link');
    return toRow(await this.batch(schoolId, batchId));
  }

  private async batch(schoolId: string, batchId: string): Promise<BatchWithLink> {
    const batch = await this.prisma.batch.findFirst({ where: { id: batchId, schoolId }, select: BATCH_WITH_LINK });
    if (!batch) throw new NotFoundException('Batch not found');
    return batch;
  }
}
