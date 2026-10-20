import { BadRequestException, NotFoundException } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import type { MailService } from '../auth/mail.service.js';
import { Prisma } from '../generated/prisma/client.js';
import type { PrismaService } from '../prisma/prisma.service.js';
import { SyllabusService } from '../academic/syllabus.service.js';
import { DigestScheduler } from './digest.scheduler.js';
import { DigestService, compose, type Digest } from './digest.service.js';
import { NotificationsService } from './notifications.service.js';

function prismaMock() {
  return {
    notification: { count: vi.fn().mockResolvedValue(0), findMany: vi.fn().mockResolvedValue([]), updateMany: vi.fn().mockResolvedValue({ count: 1 }), createMany: vi.fn(), deleteMany: vi.fn().mockResolvedValue({ count: 0 }) },
    schoolMembership: { findMany: vi.fn().mockResolvedValue([]) },
    user: { findUnique: vi.fn().mockResolvedValue({ fullName: 'Ravi Kumar' }), findMany: vi.fn().mockResolvedValue([]), findUniqueOrThrow: vi.fn() },
    batch: { findMany: vi.fn().mockResolvedValue([]) },
    dailyReport: { findMany: vi.fn().mockResolvedValue([]) },
    faculty: { findMany: vi.fn().mockResolvedValue([]) },
    emailDigest: { create: vi.fn(), updateMany: vi.fn().mockResolvedValue({ count: 0 }), findUniqueOrThrow: vi.fn(), update: vi.fn(), deleteMany: vi.fn() },
    syllabusItem: { findFirst: vi.fn(), update: vi.fn() },
    $queryRaw: vi.fn(),
    $transaction: vi.fn(),
  };
}

