// Fixed choices for academic planning, served by GET /academic/options so the
// web forms and the server validation share one list.

export const SUBJECTS = [
  'Physics',
  'Chemistry',
  'Mathematics',
  'Biology',
  'Botany',
  'Zoology',
] as const;

export const PROGRAM_TYPES = ['JEE', 'NEET', 'FOUNDATIONAL', 'OTHER'] as const;

export const THEME_COLORS = ['BLUE', 'GREEN', 'PURPLE'] as const;

export const TARGET_EXAMS = [
  'JEE Main',
  'JEE Advanced',
  'NEET UG',
  'BITSAT',
  'NTSE',
  'CUET',
  'Science Olympiad',
  'Maths Olympiad',
  'CBSE Board',
  'ICSE Board',
] as const;

export const CLASS_LEVELS = [6, 7, 8, 9, 10, 11, 12] as const;

/** Boards a curriculum chapter can be tagged with (PRD §4.3). */
export const CURRICULUM_BOARDS = ['CBSE', 'ICSE', 'ISC', 'State Board'] as const;

export const SYLLABUS_STATUSES = [
  'NOT_STARTED',
  'IN_PROGRESS',
  'COMPLETED',
] as const;

export const FACULTY_STATUSES = ['ACTIVE', 'ON_LEAVE', 'INACTIVE'] as const;

/** Most rows accepted by one bulk import call. */
export const MAX_IMPORT_ROWS = 1000;

/** Type, usual exams and colour for the standard programs picked at school setup. */
export function standardProgramDefaults(name: string) {
  switch (name.toLowerCase()) {
    case 'jee':
      return {
        type: 'JEE',
        targetExams: ['JEE Main', 'JEE Advanced'],
        themeColor: 'BLUE',
      } as const;
    case 'neet':
      return {
        type: 'NEET',
        targetExams: ['NEET UG'],
        themeColor: 'GREEN',
      } as const;
    case 'foundational':
      return {
        type: 'FOUNDATIONAL',
        targetExams: [],
        themeColor: 'PURPLE',
      } as const;
    default:
      return { type: 'OTHER', targetExams: [], themeColor: 'BLUE' } as const;
  }
}
