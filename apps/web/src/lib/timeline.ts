/**
 * Red / amber / green for a syllabus chapter, from its free-text target dates
 * and its status. The text usually has no year: it's taken from the school's
 * academic year (months from the start month on are in its first calendar year).
 *
 * Read: "Aug 01 - Aug 20", "Oct 15 – Nov 15", "1 Aug to 20 Aug", "Aug 01 - 20",
 * "15 Oct", "September 3rd - September 18th", "1st-15th Aug", "1 - 15 Aug 2026",
 * "01/08 - 20/08", "01-08 - 20-08", "01.08.2026 to 20.08.2026", "2026-08-01 - 2026-08-20".
 * Day-month numbers are day first (Indian style). Anything else ("Term 2",
 * "next week", "Q3") isn't a date: the card stays neutral.
 */

const MONTHS: Record<string, number> = {
  jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, sept: 9, oct: 10, nov: 11, dec: 12,
}

/** Within this many days of the end date, a chapter that isn't done turns amber. */
export const AMBER_DAYS = 7

type Part = { day: number; month: number | null; year: number | null }

function parsePart(raw: string): Part | null {
  const s = raw.trim().toLowerCase().replace(/[,.]/g, ' ').replace(/\s+/g, ' ')
  let m = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(s)
  if (m) return { year: +m[1], month: +m[2], day: +m[3] }
  m = /^(\d{1,2})[/.-](\d{1,2})(?:[/.-](\d{4}))?$/.exec(raw.trim())
  if (m) return { day: +m[1], month: +m[2], year: m[3] ? +m[3] : null }
  m = /^([a-z]+) (\d{1,2})(?:st|nd|rd|th)?(?: (\d{4}))?$/.exec(s)
  if (m && MONTHS[m[1].slice(0, 3)] !== undefined) return { month: MONTHS[m[1].slice(0, 3)], day: +m[2], year: m[3] ? +m[3] : null }
  m = /^(\d{1,2})(?:st|nd|rd|th)? ([a-z]+)(?: (\d{4}))?$/.exec(s)
  if (m && MONTHS[m[2].slice(0, 3)] !== undefined) return { day: +m[1], month: MONTHS[m[2].slice(0, 3)], year: m[3] ? +m[3] : null }
  m = /^(\d{1,2})$/.exec(s)
  if (m) return { day: +m[1], month: null, year: null }
  return null
}

const RANGE = String.raw`\s*(?:-|–|—|\bto\b|\buntil\b|\btill\b)\s*`
const NUMERIC = String.raw`\d{1,2}[/.-]\d{1,2}(?:[/.-]\d{4})?`

/** The one or two dates in the text, before years are filled in. */
function readParts(t: string): (Part | null)[] | null {
  // ISO dates hold hyphens of their own: "2026-08-01 - 2026-08-20".
  const isoDates = t.match(/\d{4}-\d{1,2}-\d{1,2}/g)
  if (isoDates) return isoDates.slice(0, 2).map(parsePart)
  // "1st-15th Aug", "1 - 15 Aug 2026": two days of one month.
  let m = new RegExp(String.raw`^(\d{1,2})(?:st|nd|rd|th)?${RANGE}(\d{1,2})(?:st|nd|rd|th)?\s+([a-z]+)\.?(?:\s+(\d{4}))?$`, 'i').exec(t)
  if (m) {
    const month = MONTHS[m[3].slice(0, 3).toLowerCase()]
    if (month === undefined) return null
    const year = m[4] ? +m[4] : null
    return [{ day: +m[1], month, year }, { day: +m[2], month, year }]
  }
  // Numeric day-month, whatever the separator: "01-08 - 20-08", "01.08.2026 to 20.08.2026", "01-08".
  m = new RegExp(String.raw`^(${NUMERIC})(?:${RANGE}(${NUMERIC}))?$`, 'i').exec(t)
  if (m) return [parsePart(m[1]), ...(m[2] ? [parsePart(m[2])] : [])]
  return t.split(new RegExp(RANGE, 'i')).filter(Boolean).slice(0, 2).map(parsePart)
}

const iso = (y: number, m: number, d: number) => `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`

function valid(y: number, m: number, d: number) {
  if (m < 1 || m > 12 || d < 1) return false
  return d <= new Date(Date.UTC(y, m, 0)).getUTCDate()
}

/** The start and end (YYYY-MM-DD) the text describes, or null when it can't be read. */
export function parseTargetRange(text: string | null | undefined, startMonth: number, today: string): { start: string; end: string } | null {
  if (!text?.trim()) return null
  const parts = readParts(text.trim())
  if (!parts?.length || parts.some((p) => !p)) return null
  let [a, b] = parts as Part[]
  b ??= a
  // "Aug 01 - 20": the end takes the start's month.
  if (b.month === null) b = { ...b, month: a.month }
  if (a.month === null) a = { ...a, month: b.month }
  if (a.month === null || b.month === null) return null
  const [ty, tm] = today.split('-').map(Number)
  const yearStart = tm >= startMonth ? ty : ty - 1
  const yearOf = (p: Part) => p.year ?? (p.month! >= startMonth ? yearStart : yearStart + 1)
  const ay = yearOf(a)
  let by = yearOf(b)
  if (!b.year && (by < ay || (by === ay && (b.month! < a.month! || (b.month === a.month && b.day < a.day))))) by = ay + (b.month! < a.month! ? 1 : 0)
  if (!valid(ay, a.month, a.day) || !valid(by, b.month, b.day)) return null
  const start = iso(ay, a.month, a.day)
  const end = iso(by, b.month, b.day)
  return end < start ? null : { start, end }
}

export type Timeline = { tone: 'green' | 'amber' | 'red'; label: string }

const days = (from: string, to: string) => Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000)

/**
 * Green: done, or on track. Amber: due within AMBER_DAYS, or its start date has
 * passed while it's still not started. Red: past its end date and not done.
 * Null when there are no readable dates (the card stays neutral).
 */
export function chapterTimeline(status: 'NOT_STARTED' | 'IN_PROGRESS' | 'COMPLETED', range: { start: string; end: string } | null, today: string): Timeline | null {
  if (status === 'COMPLETED') return { tone: 'green', label: 'Completed' }
  if (!range) return null
  const left = days(today, range.end)
  if (left < 0) return { tone: 'red', label: `Overdue by ${-left} day${left === -1 ? '' : 's'}` }
  if (left <= AMBER_DAYS) return { tone: 'amber', label: left === 0 ? 'Due today' : `Due in ${left} day${left === 1 ? '' : 's'}` }
  if (status === 'NOT_STARTED' && today >= range.start) return { tone: 'amber', label: 'Should have started' }
  return { tone: 'green', label: status === 'IN_PROGRESS' ? 'On track' : `Starts ${range.start > today ? `in ${days(today, range.start)} days` : 'now'}` }
}
