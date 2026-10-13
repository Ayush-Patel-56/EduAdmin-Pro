import { BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';
import type { TeacherScope } from '../academic/access.service.js';
import type { PrismaService } from '../prisma/prisma.service.js';
import type { StudentsService } from '../students/students.service.js';
import type { ScheduleSessionDto, SessionFields } from './counseling.dto.js';
import { CounselingService } from './counseling.service.js';

const scope = (over: Partial<TeacherScope> = {}): TeacherScope => ({
  schoolId: 'school-1', facultyId: 'fac-1', batchIds: ['b1'], programIds: ['p1'], active: true, ...over,
});
const fields = (over: Partial<SessionFields> = {}) =>
  ({ studentId: 'st-1', type: 'ACADEMIC', date: '2026-10-20', time: '10:00', durationMinutes: 30, ...over }) as SessionFields;

function build() {
  const prisma = {
    counselingSession: { findMany: vi.fn().mockResolvedValue([]), findFirst: vi.fn(), count: vi.fn().mockResolvedValue(0), create: vi.fn().mockResolvedValue({ id: 'c1' }), update: vi.fn(), delete: vi.fn() },
    student: { findFirst: vi.fn() },
    schoolMembership: { findFirst: vi.fn(), findMany: vi.fn().mockResolvedValue([]) },
    faculty: { findFirst: vi.fn(), findMany: vi.fn().mockResolvedValue([]), findUniqueOrThrow: vi.fn().mockResolvedValue({ name: 'Anita Rao' }) },
  };
  const teacherWhere = vi.fn((s: TeacherScope) => (s.active ? { schoolId: s.schoolId } : null));
  const service = new CounselingService(prisma as unknown as PrismaService, { teacherWhere } as unknown as StudentsService);
  return { prisma, service, teacherWhere };
}

describe('CounselingService: admins', () => {
  const dto = (counselor: string) => fields({ counselor } as Partial<SessionFields>) as ScheduleSessionDto;

  it("a student or counselor from another school is refused (looked up with this school)", async () => {
    const { service, prisma } = build();
    prisma.student.findFirst.mockResolvedValue(null);
    await expect(service.schedule('school-1', 'u', dto('faculty:00000000-0000-4000-8000-000000000001'))).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.student.findFirst.mock.calls[0][0].where).toEqual({ id: 'st-1', schoolId: 'school-1' });

    prisma.student.findFirst.mockResolvedValue({ id: 'st-1' });
    prisma.faculty.findFirst.mockResolvedValue(null);
    await expect(service.schedule('school-1', 'u', dto('faculty:f-other'))).rejects.toThrow('Select a counselor from this school');
    expect(prisma.faculty.findFirst.mock.calls[0][0].where).toMatchObject({ id: 'f-other', schoolId: 'school-1' });
    prisma.schoolMembership.findFirst.mockResolvedValue(null);
    await expect(service.schedule('school-1', 'u', dto('admin:user-other'))).rejects.toThrow('Select a counselor from this school');
    // An admin counselor must be an active admin of this school, not of any school.
    expect(prisma.schoolMembership.findFirst.mock.calls[0][0].where).toEqual({ schoolId: 'school-1', userId: 'user-other', role: 'ADMIN', status: 'ACTIVE' });
    expect(prisma.counselingSession.create).not.toHaveBeenCalled();
  });

  it('keeps the counselor name and stores the time as Indian time', async () => {
    const { service, prisma } = build();
    prisma.student.findFirst.mockResolvedValue({ id: 'st-1' });
    prisma.schoolMembership.findFirst.mockResolvedValue({ user: { fullName: 'Ayush' } });
    await service.schedule('school-1', 'u', dto('admin:user-1'));
    expect(prisma.counselingSession.create.mock.calls[0][0].data).toMatchObject({
      counselorUserId: 'user-1', counselorFacultyId: null, counselorName: 'Ayush', status: 'SCHEDULED',
      scheduledAt: new Date('2026-10-20T04:30:00Z'),
    });
  });

  it("another school's session is a 404", async () => {
    const { service, prisma } = build();
    prisma.counselingSession.findFirst.mockResolvedValue(null);
    await expect(service.remove('school-1', 'c-x')).rejects.toBeInstanceOf(NotFoundException);
    await expect(service.setStatus('school-1', 'c-x', { status: 'COMPLETED' })).rejects.toBeInstanceOf(NotFoundException);
    expect(prisma.counselingSession.findFirst.mock.calls[0][0].where).toEqual({ id: 'c-x', schoolId: 'school-1' });
  });
});

