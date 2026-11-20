/** One subject row of the Generate / Edit Progress Report form, as typed. */
export type MarksRow = { subject: string; marks: string; maxMarks: string }

/**
 * A number with up to two decimals and an optional leading minus (the typed
 * "-" or the "−" some keyboards and apps give), else null. "-0" is 0.
 */
export function markNumber(text: string): number | null {
  const t = text.trim().replace(/^−/, '-')
  if (!/^-?\d+(\.\d{1,2})?$/.test(t)) return null
  return Number(t) || 0
}

/**
 * The first problem with the rows, or null, as the API checks them: marks
 * can be negative (negative marking) down to minus the total, never above it.
 */
export function subjectMarksError(rows: MarksRow[]): string | null {
  if (!rows.length) return 'Add at least one subject'
  for (const r of rows) {
    if (!r.subject) return 'Select each subject'
    const marks = markNumber(r.marks)
    const max = markNumber(r.maxMarks)
    if (marks === null || max === null) return `${r.subject}: enter marks as numbers with up to two decimals`
    if (max <= 0) return `${r.subject}: total marks must be more than 0`
    if (marks > max) return `${r.subject}: marks obtained can’t be more than the total`
    if (marks < -max) return `${r.subject}: marks obtained can’t be less than minus the total (${-max})`
  }
  if (new Set(rows.map((r) => r.subject)).size !== rows.length) return 'Each subject can be on the report once'
  return null
}
