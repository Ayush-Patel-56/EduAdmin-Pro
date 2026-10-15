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
