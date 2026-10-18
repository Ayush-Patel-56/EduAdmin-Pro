import { downloadFile, toCsv } from '@/lib/spreadsheet'
import { longDay, timeIst, type AdminDay, type DailyReport } from '@/features/daily-reports/api'

const slug = (name: string) => name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'school'
const HEADER = ['Date', 'Teacher', 'Program', 'Batch', 'Subject', 'Chapter', 'Status', 'Submitted At', 'Topics Covered', 'Homework Given', 'Observations']

export function reportRows(items: DailyReport[]) {
  return items.map((r) => [
    r.date,
    r.teacher.name,
    r.program.name,
    r.batch.name,
    r.subject,
    r.chapter ?? '',
    r.late ? 'Late' : 'On Time',
    timeIst(r.submittedAt),
    r.topics,
    r.homework ?? '',
    r.observations ?? '',
  ])
}

const fileName = (school: string, day: AdminDay, ext: string) => `daily-reports-${slug(school)}-${day.date}.${ext}`

export function exportReportsCsv(school: string, day: AdminDay, items: DailyReport[]) {
  downloadFile(fileName(school, day, 'csv'), toCsv([HEADER, ...reportRows(items)]))
}

/** The day's reports as a printable A4 page, with the KPIs and filters on top. */
export async function exportReportsPdf(school: string, day: AdminDay, items: DailyReport[], filterLabel: string) {
  const [{ jsPDF }, { autoTable }] = await Promise.all([import('jspdf'), import('jspdf-autotable')])
  const doc = new jsPDF({ orientation: 'landscape', unit: 'pt', format: 'a4' })
  doc.setFontSize(16)
  doc.text(`${school}: Daily Teacher Reports`, 40, 40)
  doc.setFontSize(9)
  doc.setTextColor(100)
  doc.text(
    `${longDay(day.date)} · ${filterLabel} · ${day.kpis.submitted} report(s), ${day.kpis.late} late · ${day.kpis.teachers} teacher(s) · ${day.kpis.classes} batch(es)`,
    40,
    56,
  )
  autoTable(doc, {
    startY: 70,
    head: [HEADER.slice(1)],
    body: reportRows(items).map((row) => row.slice(1)),
    styles: { fontSize: 7.5, cellPadding: 4, overflow: 'linebreak', valign: 'top' },
    headStyles: { fillColor: [15, 23, 42] },
    alternateRowStyles: { fillColor: [248, 250, 252] },
    columnStyles: { 7: { cellWidth: 170 }, 8: { cellWidth: 110 }, 9: { cellWidth: 110 } },
    margin: { left: 40, right: 40 },
  })
  doc.save(fileName(school, day, 'pdf'))
}
