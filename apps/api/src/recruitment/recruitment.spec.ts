import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '../generated/prisma/client.js';
import type { AccessService } from '../academic/access.service.js';
import type { PrismaService } from '../prisma/prisma.service.js';
import type { Actor } from './audit.js';
import { RecruitmentController } from './recruitment.controller.js';
import type { CandidateDto } from './recruitment.dto.js';
import { RecruitmentService } from './recruitment.service.js';

const auth = { userId: 'user-1', sessionId: 's', activeSchoolId: null };
const actor: Actor = { userId: 'user-1', name: 'Asha', ip: null, userAgent: null };
const MINE = '11111111-1111-4111-8111-111111111111';
const OTHER = '22222222-2222-4222-8222-222222222222';
const FOREIGN = '33333333-3333-4333-8333-333333333333';
const ID = '44444444-4444-4444-8444-444444444444';

const duplicate = () =>
  new Prisma.PrismaClientKnownRequestError('Unique constraint failed', {
    code: 'P2002',
    clientVersion: 'test',
  });

/** A prisma stand-in whose models fail loudly unless a test gave them behaviour. */
function makePrisma(accountType: 'ADMIN' | 'TEACHER') {
  const touched = vi.fn(() => {
    throw new Error('data was touched');
  });
  const models = new Proxy(
    {},
    { get: () => new Proxy({}, { get: () => touched }) },
  );
  const tx = {
    $queryRaw: vi.fn().mockResolvedValue([]),
    $executeRaw: vi.fn().mockResolvedValue(0),
    jobRequirement: { findFirst: vi.fn(), update: vi.fn(), delete: vi.fn() },
    candidate: {
      findFirst: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
    },
    interview: {
      findFirst: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
    },
    teacherAppraisal: { findFirst: vi.fn(), update: vi.fn(), delete: vi.fn() },
    faculty: { findUnique: vi.fn(), create: vi.fn() },
    recruitmentAuditLog: { create: vi.fn() },
  };
  const prisma = {
    user: {
      findUniqueOrThrow: vi
        .fn()
        .mockResolvedValue({ fullName: 'Asha', accountType }),
    },
    faculty: { findFirst: vi.fn().mockResolvedValue({ name: 'T' }) },
    $transaction: vi.fn(async (run: (t: typeof tx) => unknown) => run(tx)),
  };
  const guarded = new Proxy(prisma, {
    get: (target, key: string) =>
      key in target ? target[key as keyof typeof target] : models[key as never],
  });
  return { prisma, tx, touched, service: guarded as unknown as PrismaService };
}

const build = (accountType: 'ADMIN' | 'TEACHER', schoolIds: string[]) => {
  const { service: prisma, ...rest } = makePrisma(accountType);
  const access = {
    adminSchoolIds: vi.fn().mockResolvedValue(schoolIds),
  } as unknown as AccessService;
  const recruitment = new RecruitmentService(prisma, access);
  return { recruitment, controller: new RecruitmentController(recruitment), ...rest };
};

/** Calls a handler with plausible arguments for its parameter list. */
function call(
  controller: RecruitmentController,
  name: string,
  dto: Record<string, unknown>,
) {
  const handler = (controller as unknown as Record<string, (...a: unknown[]) => unknown>)[name];
  const probe = { ip: '127.0.0.1', get: () => 'test-agent', schoolId: undefined };
  const args =
    handler.length >= 4
      ? [auth, probe, ID, dto]
      : handler.length === 3
        ? [auth, probe, name.startsWith('create') ? dto : ID]
        : [auth, probe];
  return Promise.resolve(handler.apply(controller, args));
}

const handlers = (controller: object) =>
  Object.getOwnPropertyNames(Object.getPrototypeOf(controller)).filter(
    (n) =>
      n !== 'constructor' &&
      n !== 'actor' &&
      typeof (controller as Record<string, unknown>)[n] === 'function',
  );

