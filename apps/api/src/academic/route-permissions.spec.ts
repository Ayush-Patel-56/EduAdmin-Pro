import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { PrismaService } from '../prisma/prisma.service.js';
import { SchoolsService } from '../schools/schools.service.js';
import { AcademicAdminController } from './academic-admin.controller.js';
import { AcademicTeacherController } from './academic-teacher.controller.js';
import { AccessService } from './access.service.js';

const auth = { userId: 'user-1', sessionId: 's', activeSchoolId: null };

/** Every route handler a controller defines (its prototype methods). */
const handlers = (controller: object) =>
  Object.getOwnPropertyNames(Object.getPrototypeOf(controller)).filter(
    (name) =>
      name !== 'constructor' &&
      typeof (controller as Record<string, unknown>)[name] === 'function',
  );

describe('AcademicAdminController: /schools/:schoolId/*', () => {
  const assertAdmin = vi.fn();
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
  const services = {
    prisma: untouched(),
    programs: untouched(),
    batches: untouched(),
    faculty: untouched(),
    syllabus: untouched(),
    promotion: untouched(),
  };
  const controller = new AcademicAdminController(
    { assertAdmin } as unknown as AccessService,
    services.prisma as never,
    services.programs as never,
    services.batches as never,
    services.faculty as never,
    services.syllabus as never,
    services.promotion as never,
  );
  const names = handlers(controller);

  it('covers every route (guards against a new route being added without a check)', () => {
    expect(names.length).toBeGreaterThanOrEqual(20);
  });

  it.each(names)(
    '%s refuses a non-admin before touching any data',
    async (name) => {
      assertAdmin.mockRejectedValue(
        new ForbiddenException('Only admins of this school can do this'),
      );
      const handler = (
        controller as unknown as Record<
          string,
          (...args: unknown[]) => Promise<unknown>
        >
      )[name];
      // Arguments after (auth, schoolId) don't matter: the check comes first.
      await expect(
        handler.call(controller, auth, 'school-1', 'x', 'y', {}),
      ).rejects.toBeInstanceOf(ForbiddenException);
      expect(assertAdmin).toHaveBeenCalledWith('user-1', 'school-1');
    },
  );

  it.each(names)(
    '%s answers 404 for a school the caller is not in',
    async (name) => {
      assertAdmin.mockRejectedValue(new NotFoundException('School not found'));
      const handler = (
        controller as unknown as Record<
          string,
          (...args: unknown[]) => Promise<unknown>
        >
      )[name];
      await expect(
        handler.call(controller, auth, 'foreign-school', 'x', 'y', {}),
      ).rejects.toBeInstanceOf(NotFoundException);
    },
  );
});

describe('AcademicTeacherController: /teacher/*', () => {
  const teacherScope = vi.fn();
  const syllabus = new Proxy(
    {},
    {
      get: () =>
        vi.fn(() => {
          throw new Error('syllabus touched without a teacher scope');
        }),
    },
  );
  const controller = new AcademicTeacherController(
    { teacherScope } as unknown as AccessService,
    {} as never,
    syllabus as never,
  );

  it.each(handlers(controller))(
    '%s is refused for someone who is not a teacher in a school',
    async (name) => {
      teacherScope.mockRejectedValue(
        new ForbiddenException('Join a school to see its academic planning'),
      );
      const handler = (
        controller as unknown as Record<
          string,
          (...args: unknown[]) => Promise<unknown>
        >
      )[name];
      await expect(
        handler.call(controller, auth, 'x', 'y', {}),
      ).rejects.toBeInstanceOf(ForbiddenException);
    },
  );

  it('never reads a school id from the request: only the session decides', async () => {
    teacherScope.mockResolvedValue({
      schoolId: 'their-school',
      facultyId: 'f',
      batchIds: ['b1'],
      programIds: [],
    });
    const list = vi.fn().mockResolvedValue([]);
    const c = new AcademicTeacherController(
      { teacherScope } as unknown as AccessService,
      {} as never,
      { list } as never,
    );
    await c.list(auth, 'b1', 'Physics');
    expect(list).toHaveBeenCalledWith('their-school', ['b1'], 'b1', 'Physics');
  });
});

describe('Schools: owner-only operations', () => {
  const assertOwner = vi.fn();
  const prismaWrites = vi.fn();
  const prisma = new Proxy(
    {},
    { get: () => new Proxy({}, { get: () => prismaWrites }) },
  );
  let schools: SchoolsService;

  beforeEach(async () => {
    vi.clearAllMocks();
    assertOwner.mockRejectedValue(
      new ForbiddenException('Only the school owner can do this'),
    );
    const moduleRef = await Test.createTestingModule({
      providers: [SchoolsService],
    })
      .useMocker((token) => {
        if (token === PrismaService)
          return { ...prisma, $transaction: prismaWrites };
        if (token === AccessService) return { assertOwner };
        return {};
      })
      .compile();
    schools = moduleRef.get(SchoolsService);
  });

  const dto = {
    name: 'X',
    board: 'CBSE',
    classes: ['6th'],
    programs: [],
  } as never;

  it('a non-owner cannot edit the school', async () => {
    await expect(
      schools.updateSchool(auth, 'school-1', dto),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('a non-owner cannot delete the school', async () => {
    await expect(
      schools.deleteSchool(auth, 'school-1', 'X'),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('a non-owner cannot clear its data, or even preview what would be cleared', async () => {
    await expect(
      schools.clearAllData(auth, 'school-1', 'X'),
    ).rejects.toBeInstanceOf(ForbiddenException);
    await expect(schools.clearPreview(auth, 'school-1')).rejects.toBeInstanceOf(
      ForbiddenException,
    );
  });

  it('every one of those checks ran for the caller and the requested school, before any write', async () => {
    await schools.updateSchool(auth, 'school-1', dto).catch(() => undefined);
    await schools.deleteSchool(auth, 'school-1', 'X').catch(() => undefined);
    await schools.clearAllData(auth, 'school-1', 'X').catch(() => undefined);
    expect(assertOwner).toHaveBeenCalledTimes(3);
    expect(assertOwner).toHaveBeenCalledWith('user-1', 'school-1');
    expect(prismaWrites).not.toHaveBeenCalled();
  });
});

describe('Schools: non-admins are refused on the dashboard', () => {
  it('a teacher membership cannot read the admin dashboard', async () => {
    const findUnique = vi
      .fn()
      .mockResolvedValue({ role: 'TEACHER', status: 'ACTIVE' });
    const moduleRef = await Test.createTestingModule({
      providers: [SchoolsService],
    })
      .useMocker((token) =>
        token === PrismaService ? { schoolMembership: { findUnique } } : {},
      )
      .compile();
    await expect(
      moduleRef.get(SchoolsService).dashboard(auth, 'school-1'),
    ).rejects.toBeInstanceOf(ForbiddenException);
    findUnique.mockResolvedValue(null);
    await expect(
      moduleRef.get(SchoolsService).dashboard(auth, 'school-1'),
    ).rejects.toBeInstanceOf(NotFoundException);
  });
});