describe('NotificationsService: the bell', () => {
  it("lists only the caller's notifications from schools they are still active in (as a teacher, with an active profile)", async () => {
    const prisma = prismaMock();
    prisma.schoolMembership.findMany.mockResolvedValue([{ schoolId: 's1', role: 'ADMIN' }, { schoolId: 's2', role: 'TEACHER' }, { schoolId: 's3', role: 'TEACHER' }]);
    // Their profile in s3 is inactive: its alerts are out of reach, as its pages are (#54).
    prisma.faculty.findMany.mockResolvedValue([{ schoolId: 's2' }]);
    prisma.notification.count.mockResolvedValue(2);
    const service = new NotificationsService(prisma as unknown as PrismaService);
    await expect(service.list('u1')).resolves.toMatchObject({ unread: 2, items: [] });
    expect(prisma.schoolMembership.findMany.mock.calls[0][0].where).toEqual({ userId: 'u1', status: 'ACTIVE' });
    expect(prisma.faculty.findMany.mock.calls[0][0].where).toEqual({ userId: 'u1', status: { not: 'INACTIVE' } });
    expect(prisma.notification.findMany.mock.calls[0][0].where).toEqual({ userId: 'u1', schoolId: { in: ['s1', 's2'] } });
    expect(prisma.notification.count.mock.calls[0][0].where).toEqual({ userId: 'u1', schoolId: { in: ['s1', 's2'] }, readAt: null });
  });

  it("marks read only the caller's own; someone else's (or none) is a 404", async () => {
    const prisma = prismaMock();
    const service = new NotificationsService(prisma as unknown as PrismaService);
    await service.markRead('u1', 'n1');
    expect(prisma.notification.updateMany.mock.calls[0][0].where).toEqual({ id: 'n1', userId: 'u1' });
    prisma.notification.updateMany.mockResolvedValueOnce({ count: 0 });
    await expect(service.markRead('u1', 'n2')).rejects.toBeInstanceOf(NotFoundException);
    await service.markAllRead('u1');
    expect(prisma.notification.updateMany.mock.calls.at(-1)![0].where).toEqual({ userId: 'u1', readAt: null });
  });

  it("syllabus updates go to the school's admins and the batch's active teachers who keep them on, never the person who made the change", async () => {
    const prisma = prismaMock();
    prisma.batch.findMany.mockResolvedValue([{ id: 'b1', name: 'JEE A' }, { id: 'b2', name: 'JEE B' }]);
    prisma.schoolMembership.findMany.mockResolvedValue([
      { userId: 'admin', role: 'ADMIN', user: { facultyProfiles: [] } },
      { userId: 'teach-b1', role: 'TEACHER', user: { facultyProfiles: [{ batchAssignments: [{ batchId: 'b1' }] }] } },
      { userId: 'teach-none', role: 'TEACHER', user: { facultyProfiles: [] } },
    ]);
    const service = new NotificationsService(prisma as unknown as PrismaService);
    await service.syllabusChanged('s1', 'actor', [
      { batchId: 'b1', subject: 'Physics', title: 'Laws of Motion', status: 'COMPLETED' },
      { batchId: 'b2', subject: 'Physics', title: 'Heat', status: 'IN_PROGRESS' },
      { batchId: 'b2', subject: 'Chemistry', title: 'Moles', status: 'COMPLETED' },
    ]);
    const where = prisma.schoolMembership.findMany.mock.calls[0][0].where;
    expect(where).toEqual({ schoolId: 's1', status: 'ACTIVE', userId: { not: 'actor' }, user: { syllabusUpdates: true } });
    // Teachers: only an active profile, and only the batches concerned.
    expect(prisma.schoolMembership.findMany.mock.calls[0][0].select.user.select.facultyProfiles.where).toEqual({ schoolId: 's1', status: { not: 'INACTIVE' } });
    const data = prisma.notification.createMany.mock.calls[0][0].data;
    expect(data.map((n: { userId: string; title: string; body: string; link: string }) => [n.userId, n.title, n.body, n.link])).toEqual([
      ['admin', 'Laws of Motion: Completed', 'JEE A · Physics · by Ravi Kumar', '/management/academic-planning'],
      ['admin', '2 syllabus chapters updated', 'JEE B · Physics, Chemistry · by Ravi Kumar', '/management/academic-planning'],
      ['teach-b1', 'Laws of Motion: Completed', 'JEE A · Physics · by Ravi Kumar', '/teacher/academic-planning'],
    ]);
    expect(data.every((n: { schoolId: string; kind: string }) => n.schoolId === 's1' && n.kind === 'SYLLABUS_UPDATE')).toBe(true);
  });

  it('a failure to notify never fails the change; nothing to tell is nothing written', async () => {
    const prisma = prismaMock();
    prisma.batch.findMany.mockRejectedValue(new Error('db down'));
    const service = new NotificationsService(prisma as unknown as PrismaService);
    await expect(service.syllabusChanged('s1', 'actor', [{ batchId: 'b1', subject: 'Physics', title: 'Heat', status: 'COMPLETED' }])).resolves.toBeUndefined();
    await service.syllabusChanged('s1', 'actor', []);
    expect(prisma.notification.createMany).not.toHaveBeenCalled();
  });

  it('prunes only read notifications older than 60 days', async () => {
    const prisma = prismaMock();
    const service = new NotificationsService(prisma as unknown as PrismaService);
    await service.prune(new Date('2026-10-20T00:00:00Z'));
    expect(prisma.notification.deleteMany.mock.calls[0][0].where).toEqual({ readAt: { not: null }, createdAt: { lt: new Date('2026-08-21T00:00:00Z') } });
  });
});

