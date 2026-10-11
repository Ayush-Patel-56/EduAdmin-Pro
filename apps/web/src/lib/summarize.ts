// Grades like "6th" form ranges; other options ("12th Pass", "Repeater") are
// listed after the range rather than extending it.
const GRADE = /^\d+(st|nd|rd|th)$/

/**
 * "6th - 12th" for a contiguous run, "6th, 8th" for a few, "5 selected" for many,
 * with non-grade picks appended: "6th - 12th, Repeater".
 * Order comes from `options`, not from the order things were clicked.
 */
export function summarize(options: readonly string[], value: string[]): string {
  const indexes = value.map((v) => options.indexOf(v)).filter((i) => i >= 0).sort((a, b) => a - b)
  const grades = indexes.filter((i) => GRADE.test(options[i]))
  const extras = indexes.filter((i) => !GRADE.test(options[i])).map((i) => options[i])
  return [rangeLabel(options, grades), ...extras].filter(Boolean).join(', ')
}

function rangeLabel(options: readonly string[], indexes: number[]): string {
  if (indexes.length === 0) return ''
  if (indexes.length === 1) return options[indexes[0]]
  const contiguous = indexes.every((idx, i) => i === 0 || idx === indexes[i - 1] + 1)
  if (contiguous) return `${options[indexes[0]]} - ${options[indexes.at(-1)!]}`
  if (indexes.length <= 3) return indexes.map((i) => options[i]).join(', ')
  return `${indexes.length} selected`
}
