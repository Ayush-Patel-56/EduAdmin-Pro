import { downloadFile, toCsv } from '@/lib/spreadsheet'
import { dateTimeIst, longDay, type AdminDay, type DailyReport } from '@/features/daily-reports/api'

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
    // With its day: a Late report was sent on a later day than the one it's about.
    dateTimeIst(r.submittedAt),
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

/** One report as a printable A4 page, opened with the browser's print dialog (nothing is downloaded). */
export async function printReport(school: string, r: DailyReport & { flag?: { by: string; reason: string | null; at: string } | null }) {
  const { jsPDF } = await import('jspdf')
  const doc = new jsPDF({ unit: 'pt', format: 'a4' })
  const width = doc.internal.pageSize.getWidth() - 96
  let y = 56
  const line = (text: string, size: number, opts: { bold?: boolean; color?: number; gap?: number } = {}) => {
    doc.setFont('helvetica', opts.bold ? 'bold' : 'normal')
    doc.setFontSize(size)
    doc.setTextColor(opts.color ?? 20)
    for (const part of doc.splitTextToSize(text, width) as string[]) {
      if (y > doc.internal.pageSize.getHeight() - 56) {
        doc.addPage()
        y = 56
      }
      doc.text(part, 48, y)
      y += size * 1.4
    }
    y += opts.gap ?? 0
  }
  line(school, 15, { bold: true })
  line(`Daily Class Report · ${longDay(r.date)}`, 11, { color: 90, gap: 10 })
  line(`${r.teacher.name} · ${r.program.name} · ${r.batch.name} · ${r.subject}${r.chapter ? ` · ${r.chapter}` : ''}`, 10.5, { bold: true })
  line(`${r.late ? 'Late' : 'On Time'} · submitted ${dateTimeIst(r.submittedAt)}${r.edited ? ' · edited' : ''}`, 9.5, { color: 90, gap: 12 })
  for (const [label, text] of [['Topics Covered', r.topics], ['Homework Given', r.homework], ['Observations', r.observations]] as const) {
    if (!text) continue
    line(label.toUpperCase(), 8.5, { bold: true, color: 110 })
    line(text, 10.5, { gap: 10 })
  }
  if (r.flag) line(`Flagged by ${r.flag.by} on ${dateTimeIst(r.flag.at)}${r.flag.reason ? `: ${r.flag.reason}` : ''}`, 9.5, { color: 150 })
  doc.autoPrint()
  window.open(doc.output('bloburl'), '_blank', 'noopener')
}
