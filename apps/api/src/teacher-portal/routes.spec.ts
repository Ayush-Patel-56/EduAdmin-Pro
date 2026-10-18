import { ForbiddenException, NotFoundException } from '@nestjs/common';
import type { AccessService } from '../academic/access.service.js';
import {
  AdminCounselingController,
  TeacherCounselingController,
} from '../counseling/counseling.controller.js';
import {
  AdminWorkspaceController,
  TeacherWorkspaceController,
} from '../workspace/workspace.controller.js';
import {
  AdminAttendanceController,
  TeacherAttendanceController,
} from '../attendance/attendance.controller.js';
import { FeesController } from '../fees/fees.controller.js';
import { MeetingsController } from '../meetings/meetings.controller.js';
import { CalendarController } from '../calendar/calendar.controller.js';
import { AdminDailyReportsController, TeacherDailyReportsController } from '../daily-reports/daily-reports.controller.js';
import { TeacherPtmNotesController } from '../ptm-notes/ptm-notes.controller.js';
import {
  AdminScheduleController,
  TeacherScheduleController,
} from '../schedule/schedule.controller.js';
import {
  TeacherPortalController,
  TeacherProfileController,
} from './teacher-portal.controller.js';

const auth = { userId: 'user-1', sessionId: 's', activeSchoolId: null };
const handlers = (controller: object) =>
  Object.getOwnPropertyNames(Object.getPrototypeOf(controller)).filter(
    (n) =>
      n !== 'constructor' &&
      n !== 'scope' &&
      n !== 'me' &&
      typeof (controller as Record<string, unknown>)[n] === 'function',
  );
/** A service that fails the test if it is reached. */
const untouched = () =>
  new Proxy(
    {},
    {
      get: () =>
        vi.fn(() => {
          throw new Error('a service was called before the permission check');
        }),
    },
  );
const call = (controller: object, name: string, ...args: unknown[]) =>
  (controller as Record<string, (...a: unknown[]) => Promise<unknown>>)[name].call(
    controller,
    ...args,
  );

describe.each([
  ['TeacherPortalController', (a: AccessService) => new TeacherPortalController(a, untouched() as never), 8],
  ['AdminCounselingController', (a: AccessService) => new AdminCounselingController(a, untouched() as never), 6],
  ['AdminWorkspaceController', (a: AccessService) => new AdminWorkspaceController(a, untouched() as never), 2],
  ['AdminScheduleController', (a: AccessService) => new AdminScheduleController(a, untouched() as never), 9],
  ['AdminAttendanceController', (a: AccessService) => new AdminAttendanceController(a, untouched() as never), 1],
  // Fees are admin only: every route, including the reads.
  ['FeesController', (a: AccessService) => new FeesController(a, untouched() as never, untouched() as never), 14],
  // Meetings are admin only too.
  ['MeetingsController', (a: AccessService) => new MeetingsController(a, untouched() as never), 9],
  // The academic calendar is admin only.
  ['CalendarController', (a: AccessService) => new CalendarController(a, untouched() as never), 5],
  // Admins read daily reports; only teachers write them.
  ['AdminDailyReportsController', (a: AccessService) => new AdminDailyReportsController(a, untouched() as never), 1],
])('%s: admin routes of /schools/:schoolId', (_name, build, minimum) => {
  const assertAdmin = vi.fn();
  const controller = build({ assertAdmin } as unknown as AccessService);
  const names = handlers(controller);

  it('covers every route', () => {
    expect(names.length).toBeGreaterThanOrEqual(minimum);
  });

  it.each(names)('%s refuses a non-admin (e.g. a teacher) before touching data', async (name) => {
    assertAdmin.mockRejectedValue(new ForbiddenException('Only admins of this school can do this'));
    await expect(call(controller, name, auth, 'school-1', 'x', 'y', {})).rejects.toBeInstanceOf(ForbiddenException);
    expect(assertAdmin).toHaveBeenCalledWith('user-1', 'school-1');
  });

  it.each(names)('%s answers 404 for a school the caller is not in', async (name) => {
    assertAdmin.mockRejectedValue(new NotFoundException('School not found'));
    await expect(call(controller, name, auth, 'foreign', 'x', 'y', {})).rejects.toBeInstanceOf(NotFoundException);
  });
});

describe.each([
  ['TeacherWorkspaceController', (a: AccessService) => new TeacherWorkspaceController(a, untouched() as never)],
  ['TeacherCounselingController', (a: AccessService) => new TeacherCounselingController(a, untouched() as never)],
  ['TeacherProfileController', (a: AccessService) => new TeacherProfileController(a, untouched() as never)],
  ['TeacherScheduleController', (a: AccessService) => new TeacherScheduleController(a, untouched() as never)],
  ['TeacherAttendanceController', (a: AccessService) => new TeacherAttendanceController(a, untouched() as never)],
  ['TeacherDailyReportsController', (a: AccessService) => new TeacherDailyReportsController(a, untouched() as never)],
  // PTM notes are faculty only: there is no admin controller at all.
  ['TeacherPtmNotesController', (a: AccessService) => new TeacherPtmNotesController(a, untouched() as never)],
])('%s: faculty routes', (_name, build) => {
  const teacherScope = vi.fn().mockRejectedValue(new ForbiddenException('Join a school'));
  const controller = build({ teacherScope } as unknown as AccessService);

  it.each(handlers(controller))('%s refuses someone who is not a teacher in a school', async (name) => {
    await expect(call(controller, name, auth, 'x', 'y', {})).rejects.toBeInstanceOf(ForbiddenException);
  });
});

describe('TeacherProfileController', () => {
  it('a teacher only ever reaches their own profile (ids come from the session)', async () => {
    const own = vi.fn().mockResolvedValue({});
    const updateOwn = vi.fn().mockResolvedValue({});
    const controller = new TeacherProfileController(
      {
        teacherScope: vi.fn().mockResolvedValue({ schoolId: 'their-school', facultyId: 'their-profile', active: true, batchIds: [], programIds: [] }),
      } as unknown as AccessService,
      { own, updateOwn } as never,
    );
    await controller.get(auth);
    await controller.update(auth, {});
    expect(own).toHaveBeenCalledWith('their-school', 'their-profile');
    expect(updateOwn).toHaveBeenCalledWith('their-school', auth.userId, 'their-profile', {});
  });

  it('a teacher without a faculty profile gets a clear 403', async () => {
    const controller = new TeacherProfileController(
      { teacherScope: vi.fn().mockResolvedValue({ schoolId: 's', facultyId: null, active: false, batchIds: [], programIds: [] }) } as unknown as AccessService,
      untouched() as never,
    );
    await expect(controller.get(auth)).rejects.toBeInstanceOf(ForbiddenException);
  });
});
