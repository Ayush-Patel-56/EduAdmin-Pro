import type { AccessService } from '../academic/access.service.js';
import type { PrismaService } from '../prisma/prisma.service.js';
import type { ScheduleService } from '../schedule/schedule.service.js';
import type { FilesService } from '../storage/files.service.js';
import { SchoolsService } from './schools.service.js';

// #18: the teacher dashboard's "assignments to grade" only counts for a
// teacher who is still active in the school.
describe('SchoolsService.teacherDashboard: assignments to grade', () => {
  const build = (status: 'ACTIVE' | 'INACTIVE') => {
    const prisma = {
      user: { findUniqueOrThrow: vi.fn().mockResolvedValue({ accountType: 'TEACHER' }) },
      schoolMembership: {
        findFirst: vi.fn().mockResolvedValue({
          school: { id: 's1', name: 'S', board: 'CBSE', classes: [], mouStartDate: null, mouEndDate: null, programs: [], announcements: [] },
        }),
      },
      faculty: { findUnique: vi.fn().mockResolvedValue({ id: 'f1', status, batchAssignments: [{ batchId: 'b1' }, { batchId: 'b2' }] }) },
      assignmentSubmission: { count: vi.fn().mockResolvedValue(4) },
      feedback: { findMany: vi.fn().mockResolvedValue([{ id: 'fb1', content: 'Great doubt sessions', createdAt: new Date('2026-10-18T05:00:00Z') }]) },
    };
    const schedule = { classesOn: vi.fn().mockResolvedValue([]) };
    const service = new SchoolsService(prisma as unknown as PrismaService, {} as AccessService, {} as FilesService, schedule as unknown as ScheduleService);
    return { prisma, schedule, service };
  };

  it("an active teacher sees the handed-in, ungraded work in their batches", async () => {
    const { prisma, service } = build('ACTIVE');
    const out = await service.teacherDashboard({ userId: 'u1' } as never);
    expect(out.stats.assignmentsToGrade).toBe(4);
    expect(prisma.assignmentSubmission.count.mock.calls[0][0].where).toEqual({
      schoolId: 's1',
      status: { in: ['SUBMITTED', 'LATE'] },
      assignment: { batchId: { in: ['b1', 'b2'] } },
    });
  });

  it('an inactive teacher sees nothing to grade and no classes', async () => {
    const { prisma, schedule, service } = build('INACTIVE');
    const out = await service.teacherDashboard({ userId: 'u1' } as never);
    expect(out.stats.assignmentsToGrade).toBe(0);
    expect(prisma.assignmentSubmission.count).not.toHaveBeenCalled();
    expect(schedule.classesOn).not.toHaveBeenCalled();
  });
});

describe('SchoolsService.teacherDashboard: feedback from admin', () => {
  const build = (status: 'ACTIVE' | 'INACTIVE') => {
    const prisma = {
      user: { findUniqueOrThrow: vi.fn().mockResolvedValue({ accountType: 'TEACHER' }) },
      schoolMembership: {
        findFirst: vi.fn().mockResolvedValue({
          school: { id: 's1', name: 'S', board: 'CBSE', classes: [], mouStartDate: null, mouEndDate: null, programs: [], announcements: [] },
        }),
      },
      faculty: { findUnique: vi.fn().mockResolvedValue({ id: 'f1', status, batchAssignments: [] }) },
      assignmentSubmission: { count: vi.fn() },
      feedback: { findMany: vi.fn().mockResolvedValue([{ id: 'fb1', content: 'Great doubt sessions', createdAt: new Date('2026-10-18T05:00:00Z') }]) },
    };
    const service = new SchoolsService(prisma as unknown as PrismaService, {} as AccessService, {} as FilesService, { classesOn: vi.fn() } as unknown as ScheduleService);
    return { prisma, service };
  };

  it('shows the latest feedback sent to them or to all faculty, not dismissed ones', async () => {
    const { prisma, service } = build('ACTIVE');
    const out = await service.teacherDashboard({ userId: 'u1' } as never);
    expect(out.adminFeedback).toEqual([{ id: 'fb1', message: 'Great doubt sessions', createdAt: '2026-10-18T05:00:00.000Z' }]);
    const args = prisma.feedback.findMany.mock.calls[0][0];
    expect(args.where).toEqual({
      schoolId: 's1',
      direction: 'MANAGEMENT_TO_TEACHER',
      status: { not: 'DISMISSED' },
      OR: [{ toAllFaculty: true }, { targetFacultyId: 'f1' }],
    });
    expect(args.take).toBe(3);
  });

  it('an inactive teacher sees none', async () => {
    const { prisma, service } = build('INACTIVE');
    const out = await service.teacherDashboard({ userId: 'u1' } as never);
    expect(out.adminFeedback).toEqual([]);
    expect(prisma.feedback.findMany).not.toHaveBeenCalled();
  });
});