describe('SyllabusService: who hears of a status change', () => {
  const item = { id: 'i1', batchId: 'b1', subject: 'Physics', title: 'Heat', status: 'COMPLETED', estimatedHours: null, targetDates: null, remarks: null, updatedAt: new Date() };

  const setup = () => {
    const prisma = prismaMock();
    prisma.$transaction.mockImplementation((run: (tx: unknown) => unknown) => run(prisma));
    prisma.syllabusItem.findFirst.mockResolvedValue({ batchId: 'b1', status: 'IN_PROGRESS' });
    prisma.syllabusItem.update.mockResolvedValue(item);
    const notify = { syllabusChanged: vi.fn() };
    return { prisma, notify, service: new SyllabusService(prisma as unknown as PrismaService, notify as unknown as NotificationsService) };
  };

  it('moving a card tells people only when its status really changed, read under a row lock', async () => {
    const { prisma, notify, service } = setup();
    prisma.$queryRaw.mockResolvedValueOnce([{ status: 'IN_PROGRESS' }]);
    await service.setStatus('s1', null, 'u1', 'i1', 'COMPLETED');
    expect(notify.syllabusChanged).toHaveBeenCalledWith('s1', 'u1', [item]);
    const lock = (prisma.$queryRaw.mock.calls[0][0] as TemplateStringsArray).join('?');
    expect(lock).toContain('FOR UPDATE');
    // A second identical move (or one that raced the first) sees it already Completed: nothing new.
    prisma.$queryRaw.mockResolvedValueOnce([{ status: 'COMPLETED' }]);
    await service.setStatus('s1', null, 'u1', 'i1', 'COMPLETED');
    expect(notify.syllabusChanged).toHaveBeenCalledTimes(1);
  });

  it('an edit that keeps the status tells no one; one that changes it does', async () => {
    const { prisma, notify, service } = setup();
    const dto = { batchId: 'b1', subject: 'Physics', title: 'Heat (renamed)', status: 'COMPLETED' } as never;
    prisma.$queryRaw.mockResolvedValueOnce([{ status: 'COMPLETED' }]);
    Object.assign(prisma, { batch: { ...prisma.batch, findFirst: vi.fn().mockResolvedValue({ id: 'b1' }) } });
    await service.update('s1', null, 'u1', 'i1', dto);
    expect(notify.syllabusChanged).not.toHaveBeenCalled();
    prisma.$queryRaw.mockResolvedValueOnce([{ status: 'IN_PROGRESS' }]);
    await service.update('s1', null, 'u1', 'i1', dto);
    expect(notify.syllabusChanged).toHaveBeenCalledWith('s1', 'u1', [item]);
  });
});

const day = new Date('2026-10-20T00:00:00Z');
const report = (over: Record<string, unknown> = {}) => ({ teacherName: 'Ravi', facultyId: 'f1', batch: { name: 'JEE A' }, subject: 'Physics', late: false, flaggedAt: null, flagReason: null, reportDate: day, ...over });

