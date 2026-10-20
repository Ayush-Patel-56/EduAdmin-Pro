import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import type { SyllabusStatus } from '../generated/prisma/client.js';
import { PrismaService } from '../prisma/prisma.service.js';

/** The newest notifications the bell shows. */
export const NOTIFICATION_LIMIT = 30;
/** Read notifications older than this are pruned (by the daily digest job). */
export const NOTIFICATION_KEEP_DAYS = 60;

const STATUS_LABELS: Record<SyllabusStatus, string> = { NOT_STARTED: 'Not Started', IN_PROGRESS: 'In Progress', COMPLETED: 'Completed' };

/** A chapter whose syllabus status changed: what the Syllabus Updates alerts are about. */
export type SyllabusChange = { batchId: string; subject: string; title: string; status: SyllabusStatus };

/**
 * In-app notifications (the bell). Each one is for one user about one
 * school, created only when the user's Account Preferences ask for that kind,
 * and read only while the user is still an active member of that school.
 */
@Injectable()
export class NotificationsService {
  private readonly logger = new Logger(NotificationsService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * The user's newest notifications, from schools they are still an active
   * member of (and, as a teacher, still have an active profile in), with the
   * unread count.
   */
  async list(userId: string) {
    const schoolIds = await this.activeSchools(userId);
    const where = { userId, schoolId: { in: schoolIds } };
    const [unread, items] = await Promise.all([
      this.prisma.notification.count({ where: { ...where, readAt: null } }),
      this.prisma.notification.findMany({
        where,
        select: { id: true, kind: true, title: true, body: true, link: true, readAt: true, createdAt: true, school: { select: { id: true, name: true } } },
        orderBy: [{ createdAt: 'desc' }, { id: 'asc' }],
        take: NOTIFICATION_LIMIT,
      }),
    ]);
    return {
      unread,
      items: items.map((n) => ({ ...n, readAt: n.readAt?.toISOString() ?? null, createdAt: n.createdAt.toISOString() })),
    };
  }

  async markRead(userId: string, id: string) {
    const { count } = await this.prisma.notification.updateMany({ where: { id, userId }, data: { readAt: new Date() } });
    if (!count) throw new NotFoundException('Notification not found');
    return { ok: true };
  }

  async markAllRead(userId: string) {
    const { count } = await this.prisma.notification.updateMany({ where: { userId, readAt: null }, data: { readAt: new Date() } });
    return { read: count };
  }

  /**
   * Syllabus Updates: tells the school's admins, and the active teachers of
   * the batches concerned, that chapters changed status. Only users who keep
   * Syllabus Updates on are told, and never the person who made the change.
   * One notification per batch for each person: a single chapter is named,
   * an import of many is summed up. Never fails the change itself.
   */
  async syllabusChanged(schoolId: string, actorUserId: string, changes: SyllabusChange[]) {
    if (!changes.length) return;
    try {
      const batchIds = [...new Set(changes.map((c) => c.batchId))];
      const [actor, batches, members] = await Promise.all([
        this.prisma.user.findUnique({ where: { id: actorUserId }, select: { fullName: true } }),
        this.prisma.batch.findMany({ where: { schoolId, id: { in: batchIds } }, select: { id: true, name: true } }),
        this.prisma.schoolMembership.findMany({
          where: { schoolId, status: 'ACTIVE', userId: { not: actorUserId }, user: { syllabusUpdates: true } },
          select: {
            userId: true,
            role: true,
            user: { select: { facultyProfiles: { where: { schoolId, status: { not: 'INACTIVE' } }, select: { batchAssignments: { where: { batchId: { in: batchIds } }, select: { batchId: true } } } } } },
          },
        }),
      ]);
      const batchName = new Map(batches.map((b) => [b.id, b.name]));
      const by = actor?.fullName ?? 'Someone';
      const data = members.flatMap((m) => {
        const admin = m.role === 'ADMIN';
        const taught = new Set(m.user.facultyProfiles.flatMap((f) => f.batchAssignments.map((a) => a.batchId)));
        return batchIds
          .filter((b) => batchName.has(b) && (admin || taught.has(b)))
          .map((b) => {
            const mine = changes.filter((c) => c.batchId === b);
            const one = mine.length === 1 ? mine[0] : null;
            return {
              userId: m.userId,
              schoolId,
              kind: 'SYLLABUS_UPDATE' as const,
              title: one ? `${one.title}: ${STATUS_LABELS[one.status]}` : `${mine.length} syllabus chapters updated`,
              body: one
                ? `${batchName.get(b)} · ${one.subject} · by ${by}`
                : `${batchName.get(b)} · ${[...new Set(mine.map((c) => c.subject))].join(', ')} · by ${by}`,
              link: admin ? '/management/academic-planning' : '/teacher/academic-planning',
            };
          });
      });
      if (data.length) await this.prisma.notification.createMany({ data });
    } catch (err) {
      this.logger.warn(`Syllabus notifications for school ${schoolId} failed: ${(err as Error).message}`);
    }
  }

  /** Read notifications older than NOTIFICATION_KEEP_DAYS go. */
  async prune(now = new Date()) {
    const before = new Date(now.getTime() - NOTIFICATION_KEEP_DAYS * 86_400_000);
    const { count } = await this.prisma.notification.deleteMany({ where: { readAt: { not: null }, createdAt: { lt: before } } });
    return count;
  }

  private async activeSchools(userId: string) {
    const [memberships, profiles] = await Promise.all([
      this.prisma.schoolMembership.findMany({ where: { userId, status: 'ACTIVE' }, select: { schoolId: true, role: true } }),
      this.prisma.faculty.findMany({ where: { userId, status: { not: 'INACTIVE' } }, select: { schoolId: true } }),
    ]);
    const teaching = new Set(profiles.map((p) => p.schoolId));
    return memberships.filter((m) => m.role === 'ADMIN' || teaching.has(m.schoolId)).map((m) => m.schoolId);
  }
}
