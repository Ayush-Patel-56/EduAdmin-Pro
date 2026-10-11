/** Today's calendar date in India as YYYY-MM-DD (schools run on IST, wherever the browser is). */
export function todayIst(now = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(now)
}