describe('DigestService: the daily report digest', () => {
  const build = () => {
    const prisma = prismaMock();
    const mail = { send: vi.fn() };
    return { prisma, mail, service: new DigestService(prisma as unknown as PrismaService, mail as unknown as MailService) };
  };

  it("an admin's digest: each school's reports, late and flagged, and who hasn't reported", async () => {
    const { prisma, service } = build();
    prisma.user.findUnique.mockResolvedValue({ fullName: 'Asha', memberships: [{ role: 'ADMIN', school: { id: 's1', name: 'Test School' } }], facultyProfiles: [] });
    prisma.dailyReport.findMany.mockResolvedValue([report(), report({ teacherName: 'Sita', facultyId: 'f2', late: true, flaggedAt: day })]);
    prisma.faculty.findMany.mockResolvedValue([{ id: 'f1', name: 'Ravi' }, { id: 'f2', name: 'Sita' }, { id: 'f3', name: 'Meena' }]);
    const d = await service.build('u1', day);
    expect(d).toMatchObject({ day: '2026-10-20', name: 'Asha', teaching: [], admin: [{ school: 'Test School', submitted: 2, late: 1, flagged: 1, teachers: 2, missing: ['Meena'] }] });
    // Only this school's reports for the day; only active staff with a batch count as expected to report.
    expect(prisma.dailyReport.findMany.mock.calls[0][0].where).toEqual({ schoolId: 's1', reportDate: day });
    expect(prisma.faculty.findMany.mock.calls[0][0].where).toEqual({ schoolId: 's1', status: 'ACTIVE', batchAssignments: { some: {} } });
    // Only schools they are still an active member of; a teacher on leave still gets theirs, an inactive one doesn't.
    const select = prisma.user.findUnique.mock.calls[0][0].select;
    expect(select.memberships.where).toEqual({ status: 'ACTIVE' });
    expect(select.facultyProfiles.where).toEqual({ status: { not: 'INACTIVE' } });
  });

  it('a teacher in two schools gets a section for each (on leave in one still counts)', async () => {
    const { prisma, service } = build();
    prisma.user.findUnique.mockResolvedValue({
      fullName: 'Ravi',
      memberships: [{ role: 'TEACHER', school: { id: 's1', name: 'North' } }, { role: 'TEACHER', school: { id: 's2', name: 'South' } }, { role: 'TEACHER', school: { id: 's3', name: 'East' } }],
      // No profile in East (inactive there): no section.
      facultyProfiles: [{ id: 'f1', schoolId: 's1', _count: { batchAssignments: 1 } }, { id: 'f2', schoolId: 's2', _count: { batchAssignments: 3 } }],
    });
    prisma.dailyReport.findMany.mockResolvedValue([]);
    const d = await service.build('u1', day);
    expect(d?.teaching.map((t) => [t.school, t.batches])).toEqual([['North', 1], ['South', 3]]);
    expect(prisma.dailyReport.findMany.mock.calls.map((c) => c[0].where.facultyId)).toEqual(['f1', 'f1', 'f2', 'f2']);
    const text = compose('r@x.test', d!).text;
    expect(text).toContain('Your reports (North):');
    expect(text).toContain('Your reports (South):');
  });

  it("a teacher's digest: their own reports and flags, in their school only; nothing to oversee or teach is no digest", async () => {
    const { prisma, service } = build();
    prisma.user.findUnique.mockResolvedValue({ fullName: 'Ravi', memberships: [{ role: 'TEACHER', school: { id: 's1', name: 'Test School' } }], facultyProfiles: [{ id: 'f1', schoolId: 's1', _count: { batchAssignments: 2 } }] });
    prisma.dailyReport.findMany.mockResolvedValueOnce([]).mockResolvedValueOnce([report({ flaggedAt: day, flagReason: 'Too brief' })]);
    const d = await service.build('u1', day);
    expect(d?.teaching).toMatchObject([{ school: 'Test School', today: [], flagged: [{ flagReason: 'Too brief' }] }]);
    expect(prisma.dailyReport.findMany.mock.calls[0][0].where).toEqual({ schoolId: 's1', facultyId: 'f1', reportDate: day });
    expect(compose('r@x.test', d!).text).toContain("You haven't submitted a daily report today.");
    prisma.user.findUnique.mockResolvedValue({ fullName: 'New', memberships: [{ role: 'TEACHER', school: { id: 's1', name: 'Test School' } }], facultyProfiles: [{ id: 'f9', schoolId: 's1', _count: { batchAssignments: 0 } }] });
    await expect(service.build('u2', day)).resolves.toBeNull();
  });

  const unique = () => new Prisma.PrismaClientKnownRequestError('Unique', { code: 'P2002', clientVersion: '7' });
  const admin = { fullName: 'Asha', memberships: [{ role: 'ADMIN', school: { id: 's1', name: 'Test School' } }], facultyProfiles: [] };

  it('sends each due digest once: only to users who turned it on, with a verified address; the day claimed first', async () => {
    const { prisma, mail, service } = build();
    prisma.user.findMany.mockResolvedValue([{ id: 'u1', email: 'a@x.test' }, { id: 'u2', email: 'b@x.test' }, { id: 'u3', email: 'c@x.test' }]);
    // u2's day is held by another instance (its claim is fresh, so the retry claim takes nothing).
    prisma.emailDigest.create.mockResolvedValueOnce({}).mockRejectedValueOnce(unique()).mockResolvedValueOnce({});
    prisma.user.findUnique.mockResolvedValue(admin);
    mail.send.mockResolvedValueOnce(undefined).mockRejectedValueOnce(new Error('SMTP down'));
    const now = new Date('2026-10-20T14:00:00Z');
    await expect(service.sendDue(now)).resolves.toBe(1);
    expect(prisma.user.findMany.mock.calls[0][0].where).toEqual({
      emailNotifications: true,
      emailVerified: true,
      memberships: { some: { status: 'ACTIVE' } },
      emailDigests: { none: { day, OR: [{ sentAt: { not: null } }, { attempts: { gte: 3 } }] } },
    });
    expect(mail.send.mock.calls.map((c) => c[0].to)).toEqual(['a@x.test', 'c@x.test']);
    // Sent: the day is done. Failed (u3): the claim stays, for a retry on a later tick.
    expect(prisma.emailDigest.update.mock.calls.map((c) => c[0].where)).toEqual([{ userId_day: { userId: 'u1', day } }]);
    expect(prisma.emailDigest.updateMany.mock.calls[0][0]).toEqual({
      where: { userId: 'u2', day, sentAt: null, attempts: { lt: 3 }, claimedAt: { lt: new Date(now.getTime() - 5 * 60_000) } },
      data: { attempts: { increment: 1 }, claimedAt: now },
    });
    expect(prisma.emailDigest.deleteMany).not.toHaveBeenCalled();
  });

  it('a failed digest is retried on a later tick, up to 3 attempts', async () => {
    const { prisma, mail, service } = build();
    prisma.user.findMany.mockResolvedValue([{ id: 'u1', email: 'a@x.test' }]);
    prisma.user.findUnique.mockResolvedValue(admin);
    prisma.emailDigest.create.mockRejectedValue(unique());
    // The stale claim is retaken: attempt 3, which fails too (the last one).
    prisma.emailDigest.updateMany.mockResolvedValueOnce({ count: 1 });
    prisma.emailDigest.findUniqueOrThrow.mockResolvedValueOnce({ attempts: 3 });
    mail.send.mockRejectedValue(new Error('quota'));
    await expect(service.sendDue(new Date('2026-10-20T15:00:00Z'))).resolves.toBe(0);
    expect(mail.send).toHaveBeenCalledTimes(1);
    expect(prisma.emailDigest.update).not.toHaveBeenCalled();
  });

  it('a run stops after 5 failed sends in a row (e.g. a spent mailbox quota)', async () => {
    const { prisma, mail, service } = build();
    prisma.user.findMany.mockResolvedValue(Array.from({ length: 8 }, (_, i) => ({ id: `u${i}`, email: `u${i}@x.test` })));
    prisma.user.findUnique.mockResolvedValue(admin);
    prisma.emailDigest.create.mockResolvedValue({});
    mail.send.mockRejectedValue(new Error('quota'));
    await service.sendDue(new Date('2026-10-20T14:00:00Z'));
    expect(mail.send).toHaveBeenCalledTimes(5);
  });

  it('a success resets the failures-in-a-row count: 4 failed, 1 sent, 4 failed does not stop the run', async () => {
    const { prisma, mail, service } = build();
    prisma.user.findMany.mockResolvedValue(Array.from({ length: 9 }, (_, i) => ({ id: `u${i}`, email: `u${i}@x.test` })));
    prisma.user.findUnique.mockResolvedValue(admin);
    prisma.emailDigest.create.mockResolvedValue({});
    mail.send.mockImplementation(async (e: { to: string }) => {
      if (e.to !== 'u4@x.test') throw new Error('quota');
    });
    await expect(service.sendDue(new Date('2026-10-20T14:00:00Z'))).resolves.toBe(1);
    expect(mail.send).toHaveBeenCalledTimes(9);
  });

  it('"email me now" with daily digests off says it was asked for, not that the setting is on', async () => {
    const { prisma, mail, service } = build();
    prisma.user.findUnique.mockResolvedValue({ fullName: 'Asha', memberships: [{ role: 'ADMIN', school: { id: 's1', name: 'Test School' } }], facultyProfiles: [] });
    prisma.user.findUniqueOrThrow.mockResolvedValueOnce({ email: 'a@x.test', emailVerified: true, emailNotifications: false });
    await service.sendNow('u1');
    expect(mail.send.mock.calls[0][0].text).toContain('You asked for this digest from Account Preferences. Daily digests are off');
    expect(mail.send.mock.calls[0][0].text).not.toContain('Email Notifications is on');
    expect(mail.send.mock.calls[0][0].html).toContain('You asked for this digest');
    prisma.user.findUniqueOrThrow.mockResolvedValueOnce({ email: 'a@x.test', emailVerified: true, emailNotifications: true });
    await service.sendNow('u1');
    expect(mail.send.mock.calls[1][0].text).toContain('You get this because Email Notifications is on in Account Preferences.');
  });

  it('"email me now" goes only to a verified address', async () => {
    const { prisma, service } = build();
    prisma.user.findUniqueOrThrow.mockResolvedValue({ email: 'a@x.test', emailVerified: false });
    await expect(service.sendNow('u1')).rejects.toBeInstanceOf(BadRequestException);
  });

  it('"email me now": only to the account’s own address, 3 times an hour per account', async () => {
    const { prisma, mail, service } = build();
    prisma.user.findUniqueOrThrow.mockResolvedValue({ email: 'a@x.test', emailVerified: true });
    prisma.user.findUnique.mockResolvedValue({ fullName: 'Asha', memberships: [{ role: 'ADMIN', school: { id: 's1', name: 'Test School' } }], facultyProfiles: [] });
    const t = Date.now();
    for (const dt of [0, 1, 2]) await expect(service.sendNow('u1', t + dt)).resolves.toMatchObject({ sent: true, to: 'a@x.test' });
    await expect(service.sendNow('u1', t + 3)).rejects.toThrow('3 times an hour');
    // Another account isn't held back by this one; an hour later it can send again.
    await expect(service.sendNow('u2', t + 4)).resolves.toMatchObject({ sent: true });
    await expect(service.sendNow('u1', t + 3_600_001)).resolves.toMatchObject({ sent: true });
    expect(mail.send.mock.calls.every((c) => c[0].to === 'a@x.test')).toBe(true);
  });

  it('the email escapes what people typed', () => {
    const d: Digest = { day: '2026-10-20', name: '<b>Asha</b>', admin: [{ school: 'A&B <School>', submitted: 0, late: 0, flagged: 0, teachers: 0, missing: ['<img src=x>'], reports: [] }], teaching: [] };
    const { html, subject } = compose('a@x.test', d);
    expect(html).not.toContain('<b>Asha');
    expect(html).not.toContain('<img src=x>');
    expect(html).toContain('A&amp;B &lt;School&gt;');
    expect(subject).toBe('Daily report digest · Tuesday, 20 October 2026');
  });
});

