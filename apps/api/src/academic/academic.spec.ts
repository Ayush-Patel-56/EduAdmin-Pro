import { parseImportDate, splitList } from './import-utils.js';
import { currentAcademicYear } from './promotion.service.js';

describe('currentAcademicYear', () => {
  it('starts the year on the 1st of the start month', () => {
    expect(currentAcademicYear(4, new Date('2026-10-11T00:00:00Z'))).toEqual({
      academicYear: '2026-2027',
      boundaryDate: new Date('2026-04-01T00:00:00Z'),
    });
    expect(
      currentAcademicYear(4, new Date('2026-04-01T00:00:00Z')).academicYear,
    ).toBe('2026-2027');
  });

  it('is still last year before the boundary', () => {
    expect(
      currentAcademicYear(4, new Date('2026-03-31T23:00:00Z')).academicYear,
    ).toBe('2025-2026');
    expect(
      currentAcademicYear(6, new Date('2026-05-15T00:00:00Z')).academicYear,
    ).toBe('2025-2026');
  });

  it('handles a January start', () => {
    expect(
      currentAcademicYear(1, new Date('2026-01-01T00:00:00Z')).academicYear,
    ).toBe('2026-2027');
  });
});

describe('splitList', () => {
  it('splits on commas, semicolons and newlines, dropping blanks and duplicates', () => {
    expect(splitList('Physics, Chemistry;physics\n Maths ,')).toEqual([
      'Physics',
      'Chemistry',
      'Maths',
    ]);
    expect(splitList(undefined)).toEqual([]);
  });
});

describe('parseImportDate', () => {
  it('accepts ISO and day-first dates', () => {
    const errors: string[] = [];
    expect(parseImportDate('2026-04-01', 'Date', errors)).toEqual(
      new Date('2026-04-01T00:00:00Z'),
    );
    expect(parseImportDate('1/4/2026', 'Date', errors)).toEqual(
      new Date('2026-04-01T00:00:00Z'),
    );
    expect(parseImportDate('', 'Date', errors)).toBeNull();
    expect(errors).toEqual([]);
  });

  it('reports impossible dates', () => {
    const errors: string[] = [];
    expect(parseImportDate('2026-02-30', 'Joining date', errors)).toBeNull();
    expect(parseImportDate('tomorrow', 'Joining date', errors)).toBeNull();
    expect(errors).toHaveLength(2);
    expect(errors[0]).toContain('Joining date');
  });
});
