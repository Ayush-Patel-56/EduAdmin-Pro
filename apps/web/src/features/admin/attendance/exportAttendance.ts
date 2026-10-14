import { downloadFile, toCsv } from '@/lib/spreadsheet'
import { formatDay } from '@/features/portal/format'
import type { Overview } from '@/features/attendance/api'

const slug = (name: string) => name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'school'
const HEADER = ['Student', 'Roll No', 'Batch', 'Present Days', 'Absent Days', 'Attendance %', 'Last Absent Date']
const percent = (rate: number | null) => (rate === null ? '' : `${rate}%`)

function rows(students: Overview['students']) {
  return students.map((s) => [
    s.fullName,
    s.rollNumber ?? '',
    s.batch ?? 'Unassigned',
    s.presentDays,
    s.absentDays,
    percent(s.rate),
    s.lastAbsent ? formatDay(s.lastAbsent) : '',
  ])
}

const fileName = (school: string, o: Overview, ext: string) => `attendance-${slug(school)}-${o.range.from}-to-${o.range.to}.${ext}`

export function exportAttendanceCsv(school: string, o: Overview) {
  downloadFile(fileName(school, o, 'csv'), toCsv([HEADER, ...rows(o.students)]))
}

/** Student Attendance Detail as a printable A4 report, with the period and KPIs on top. */
export async function exportAttendancePdf(school: string, o: Overview, filterLabel: string) {
  const [{ jsPDF }, { autoTable }] = await Promise.all([import('jspdf'), import('jspdf-autotable')])
  const doc = new jsPDF({ orientation: 'landscape', unit: 'pt', format: 'a4' })
  doc.setFontSize(16)
  doc.text(`${school}: Attendance Detail`, 40, 40)
  doc.setFontSize(9)
  doc.setTextColor(100)
  doc.text(
    `${formatDay(o.range.from)} to ${formatDay(o.range.to)} · ${filterLabel} · overall ${o.kpis.rate === null ? 'no records' : `${o.kpis.rate}%`} · ${o.kpis.batchesBelow75} batch(es) below 75% · ${o.kpis.perfectAttendance} with perfect attendance`,
    40,
    56,
  )
  autoTable(doc, {
    startY: 70,
    head: [HEADER],
    body: rows(o.students),
    styles: { fontSize: 8, cellPadding: 4 },
    headStyles: { fillColor: [15, 23, 42] },
    alternateRowStyles: { fillColor: [248, 250, 252] },
    margin: { left: 40, right: 40 },
  })
  doc.save(fileName(school, o, 'pdf'))
}