describe('CounselingService: faculty', () => {
  it('a teacher only sees the sessions they held', async () => {
    const { service, prisma } = build();
    await service.teacherList(scope(), { q: 'riya' });
    expect(prisma.counselingSession.findMany.mock.calls[0][0].where).toMatchObject({ schoolId: 'school-1', counselorFacultyId: 'fac-1' });
    await expect(service.teacherList(scope({ facultyId: null }), {})).resolves.toEqual([]);
    // A counselor filter can't widen it to someone else's sessions.
    await service.teacherList(scope(), { counselor: 'faculty:fac-2' });
    expect(prisma.counselingSession.findMany.mock.calls[1][0].where.counselorFacultyId).toBe('fac-1');
  });

  it("an inactive teacher no longer reads counseling notes", async () => {
    const { service, prisma } = build();
    await expect(service.teacherList(scope({ active: false }), {})).resolves.toEqual([]);
    expect(prisma.counselingSession.findMany).not.toHaveBeenCalled();
  });

  it('a teacher logs 15 to 90 minutes (PRD 5.14); an unchanged longer duration set by an admin is kept', async () => {
    const { service, prisma } = build();
    prisma.student.findFirst.mockResolvedValue({ id: 'st-1' });
    await expect(service.teacherLog(scope(), 'u', fields({ durationMinutes: 120 }))).rejects.toThrow('between 15 and 90');
    await expect(service.teacherLog(scope(), 'u', fields({ durationMinutes: 10 }))).rejects.toThrow('between 15 and 90');
    prisma.counselingSession.findFirst.mockResolvedValue({ id: 'c1', durationMinutes: 120 });
    await expect(service.teacherUpdate(scope(), 'c1', fields({ durationMinutes: 120 }))).resolves.toEqual({ id: 'c1' });
    await expect(service.teacherUpdate(scope(), 'c1', fields({ durationMinutes: 100 }))).rejects.toThrow('between 15 and 90');
  });

  it('logs only with students the teacher can see', async () => {
    const { service, prisma, teacherWhere } = build();
    prisma.student.findFirst.mockResolvedValue(null);
    await expect(service.teacherLog(scope(), 'u', fields())).rejects.toThrow('Select one of your students');
    expect(teacherWhere).toHaveBeenCalled();
    expect(prisma.student.findFirst.mock.calls[0][0].where).toEqual({ AND: [{ schoolId: 'school-1' }, { id: 'st-1' }] });
  });

  it('a past session is logged as completed, a future one as scheduled, under the teacher’s name', async () => {
    const { service, prisma } = build();
    prisma.student.findFirst.mockResolvedValue({ id: 'st-1' });
    await service.teacherLog(scope(), 'u', fields({ date: '2020-01-01' }));
    await service.teacherLog(scope(), 'u', fields({ date: '2999-01-01' }));
    expect(prisma.counselingSession.create.mock.calls.map((c) => c[0].data.status)).toEqual(['COMPLETED', 'SCHEDULED']);
    expect(prisma.counselingSession.create.mock.calls[0][0].data).toMatchObject({ counselorFacultyId: 'fac-1', counselorName: 'Anita Rao' });
  });

  it("an inactive teacher can't log; another teacher's session is a 404", async () => {
    const { service, prisma } = build();
    await expect(service.teacherLog(scope({ active: false }), 'u', fields())).rejects.toBeInstanceOf(ForbiddenException);
    prisma.counselingSession.findFirst.mockResolvedValue(null);
    await expect(service.teacherRemove(scope(), 'c-other')).rejects.toBeInstanceOf(NotFoundException);
    expect(prisma.counselingSession.findFirst.mock.calls[0][0].where).toEqual({ id: 'c-other', schoolId: 'school-1', counselorFacultyId: 'fac-1' });
    expect(prisma.counselingSession.delete).not.toHaveBeenCalled();
  });
});
