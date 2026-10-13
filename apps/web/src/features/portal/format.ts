const dateFormat = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })

/** "10 Oct 2026" */
export const formatDate = (iso: string) => dateFormat.format(new Date(iso))

const longDateFormat = new Intl.DateTimeFormat('en-GB', {
  weekday: 'long',
  day: 'numeric',
  month: 'short',
  year: 'numeric',
})

/** "Saturday, 10 Oct 2026" */
export const formatLongDate = (date: Date) => {
  const parts = Object.fromEntries(longDateFormat.formatToParts(date).map((p) => [p.type, p.value]))
  return `${parts.weekday}, ${parts.day} ${parts.month} ${parts.year}`
}

const dayFormat = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' })

/** A calendar date ("2026-10-01") as "1 Oct 2026", the same in every browser time zone. */
export const formatDay = (isoDate: string) => dayFormat.format(new Date(`${isoDate}T00:00:00Z`))
