/**
 * "6th - 12th" for a contiguous run, "6th, 8th" for a few, "5 selected" for many.
 * Order comes from `options`, not from the order things were clicked.
 */
export function summarize(options: readonly string[], value: string[]): string {
  const indexes = value.map((v) => options.indexOf(v)).filter((i) => i >= 0).sort((a, b) => a - b)
  if (indexes.length === 0) return ''
  if (indexes.length === 1) return options[indexes[0]]
  const contiguous = indexes.every((idx, i) => i === 0 || idx === indexes[i - 1] + 1)
  if (contiguous) return `${options[indexes[0]]} - ${options[indexes.at(-1)!]}`
  if (indexes.length <= 3) return indexes.map((i) => options[i]).join(', ')
  return `${indexes.length} selected`
}
