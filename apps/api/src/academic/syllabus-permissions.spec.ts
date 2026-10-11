import {
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '../generated/prisma/client.js';
import type { PrismaService } from '../prisma/prisma.service.js';
import type { SyllabusItemDto } from './academic.dto.js';
import { SyllabusService } from './syllabus.service.js';

const MINE = 'batch-mine';
const OTHER = 'batch-not-mine';
const dto = (batchId: string): SyllabusItemDto =>
  ({
    batchId,
    subject: 'Physics',
    title: 'Kinematics',
    status: 'NOT_STARTED',
  }) as SyllabusItemDto;

describe('SyllabusService: who may touch which batch', () => {
  const batchFindFirst = vi.fn();
  const itemFindFirst = vi.fn();
  const create = vi.fn();
  const update = vi.fn();
  const del = vi.fn();
  const batchFindMany = vi.fn();
  const prisma = {
    batch: { findFirst: batchFindFirst, findMany: batchFindMany },
    syllabusItem: {
      findFirst: itemFindFirst,
      findMany: vi.fn(),
      create,
      update,
      delete: del,
    },
    school: { findUniqueOrThrow: vi.fn() },
    program: { findFirst: vi.fn() },
  } as unknown as PrismaService;
  const syllabus = new SyllabusService(prisma);
  const teacherScope = [MINE];

  beforeEach(() => {
    vi.clearAllMocks();
    // Every batch id exists in the school; the scope decides access.
    batchFindFirst.mockImplementation(
      async ({ where }: { where: { id: string } }) => ({ id: where.id }),
    );
    itemFindFirst.mockResolvedValue({ batchId: OTHER });
    (
      prisma.syllabusItem.findMany as ReturnType<typeof vi.fn>
    ).mockResolvedValue([]);
    (
      prisma.school.findUniqueOrThrow as ReturnType<typeof vi.fn>
    ).mockResolvedValue({ name: 'School' });
    batchFindMany.mockResolvedValue([
      { id: MINE, name: 'Mine', programId: 'p1', program: { name: 'JEE' } },
    ]);
  });

  it('a teacher can work on their assigned batch', async () => {
    await expect(
      syllabus.list('school-1', teacherScope, MINE, 'Physics'),
    ).resolves.toBeDefined();
    create.mockResolvedValue({ id: 'i1' });
    await expect(
      syllabus.create('school-1', teacherScope, 'user-1', dto(MINE)),
    ).resolves.toBeDefined();
  });

  it('a teacher cannot READ an unassigned batch', async () => {
    await expect(
      syllabus.list('school-1', teacherScope, OTHER, 'Physics'),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('a teacher cannot CREATE in an unassigned batch', async () => {
    await expect(
      syllabus.create('school-1', teacherScope, 'user-1', dto(OTHER)),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(create).not.toHaveBeenCalled();
  });

  it('a teacher cannot EDIT, MOVE or DELETE a chapter of an unassigned batch', async () => {
    // The chapter exists in the school but belongs to a batch outside their scope.
    await expect(
      syllabus.update('school-1', teacherScope, 'u', 'item-1', dto(MINE)),
    ).rejects.toBeInstanceOf(ForbiddenException);
    await expect(
      syllabus.setStatus('school-1', teacherScope, 'u', 'item-1', 'COMPLETED'),
    ).rejects.toBeInstanceOf(ForbiddenException);
    await expect(
      syllabus.remove('school-1', teacherScope, 'item-1'),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(update).not.toHaveBeenCalled();
    expect(del).not.toHaveBeenCalled();
  });

  it('a teacher cannot MOVE a chapter into an unassigned batch', async () => {
    itemFindFirst.mockResolvedValue({ batchId: MINE });
    await expect(
      syllabus.update('school-1', teacherScope, 'u', 'item-1', dto(OTHER)),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(update).not.toHaveBeenCalled();
  });

  it('a teacher cannot IMPORT into an unassigned batch', async () => {
    await expect(
      syllabus.import('school-1', teacherScope, 'u', {
        rows: [],
        dryRun: true,
        defaults: { batchId: OTHER },
      }),
    ).rejects.toThrow(/batch you can edit/);
  });

  it('an import only resolves batches inside the teacher’s scope', async () => {
    await syllabus.import('school-1', teacherScope, 'u', {
      rows: [{ title: 'x', subject: 'Physics', batch: 'Mine' }],
      dryRun: true,
      defaults: {},
    });
    expect(batchFindMany.mock.calls[0][0].where).toMatchObject({
      schoolId: 'school-1',
      id: { in: teacherScope },
    });
  });

  it('an admin (no scope) may use any batch of their school', async () => {
    create.mockResolvedValue({ id: 'i1' });
    await expect(
      syllabus.create('school-1', null, 'admin-1', dto(OTHER)),
    ).resolves.toBeDefined();
  });

  describe('ids from another school', () => {
    beforeEach(() => {
      // The queries are scoped by schoolId, so a foreign id matches nothing.
      batchFindFirst.mockResolvedValue(null);
      itemFindFirst.mockResolvedValue(null);
    });

    it('answer 404, never 403 (no hint that the id exists elsewhere)', async () => {
      await expect(
        syllabus.list('school-1', null, 'foreign-batch'),
      ).rejects.toBeInstanceOf(NotFoundException);
      await expect(
        syllabus.create('school-1', null, 'u', dto('foreign-batch')),
      ).rejects.toBeInstanceOf(NotFoundException);
      await expect(
        syllabus.update('school-1', null, 'u', 'foreign-item', dto(MINE)),
      ).rejects.toBeInstanceOf(NotFoundException);
      await expect(
        syllabus.setStatus('school-1', null, 'u', 'foreign-item', 'COMPLETED'),
      ).rejects.toBeInstanceOf(NotFoundException);
      await expect(
        syllabus.remove('school-1', null, 'foreign-item'),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('look batches and chapters up by BOTH id and the caller’s school', async () => {
      await syllabus
        .list('school-1', null, 'foreign-batch')
        .catch(() => undefined);
      await syllabus
        .remove('school-1', null, 'foreign-item')
        .catch(() => undefined);
      expect(batchFindFirst.mock.calls[0][0].where).toEqual({
        id: 'foreign-batch',
        schoolId: 'school-1',
      });
      expect(itemFindFirst.mock.calls[0][0].where).toEqual({
        id: 'foreign-item',
        schoolId: 'school-1',
      });
    });
  });

  describe('duplicate chapters (database unique index)', () => {
    const duplicate = () =>
      new Prisma.PrismaClientKnownRequestError('Unique constraint failed', {
        code: 'P2002',
        clientVersion: 'test',
      });

    it('creating a chapter that already exists is a 409, not a 500', async () => {
      create.mockRejectedValue(duplicate());
      await expect(
        syllabus.create('school-1', null, 'u', dto(MINE)),
      ).rejects.toBeInstanceOf(ConflictException);
    });

    it('renaming a chapter onto an existing one is a 409', async () => {
      itemFindFirst.mockResolvedValue({ batchId: MINE });
      update.mockRejectedValue(duplicate());
      await expect(
        syllabus.update('school-1', null, 'u', 'item-1', dto(MINE)),
      ).rejects.toBeInstanceOf(ConflictException);
    });

    it('other database errors are not disguised as conflicts', async () => {
      create.mockRejectedValue(new Error('connection lost'));
      await expect(
        syllabus.create('school-1', null, 'u', dto(MINE)),
      ).rejects.toThrow('connection lost');
    });
  });
});
