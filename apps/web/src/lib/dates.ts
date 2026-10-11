/** Today's calendar date in India as YYYY-MM-DD (schools run on IST, wherever the browser is). */
export function todayIst(now = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(now)
}

/** The academic year ("2026-2027") that today (IST) falls in, for a school whose year starts in `startMonth` (1-12). */
export function academicYearIst(startMonth: number, now = new Date()): string {
  const [year, month] = todayIst(now).split('-').map(Number)
  const start = month >= startMonth ? year : year - 1
  return `${start}-${start + 1}`
}