describe('RecruitmentController: a teacher gets 403 on every route', () => {
  const { controller, touched, prisma, tx } = build('TEACHER', []);
  const names = handlers(controller);

  it('covers every route', () => {
    expect(names.length).toBeGreaterThanOrEqual(20);
  });

  it.each(names)('%s refuses a teacher and touches no data', async (name) => {
    await expect(
      call(controller, name, { schoolId: MINE, candidateId: ID, facultyId: ID }),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(touched).not.toHaveBeenCalled();
    expect(prisma.$transaction).not.toHaveBeenCalled();
    expect(tx.candidate.update).not.toHaveBeenCalled();
  });
});

describe('RecruitmentController: another school’s data is a 404', () => {
  const { controller, tx, prisma } = build('ADMIN', [MINE]);
  const names = handlers(controller).filter((n) => n !== 'options');
  const dto = {
    schoolId: FOREIGN,
    candidateId: ID,
    facultyId: ID,
    scheduledAt: '2026-10-20T10:00:00+05:30',
  };

  beforeEach(() => {
    vi.clearAllMocks();
    // Queries are scoped to the caller's schools, so a foreign id matches nothing.
    for (const model of [tx.jobRequirement, tx.candidate, tx.interview, tx.teacherAppraisal])
      model.findFirst.mockResolvedValue(null);
  });

  const writing = names.filter((n) => /^(create|update|delete|setStage)/.test(n));

  it.each(writing)('%s answers 404 and writes nothing', async (name) => {
    await expect(call(controller, name, dto)).rejects.toBeInstanceOf(NotFoundException);
    expect(tx.candidate.update).not.toHaveBeenCalled();
    expect(tx.candidate.delete).not.toHaveBeenCalled();
    expect(tx.interview.create).not.toHaveBeenCalled();
    expect(tx.recruitmentAuditLog.create).not.toHaveBeenCalled();
  });

  it('lookups carry the caller’s school list, so a foreign id can never match', async () => {
    await call(controller, 'deleteCandidate', dto).catch(() => undefined);
    await call(controller, 'updateInterview', dto).catch(() => undefined);
    expect(tx.candidate.findFirst.mock.calls[0][0].where).toEqual({
      id: ID,
      schoolId: { in: [MINE] },
    });
    expect(tx.interview.findFirst.mock.calls[0][0].where).toEqual({
      id: ID,
      schoolId: { in: [MINE] },
    });
    expect(prisma.$transaction).toHaveBeenCalled();
  });

  it('listing with ?schoolId= of a school you are not in is a 404', async () => {
    const probe = { ip: 'x', get: () => 'ua', schoolId: FOREIGN };
    await expect(controller.candidates(auth, probe as never)).rejects.toBeInstanceOf(NotFoundException);
    await expect(controller.overview(auth, probe as never)).rejects.toBeInstanceOf(NotFoundException);
  });
});

describe('RecruitmentService: a database that really filters by school', () => {
  // The row exists, but in a school the caller does not administer.
  const rowInOtherSchool = { id: ID, schoolId: OTHER, stage: 'APPLIED', candidateId: 'c-1', candidate: { fullName: 'A' } };
  const scoped = async ({ where }: { where: { schoolId?: { in: string[] } } }) =>
    // No school filter in the query means the row is returned: that is the leak.
    !where.schoolId || where.schoolId.in.includes(rowInOtherSchool.schoolId)
      ? rowInOtherSchool
      : null;

  it.each([
    ['setStage', (r: RecruitmentService) => r.setStage(actor, ID, 'HIRED')],
    ['updateCandidate', (r: RecruitmentService) => r.updateCandidate(actor, ID, { schoolId: OTHER, stage: 'HIRED' } as CandidateDto)],
    ['deleteCandidate', (r: RecruitmentService) => r.deleteCandidate(actor, ID)],
    ['createInterview', (r: RecruitmentService) => r.createInterview(actor, { candidateId: ID, scheduledAt: '2026-10-20T10:00:00Z', mode: 'ONLINE', result: 'PENDING' } as never)],
    ['deleteInterview', (r: RecruitmentService) => r.deleteInterview(actor, ID)],
    ['deleteAppraisal', (r: RecruitmentService) => r.deleteAppraisal(actor, ID)],
    ['deleteRequirement', (r: RecruitmentService) => r.deleteRequirement(actor, ID)],
  ])('%s cannot reach a record of a school the caller does not administer', async (_name, run) => {
    const { recruitment, tx } = build('ADMIN', [MINE]);
    for (const m of [tx.candidate, tx.interview, tx.teacherAppraisal, tx.jobRequirement])
      m.findFirst.mockImplementation(scoped as never);
    await expect(run(recruitment)).rejects.toBeInstanceOf(NotFoundException);
    expect(tx.candidate.update).not.toHaveBeenCalled();
    expect(tx.candidate.delete).not.toHaveBeenCalled();
    expect(tx.interview.create).not.toHaveBeenCalled();
  });
});

describe('RecruitmentService: moving a record to another school or candidate is refused', () => {
  const setup = () => build('ADMIN', [MINE, OTHER]);

  it('a candidate', async () => {
    const { recruitment, tx } = setup();
    tx.candidate.findFirst.mockResolvedValue({ id: ID, schoolId: MINE, stage: 'APPLIED' });
    await expect(
      recruitment.updateCandidate(actor, ID, { schoolId: OTHER, stage: 'APPLIED' } as CandidateDto),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(tx.candidate.update).not.toHaveBeenCalled();
  });

  it('a requirement', async () => {
    const { recruitment, tx } = setup();
    tx.jobRequirement.findFirst.mockResolvedValue({ id: ID, schoolId: MINE });
    await expect(
      recruitment.updateRequirement(actor, ID, { schoolId: OTHER, title: 'x', subject: 'y', department: 'Science', vacancies: 1, status: 'OPEN' } as never),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(tx.jobRequirement.update).not.toHaveBeenCalled();
  });

  it('an appraisal', async () => {
    const { recruitment, tx } = setup();
    tx.teacherAppraisal.findFirst.mockResolvedValue({ id: ID, schoolId: MINE });
    await expect(
      recruitment.updateAppraisal(actor, ID, { schoolId: OTHER, facultyId: ID } as never),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(tx.teacherAppraisal.update).not.toHaveBeenCalled();
  });

  it('an interview', async () => {
    const { recruitment, tx } = setup();
    tx.interview.findFirst.mockResolvedValue({ id: ID, schoolId: MINE, candidateId: 'c-1', candidate: { fullName: 'A' } });
    await expect(
      recruitment.updateInterview(actor, ID, { candidateId: 'c-2', scheduledAt: '2026-10-20T10:00:00Z', mode: 'ONLINE', result: 'PENDING' } as never),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(tx.interview.update).not.toHaveBeenCalled();
  });
});

describe('RecruitmentService: hiring', () => {
  const candidate = (over: Record<string, unknown> = {}) => ({
    id: ID,
    schoolId: MINE,
    fullName: 'Ravi Kumar',
    roleApplied: 'Physics Teacher',
    email: null,
    phone: null,
    department: 'Science',
    experienceYears: 3,
    qualification: null,
    currentOrganization: null,
    expectedSalary: null,
    resumeUrl: null,
    stage: 'OFFER_EXTENDED',
    facultyId: null,
    ...over,
  });
  const setup = (before: ReturnType<typeof candidate>) => {
    const ctx = build('ADMIN', [MINE]);
    ctx.tx.candidate.findFirst.mockResolvedValue(before);
    ctx.tx.candidate.update.mockImplementation(async ({ data }: { data: Record<string, unknown> }) => ({
      ...before,
      ...data,
    }));
    ctx.tx.faculty.findUnique.mockResolvedValue(null);
    ctx.tx.faculty.create.mockResolvedValue({ id: 'fac-1', name: 'Ravi Kumar' });
    return ctx;
  };

  it('the candidate row is locked before it is read', async () => {
    const { recruitment, tx } = setup(candidate());
    await recruitment.setStage(actor, ID, 'HIRED');
    const lock = tx.$queryRaw.mock.invocationCallOrder[0];
    const read = tx.candidate.findFirst.mock.invocationCallOrder[0];
    expect(lock).toBeLessThan(read);
  });

  it('a first hire creates one faculty profile and links it to the candidate', async () => {
    const { recruitment, tx } = setup(candidate());
    const result = await recruitment.setStage(actor, ID, 'HIRED');
    expect(result.facultyCreated).toEqual({ id: 'fac-1', name: 'Ravi Kumar' });
    expect(tx.faculty.create).toHaveBeenCalledTimes(1);
    expect(tx.candidate.update).toHaveBeenLastCalledWith(
      expect.objectContaining({ data: { facultyId: 'fac-1' } }),
    );
  });

  it('hired → rejected → hired again, without an email, does not onboard twice', async () => {
    const { recruitment, tx } = setup(
      candidate({ stage: 'REJECTED', facultyId: 'fac-1' }),
    );
    const result = await recruitment.setStage(actor, ID, 'HIRED');
    expect(result.facultyCreated).toBeNull();
    expect(tx.faculty.create).not.toHaveBeenCalled();
  });

  it('a "move to Hired" that finds the candidate already Hired changes and audits nothing', async () => {
    const { recruitment, tx } = setup(candidate({ stage: 'HIRED', facultyId: 'fac-1' }));
    const result = await recruitment.setStage(actor, ID, 'HIRED');
    expect(result.facultyCreated).toBeNull();
    expect(tx.faculty.create).not.toHaveBeenCalled();
    expect(tx.recruitmentAuditLog.create).not.toHaveBeenCalled();
  });

  it('a hire with an email takes a per-email lock and reuses a profile that already exists', async () => {
    const { recruitment, tx } = setup(candidate({ email: 'ravi@example.com' }));
    tx.faculty.findUnique.mockResolvedValue({ id: 'existing' });
    const result = await recruitment.setStage(actor, ID, 'HIRED');
    expect(result.facultyCreated).toBeNull();
    expect(tx.faculty.create).not.toHaveBeenCalled();
    // one lock for the candidate row, one advisory lock for the email
    expect(tx.$queryRaw).toHaveBeenCalledTimes(1);
    expect(tx.$executeRaw).toHaveBeenCalledTimes(1);
  });

  it('two candidates hired with one email at once: the loser gets a 409, not a 500', async () => {
    const { recruitment, prisma } = setup(candidate({ email: 'ravi@example.com' }));
    prisma.$transaction.mockRejectedValue(duplicate());
    await expect(recruitment.setStage(actor, ID, 'HIRED')).rejects.toBeInstanceOf(ConflictException);
  });

  it('other database errors are not disguised as conflicts', async () => {
    const { recruitment, prisma } = setup(candidate());
    prisma.$transaction.mockRejectedValue(new Error('connection lost'));
    await expect(recruitment.setStage(actor, ID, 'HIRED')).rejects.toThrow('connection lost');
  });

  it('a duplicate appraisal is a 409 that says so', async () => {
    const { recruitment, prisma } = build('ADMIN', [MINE]);
    prisma.$transaction.mockRejectedValue(duplicate());
    await expect(
      recruitment.createAppraisal(actor, {
        schoolId: MINE,
        facultyId: ID,
        period: 'ANNUAL',
        academicYear: '2026-2027',
        status: 'PENDING',
      } as never),
    ).rejects.toThrow(/already has an appraisal/);
  });
});
