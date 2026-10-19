import { randomUUID } from 'node:crypto';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../src/generated/prisma/client.js';
import type { PrismaService } from '../src/prisma/prisma.service.js';
import type { MailService } from '../src/auth/mail.service.js';
import { AvatarService } from '../src/auth/avatar.service.js';
import { DigestService } from '../src/notifications/digest.service.js';
import { NotificationsService } from '../src/notifications/notifications.service.js';

/**
 * Account settings on a real database: an uploaded picture's bytes round
 * trip; syllabus updates reach the right people (admins, the batch's active
 * teachers who keep them on, never the actor or another school); the digest
 * reads one school's day.
 */
describe('account settings on the database (e2e)', () => {
  const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL! }) });
  const db = prisma as unknown as PrismaService;
  const id = () => randomUUID();
  const ids = { school: id(), other: id(), program: id(), batch: id(), batch2: id(), admin: id(), actor: id(), teacher: id(), off: id(), stranger: id(), f1: id(), f2: id(), f3: id() };
  const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);

  beforeAll(async () => {
    const tag = ids.school.slice(0, 8);
    const user = (uid: string, name: string, over: object = {}) => ({ id: uid, email: `${name.toLowerCase()}-${tag}@e2e.test`, passwordHash: 'x', fullName: name, accountType: 'ADMIN' as const, emailVerified: true, ...over });
    await prisma.user.createMany({
      data: [
        user(ids.admin, 'Admin'),
        user(ids.actor, 'Actor', { accountType: 'TEACHER' }),
        user(ids.teacher, 'Teacher', { accountType: 'TEACHER' }),
        user(ids.off, 'Off', { accountType: 'TEACHER', syllabusUpdates: false }),
        user(ids.stranger, 'Stranger'),
      ],
    });
    await prisma.school.create({ data: { id: ids.school, name: `E2E Acct ${tag}`, inviteCode: `AC-${tag}`, board: 'CBSE' } });
    await prisma.school.create({ data: { id: ids.other, name: `E2E Acct other ${tag}`, inviteCode: `AO-${tag}`, board: 'CBSE' } });
    await prisma.schoolMembership.createMany({
      data: [
        { userId: ids.admin, schoolId: ids.school, role: 'ADMIN', status: 'ACTIVE' },
        { userId: ids.actor, schoolId: ids.school, role: 'TEACHER', status: 'ACTIVE' },
        { userId: ids.teacher, schoolId: ids.school, role: 'TEACHER', status: 'ACTIVE' },
        { userId: ids.off, schoolId: ids.school, role: 'TEACHER', status: 'ACTIVE' },
        { userId: ids.stranger, schoolId: ids.other, role: 'ADMIN', status: 'ACTIVE' },
      ],
    });
    await prisma.program.create({ data: { id: ids.program, schoolId: ids.school, name: 'JEE', isStandard: true, sortOrder: 1 } });
    await prisma.batch.createMany({
      data: [
        { id: ids.batch, schoolId: ids.school, programId: ids.program, name: 'A1', startDate: new Date('2026-04-01T00:00:00Z') },
        { id: ids.batch2, schoolId: ids.school, programId: ids.program, name: 'A2', startDate: new Date('2026-04-01T00:00:00Z') },
      ],
    });
    await prisma.faculty.createMany({
      data: [
        { id: ids.f1, schoolId: ids.school, userId: ids.actor, name: 'Actor' },
        { id: ids.f2, schoolId: ids.school, userId: ids.teacher, name: 'Teacher' },
        { id: ids.f3, schoolId: ids.school, userId: ids.off, name: 'Off' },
      ],
    });
    await prisma.facultyBatch.createMany({
      data: [
        { facultyId: ids.f1, batchId: ids.batch, schoolId: ids.school },
        { facultyId: ids.f2, batchId: ids.batch2, schoolId: ids.school },
        { facultyId: ids.f3, batchId: ids.batch, schoolId: ids.school },
      ],
    });
  });

  afterAll(async () => {
    await prisma.school.deleteMany({ where: { id: { in: [ids.school, ids.other] } } });
    await prisma.user.deleteMany({ where: { id: { in: [ids.admin, ids.actor, ids.teacher, ids.off, ids.stranger] } } });
    await prisma.$disconnect();
  });

  it('an uploaded picture round-trips byte for byte, and a link replaces it', async () => {
    const avatars = new AvatarService(db);
    const { avatarUrl } = await avatars.upload(ids.admin, `data:image/png;base64,${PNG.toString('base64')}`);
    expect(avatarUrl).toMatch(/^\/api\/auth\/avatar\?v=\d+$/);
    const read = await avatars.read(ids.admin);
    expect(read.contentType).toBe('image/png');
    expect(read.data.equals(PNG)).toBe(true);
    await avatars.link(ids.admin, 'https://images.example.com/a.png');
    expect(await prisma.userAvatar.count({ where: { userId: ids.admin } })).toBe(0);
    expect((await prisma.user.findUniqueOrThrow({ where: { id: ids.admin } })).avatarUrl).toBe('https://images.example.com/a.png');
  });

  it("syllabus updates reach the admin and the batch's teachers who keep them on; never the actor, another batch's teacher or another school", async () => {
    const notifications = new NotificationsService(db);
    await notifications.syllabusChanged(ids.school, ids.actor, [{ batchId: ids.batch, subject: 'Physics', title: 'Heat', status: 'COMPLETED' }]);
    const rows = await prisma.notification.findMany({ where: { schoolId: ids.school }, select: { userId: true, title: true } });
    expect(rows).toEqual([{ userId: ids.admin, title: 'Heat: Completed' }]);
    const list = await notifications.list(ids.admin);
    expect(list).toMatchObject({ unread: 1, items: [{ title: 'Heat: Completed', body: 'A1 · Physics · by Actor', school: { name: expect.stringContaining('E2E Acct') } }] });
    expect((await notifications.list(ids.stranger)).items).toEqual([]);
    // Once the admin leaves the school, its notifications are out of reach.
    await prisma.schoolMembership.update({ where: { userId_schoolId: { userId: ids.admin, schoolId: ids.school } }, data: { status: 'LEFT' } });
    expect(await notifications.list(ids.admin)).toEqual({ unread: 0, items: [] });
    await prisma.schoolMembership.update({ where: { userId_schoolId: { userId: ids.admin, schoolId: ids.school } }, data: { status: 'ACTIVE' } });
    // The batch's teacher hears of a change in their batch.
    await notifications.syllabusChanged(ids.school, ids.actor, [{ batchId: ids.batch2, subject: 'Physics', title: 'Optics', status: 'IN_PROGRESS' }]);
    expect(await prisma.notification.count({ where: { userId: ids.teacher } })).toBe(1);
    expect(await prisma.notification.count({ where: { userId: ids.off } })).toBe(0);
  });

  it("the digest reads one school's day: reports, late, and who hasn't reported", async () => {
    const day = new Date('2026-10-20T00:00:00Z');
    await prisma.dailyReport.create({
      data: { schoolId: ids.school, facultyId: ids.f1, teacherName: 'Actor', batchId: ids.batch, reportDate: day, subject: 'Physics', topics: 'Heat', late: true, submittedAt: new Date('2026-10-21T05:00:00Z') },
    });
    const digests = new DigestService(db, { send: vi.fn() } as unknown as MailService);
    const d = await digests.build(ids.admin, day);
    expect(d?.admin).toEqual([expect.objectContaining({ submitted: 1, late: 1, flagged: 0, teachers: 1, missing: ['Off', 'Teacher'] })]);
    expect(await digests.build(ids.stranger, day)).toMatchObject({ admin: [{ submitted: 0, missing: [] }] });
  });
});
