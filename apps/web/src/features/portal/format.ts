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
