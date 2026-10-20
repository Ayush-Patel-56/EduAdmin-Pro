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

/** "5 min ago", "3 h ago", "2 Oct". */
export function timeAgo(iso: string, now = Date.now()): string {
  const s = Math.max(0, Math.round((now - new Date(iso).getTime()) / 1000))
  if (s < 60) return 'just now'
  if (s < 3600) return `${Math.floor(s / 60)} min ago`
  if (s < 86_400) return `${Math.floor(s / 3600)} h ago`
  return new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Kolkata', day: 'numeric', month: 'short' }).format(new Date(iso))
}
