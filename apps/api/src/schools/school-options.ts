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
] as const;

export const STANDARD_PROGRAMS = ['JEE', 'NEET', 'Foundational'] as const;

export const DEFAULT_SELECTION = {
  board: 'CBSE Affiliated',
  classes: ['6th', '7th', '8th', '9th', '10th', '11th', '12th'],
  programs: [...STANDARD_PROGRAMS],
};

/** Sorts classes into display order and drops duplicates. */
export function orderClasses(classes: string[]): string[] {
  const wanted = new Set(classes);
  return CLASS_OPTIONS.filter((c) => wanted.has(c));
}

/** "6th - 12th" for a contiguous run, "6th, 8th" for a few, "5 classes" for many. */
export function classesLabel(classes: string[]): string {
  const indexes = orderClasses(classes).map((c) => CLASS_OPTIONS.indexOf(c as (typeof CLASS_OPTIONS)[number]));
  if (indexes.length === 0) return '';
  if (indexes.length === 1) return CLASS_OPTIONS[indexes[0]];
  const contiguous = indexes.every((idx, i) => i === 0 || idx === indexes[i - 1] + 1);
  if (contiguous) return `${CLASS_OPTIONS[indexes[0]]} - ${CLASS_OPTIONS[indexes[indexes.length - 1]]}`;
  if (indexes.length <= 3) return indexes.map((i) => CLASS_OPTIONS[i]).join(', ');
  return `${indexes.length} classes`;
}
