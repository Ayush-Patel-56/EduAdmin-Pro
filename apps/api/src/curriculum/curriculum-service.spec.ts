import { ConflictException, NotFoundException } from '@nestjs/common';
import { Prisma } from '../generated/prisma/client.js';
import type { PrismaService } from '../prisma/prisma.service.js';
import type { ConceptDto, CurriculumImportDto } from './curriculum.dto.js';
import { CurriculumService } from './curriculum.service.js';

const duplicate = (meta?: Record<string, unknown>) =>
  new Prisma.PrismaClientKnownRequestError('Unique constraint failed', {
    code: 'P2002',
    clientVersion: 'test',
    meta,
  });

describe('CurriculumService: ids from another school', () => {
  const chapterFindFirst = vi.fn();
  const conceptFindFirst = vi.fn();
  const writes = vi.fn();
  const prisma = {
    curriculumChapter: {
      findFirst: chapterFindFirst,
      update: writes,
      delete: writes,
      create: writes,
    },
    curriculumConcept: {
      findFirst: conceptFindFirst,
      findMany: writes,
      update: writes,
      delete: writes,
      create: writes,
    },
  } as unknown as PrismaService;
  const curriculum = new CurriculumService(prisma);
  const concept = { name: 'Acceleration' } as ConceptDto;

  beforeEach(() => {
    vi.clearAllMocks();
    // Queries are scoped by schoolId, so another school's id matches nothing.
    chapterFindFirst.mockResolvedValue(null);
    conceptFindFirst.mockResolvedValue(null);
  });

  it('answer 404 for every chapter and concept route, and write nothing', async () => {
    const dto = { subject: 'Physics', name: 'Motion' } as never;
    for (const call of [
      () => curriculum.updateChapter('school-1', 'foreign', dto),
      () => curriculum.deleteChapter('school-1', 'foreign'),
      () => curriculum.listConcepts('school-1', 'foreign'),
      () => curriculum.createConcept('school-1', 'foreign', concept),
      () => curriculum.updateConcept('school-1', 'foreign', concept),
      () => curriculum.deleteConcept('school-1', 'foreign'),
    ]) {
      await expect(call()).rejects.toBeInstanceOf(NotFoundException);
    }
    expect(writes).not.toHaveBeenCalled();
  });

  it('look chapters and concepts up by BOTH id and the caller’s school', async () => {
    await curriculum.deleteChapter('school-1', 'c1').catch(() => undefined);
    await curriculum.deleteConcept('school-1', 'k1').catch(() => undefined);
    expect(chapterFindFirst.mock.calls[0][0].where).toEqual({
      id: 'c1',
      schoolId: 'school-1',
    });
    expect(conceptFindFirst.mock.calls[0][0].where).toEqual({
      id: 'k1',
      schoolId: 'school-1',
    });
  });
});

describe('CurriculumService: duplicates are decided by the database', () => {
  const create = vi.fn();
  const prisma = {
    curriculumChapter: {
      findFirst: vi.fn().mockResolvedValue({ id: 'c1', classLevel: null }),
    },
    curriculumConcept: {
      findFirst: vi.fn().mockResolvedValue(null),
      create,
    },
  } as unknown as PrismaService;
  const curriculum = new CurriculumService(prisma);
  const dto = { name: 'Acceleration' } as ConceptDto;

  beforeEach(() => {
    create.mockReset();
  });

  it('a concept name that wins the race elsewhere is a 409 about the name', async () => {
    create.mockRejectedValue(
      duplicate({ target: 'CurriculumConcept_chapterId_lower_name_key' }),
    );
    await expect(
      curriculum.createConcept('school-1', 'c1', dto),
    ).rejects.toThrow(/name already exists/);
  });

  it('a code clash is a 409 about the code', async () => {
    create.mockRejectedValue(
      duplicate({ target: ['schoolId', 'code'] }),
    );
    await expect(
      curriculum.createConcept('school-1', 'c1', dto),
    ).rejects.toThrow(/code is already used/);
  });

  it('other database errors are not disguised as conflicts', async () => {
    create.mockRejectedValue(new Error('connection lost'));
    await expect(
      curriculum.createConcept('school-1', 'c1', dto),
    ).rejects.toThrow('connection lost');
  });
});