describe('DigestScheduler', () => {
  const config = (values: Record<string, string>) => ({ get: (k: string, d?: string) => values[k] ?? d }) as unknown as ConfigService;

  it('is due from the configured hour in India', async () => {
    const digests = { sendDue: vi.fn().mockResolvedValue(0) };
    const notifications = { prune: vi.fn().mockResolvedValue(0) };
    const s = new DigestScheduler(config({ DIGEST_HOUR_IST: '19' }), digests as never, notifications as never);
    // 13:29 UTC is 18:59 IST; 13:30 UTC is 19:00 IST.
    expect(s.isDue(new Date('2026-10-20T13:29:00Z'))).toBe(false);
    expect(s.isDue(new Date('2026-10-20T13:30:00Z'))).toBe(true);
    await s.tick(new Date('2026-10-20T10:00:00Z'));
    expect(digests.sendDue).not.toHaveBeenCalled();
    await s.tick(new Date('2026-10-20T14:00:00Z'));
    expect(digests.sendDue).toHaveBeenCalledTimes(1);
    expect(notifications.prune).toHaveBeenCalledTimes(1);
    // A bad hour falls back to 19.
    expect(new DigestScheduler(config({ DIGEST_HOUR_IST: '99' }), digests as never, notifications as never).isDue(new Date('2026-10-20T13:29:00Z'))).toBe(false);
  });
});
