import { ConflictException } from '@nestjs/common';
import { describe, expect, it } from 'vitest';
import { Prisma } from '../generated/prisma/client.js';
import { realUniqueError } from './prisma-errors.fixture.js';
import {
  duplicateAsConflict,
  isCodeClash,
  uniqueViolation,
} from './unique-violation.js';

describe('uniqueViolation', () => {
  it('reads the index name from the pg driver adapter error', () => {
    expect(
      uniqueViolation(
        realUniqueError(
          'CurriculumChapter_schoolId_code_key',
          'CurriculumChapter',
        ),
      ),
    ).toEqual(['CurriculumChapter_schoolId_code_key']);
  });

  it('reads constraint fields and meta.target too', () => {
    const fields = new Prisma.PrismaClientKnownRequestError('x', {
      code: 'P2002',
      clientVersion: '7',
      meta: {
        driverAdapterError: {
          cause: { constraint: { fields: ['schoolId', 'code'] } },
        },
      },
    });
    expect(uniqueViolation(fields)).toEqual(['schoolId', 'code']);
    const target = new Prisma.PrismaClientKnownRequestError('x', {
      code: 'P2002',
      clientVersion: '7',
      meta: { target: ['schoolId', 'name'] },
    });
    expect(uniqueViolation(target)).toEqual(['schoolId', 'name']);
  });

  it('is null for anything that is not a P2002', () => {
    expect(uniqueViolation(new Error('boom'))).toBeNull();
    expect(
      uniqueViolation(
        new Prisma.PrismaClientKnownRequestError('x', {
          code: 'P2025',
          clientVersion: '7',
        }),
      ),
    ).toBeNull();
  });
});

describe('isCodeClash', () => {
  it.each([
    ['CurriculumChapter_schoolId_code_key', true],
    ['CurriculumConcept_schoolId_code_key', true],
    ['Program_schoolId_code_key', true],
    ['CurriculumChapter_natural_key', false],
    ['CurriculumConcept_chapterId_lower_name_key', false],
    ['Program_schoolId_lower_name_key', false],
  ])('%s -> %s', (index, expected) => {
    expect(isCodeClash(uniqueViolation(realUniqueError(index, 'T'))!)).toBe(
      expected,
    );
  });
});

describe('duplicateAsConflict', () => {
  it('turns a P2002 into a 409 with the given message', async () => {
    await expect(
      duplicateAsConflict(
        () => Promise.reject(realUniqueError('X_key', 'X')),
        'dup',
      ),
    ).rejects.toEqual(new ConflictException('dup'));
  });

  it('passes other errors through untouched', async () => {
    const err = new Error('db down');
    await expect(
      duplicateAsConflict(() => Promise.reject(err), 'dup'),
    ).rejects.toBe(err);
  });
});