describe('CurriculumService.import', () => {
  const chapterFindMany = vi.fn();
  const conceptFindMany = vi.fn();
  const transaction = vi.fn();
  const prisma = {
    school: {
      findUniqueOrThrow: vi.fn().mockResolvedValue({
        classes: ['11th', '12th'],
        programs: [],
      }),
    },
    curriculumChapter: { findMany: chapterFindMany },
    curriculumConcept: { findMany: conceptFindMany },
    $transaction: transaction,
  } as unknown as PrismaService;
  const curriculum = new CurriculumService(prisma);

  const chapter = (over: Record<string, unknown> = {}) => ({
    id: 'ch-1',
    subject: 'Physics',
    name: 'Motion',
    code: 'CP01',
    board: 'CBSE',
    classLevel: '11th',
    programId: null,
    concepts: [
      { id: 'k-speed', name: 'Speed', code: 'CP01-1' },
      { id: 'k-vel', name: 'Velocity', code: null },
    ],
    ...over,
  });
  const preview = (rows: CurriculumImportDto['rows']) =>
    curriculum.import('school-1', { rows, dryRun: true } as never);

  beforeEach(() => {
    vi.clearAllMocks();
    chapterFindMany.mockResolvedValue([chapter()]);
    conceptFindMany.mockResolvedValue([
      { id: 'k-speed', code: 'CP01-1', chapterId: 'ch-1' },
    ]);
  });

  it('renaming a concept by code onto another concept’s name fails that row', async () => {
    const result = await preview([
      {
        subject: 'Physics',
        chapterName: 'Motion',
        chapterCode: 'CP01',
        conceptName: 'Velocity',
        conceptCode: 'CP01-1',
      },
    ]);
    expect(result.rows[0].action).toBe('error');
    expect(result.rows[0].errors[0]).toMatch(/already a concept of this chapter/);
  });

  it('a concept matched by code alone is renamed; by name alone is updated', async () => {
    const result = await preview([
      {
        subject: 'Physics',
        chapterName: 'Motion',
        chapterCode: 'CP01',
        conceptName: 'Rate of motion',
        conceptCode: 'CP01-1',
      },
      {
        subject: 'Physics',
        chapterName: 'Motion',
        chapterCode: 'CP01',
        conceptName: 'velocity',
      },
    ]);
    expect(result.rows.map((r) => r.action)).toEqual(['update', 'update']);
  });

  it('an uncoded re-import with Board left blank updates the chapter instead of duplicating it', async () => {
    const result = await preview([
      { subject: 'Physics', chapterName: 'motion', conceptName: 'Acceleration' },
    ]);
    expect(result.rows[0].action).toBe('create'); // a new concept...
    expect(result.created).toBe(1);
    expect(chapterFindMany).toHaveBeenCalled();
    // ...inside the existing chapter: no chapter is planned for creation.
    const apply = await curriculum
      .import('school-1', {
        rows: [
          {
            subject: 'Physics',
            chapterName: 'motion',
            conceptName: 'Acceleration',
          },
        ],
        dryRun: false,
      } as never)
      .catch(() => undefined);
    void apply;
    const run = transaction.mock.calls[0]?.[0];
    const tx = {
      curriculumChapter: { update: vi.fn(), create: vi.fn() },
      curriculumConcept: {
        findFirst: vi.fn().mockResolvedValue({ sortOrder: 1 }),
        update: vi.fn(),
        create: vi.fn(),
      },
    };
    await run(tx);
    expect(tx.curriculumChapter.create).not.toHaveBeenCalled();
    expect(tx.curriculumChapter.update.mock.calls[0][0].where.id).toBe('ch-1');
    expect(tx.curriculumConcept.create.mock.calls[0][0].data.chapterId).toBe(
      'ch-1',
    );
  });

  it('a blank board that fits two chapters is refused, not guessed', async () => {
    chapterFindMany.mockResolvedValue([
      chapter({ id: 'ch-a', code: null, board: 'CBSE' }),
      chapter({ id: 'ch-b', code: null, board: 'ICSE' }),
    ]);
    const result = await preview([
      { subject: 'Physics', chapterName: 'Motion', conceptName: 'Speed' },
    ]);
    expect(result.rows[0].action).toBe('error');
    expect(result.rows[0].errors[0]).toMatch(/More than one/);
  });

  it('a filled-in board that differs from the only chapter creates a new one', async () => {
    const result = await preview([
      {
        subject: 'Physics',
        chapterName: 'Motion',
        board: 'ICSE',
        conceptName: 'Speed',
      },
    ]);
    expect(result.rows[0].action).toBe('create');
  });

  it('a duplicate that lands while importing is a 409, not a 500', async () => {
    transaction.mockRejectedValue(
      duplicate({ target: 'CurriculumChapter_natural_key' }),
    );
    await expect(
      curriculum.import('school-1', {
        rows: [{ subject: 'Physics', chapterName: 'Waves' }],
        dryRun: false,
      } as never),
    ).rejects.toBeInstanceOf(ConflictException);
  });
});
