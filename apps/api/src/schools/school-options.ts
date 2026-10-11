// Standard choices offered on the Create School form. Served to the web app via
// GET /schools/options so the form and the server validation share one list.

export const STANDARD_BOARDS = [
  'CBSE Affiliated',
  'ICSE Affiliated',
  'State Board',
  'IB',
  'IGCSE',
] as const;

// Display order matters: it's how class ranges like "6th - 12th" are derived.
export const CLASS_OPTIONS = [
  '6th',
  '7th',
  '8th',
  '9th',
  '10th',
  '11th',
  '12th',
  '12th Pass',
  'Repeater',
] as const;

// Classes after this index aren't grades in a sequence (12th Pass, Repeater),
// so they're listed after the grade range rather than extending it.
const LAST_GRADE_INDEX = CLASS_OPTIONS.indexOf('12th');

export const MONTHS = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
] as const;

export const STANDARD_PROGRAMS = ['JEE', 'NEET', 'Foundational'] as const;

export const DEFAULT_SELECTION = {
  board: 'CBSE Affiliated',
  classes: ['6th', '7th', '8th', '9th', '10th', '11th', '12th'],
  programs: [...STANDARD_PROGRAMS],
  academicYearStartMonth: 4, // April
};

/** Sorts classes into display order and drops duplicates. */
export function orderClasses(classes: string[]): (typeof CLASS_OPTIONS)[number][] {
  const wanted = new Set(classes);
  return CLASS_OPTIONS.filter((c) => wanted.has(c));
}

/**
 * "6th - 12th" for a contiguous run of grades, "6th, 8th" for a few, "5 classes"
 * for many; 12th Pass / Repeater are appended, e.g. "6th - 12th, Repeater".
 */
export function classesLabel(classes: string[]): string {
  const ordered = orderClasses(classes);
  const indexes = ordered.map((c) => CLASS_OPTIONS.indexOf(c));
  const grades = indexes.filter((i) => i <= LAST_GRADE_INDEX);
  const extras = indexes.filter((i) => i > LAST_GRADE_INDEX).map((i) => CLASS_OPTIONS[i]);
  return [gradesLabel(grades), ...extras].filter(Boolean).join(', ');
}

function gradesLabel(indexes: number[]): string {
  if (indexes.length === 0) return '';
  if (indexes.length === 1) return CLASS_OPTIONS[indexes[0]];
  const contiguous = indexes.every((idx, i) => i === 0 || idx === indexes[i - 1] + 1);
  if (contiguous) return `${CLASS_OPTIONS[indexes[0]]} - ${CLASS_OPTIONS[indexes[indexes.length - 1]]}`;
  if (indexes.length <= 3) return indexes.map((i) => CLASS_OPTIONS[i]).join(', ');
  return `${indexes.length} classes`;
}
