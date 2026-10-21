const MAIL = 'academicplanningsystem@gmail.com'
const mailto = (subject: string) => `mailto:${MAIL}?subject=${encodeURIComponent(subject)}`

export const DEMO_MAILTO = mailto('EduAdmin Pro demo request')
export const INVITE_MAILTO = mailto('Admin invite code for EduAdmin Pro')

export const FAQ = [
  {
    q: 'Can I run more than one school?',
    a: 'Yes. Create a school, or join another with its admin code, and switch between them from the school selector at the top of the management portal.',
  },
  {
    q: 'How do my teachers get access?',
    a: "Share your school's teacher code. They enter it at sign-up or later from the Faculty Portal and verify their email with a 6-digit code. The teacher code can never grant admin rights.",
  },
  {
    q: 'What if a code gets shared with the wrong person?',
    a: 'Any admin can regenerate either code from the dashboard. The old one stops working immediately, and existing members keep their access.',
  },
  {
    q: 'Will I be flooded with emails?',
    a: 'No. The daily email digest is off by default. Admins switch it on in Preferences if they want it.',
  },
  {
    q: 'Where is our data kept?',
    a: 'In a managed PostgreSQL database. Uploaded files sit in a private bucket and are only opened through signed links.',
  },
]

export const TIMETABLE_DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri']
const TIMES = ['9:00', '10:30', '12:00', '2:00']
type Cell = { subject: string; batch: string; tone: 'i' | 'e' | 'a' | 's' }
const SUBJECTS: Cell[] = [
  { subject: 'Physics', batch: 'JEE · A', tone: 'i' },
  { subject: 'Biology', batch: 'NEET · B', tone: 'e' },
  { subject: 'Maths', batch: 'JEE · A', tone: 'i' },
  { subject: 'Chemistry', batch: 'NEET · B', tone: 's' },
  { subject: 'Unit test', batch: 'Physics', tone: 'a' },
]

/** Illustrative sample week for the timetable section (same layout as the approved design). */
export function timetable() {
  return TIMES.map((time, r) => ({
    time,
    cells: TIMETABLE_DAYS.map((_, c) => {
      let cell: Cell | null = (r * 2 + c * 3) % 7 < 5 ? SUBJECTS[(r + c) % 5] : null
      if (r === 1 && c === 4) cell = SUBJECTS[4]
      if (r === 3 && c === 2) cell = null
      return cell
    }),
  }))
}

export const TOASTS: [string, string][] = [
  ['Attendance marked', 'Class 9 · A · just now'],
  ['Test published', 'Unit Test 2 · Physics'],
  ['PTM note added', 'Class 10 · B'],
  ['Daily report filed', 'Biology · NEET B'],
  ['Daily digest sent', 'to admins who opted in'],
  ['Teacher joined', 'via teacher code'],
]
