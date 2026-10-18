import { shortDay, type PtmNote } from './api'

const slug = (text: string) => text.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'student'

/** The Parent-Teacher Meeting Report for one note, as an A4 PDF. */
export async function ptmReportPdf(note: PtmNote) {
  const { jsPDF } = await import('jspdf')
  const doc = new jsPDF({ unit: 'pt', format: 'a4' })
  const width = doc.internal.pageSize.getWidth()
  const height = doc.internal.pageSize.getHeight()
  const left = 56
  const usable = width - left * 2
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(20)
  doc.setTextColor(15, 23, 42)
  doc.text('Parent-Teacher Meeting Report', width / 2, 64, { align: 'center' })

  // Two columns of label / value pairs.
  const pairs: [string, string, boolean?][] = [
    ['Date of Meeting', shortDay(note.date)],
    ['Batch / Class', note.batch.name],
    ['Student Name', note.student.fullName],
    ['Roll Number', note.student.rollNumber || '—'],
    ['Parent Name', note.parentName || '—'],
    ['Parent Attended', note.parentAttended ? 'Yes' : 'No', true],
  ]
  let y = 104
  pairs.forEach(([label, value, attended], i) => {
    const x = i % 2 === 0 ? left : left + usable / 2
    if (i % 2 === 0 && i > 0) y += 44
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(10)
    doc.setTextColor(15, 23, 42)
    doc.text(label, x, y)
    doc.setFont('helvetica', attended ? 'bold' : 'normal')
    if (attended) doc.setTextColor(...((note.parentAttended ? [5, 150, 105] : [220, 38, 38]) as [number, number, number]))
    else doc.setTextColor(71, 85, 105)
    doc.text(doc.splitTextToSize(value, usable / 2 - 16) as string[], x, y + 15)
  })
  y += 44
  doc.setDrawColor(79, 70, 229)
  doc.setLineWidth(2.5)
  doc.line(left, y, width - left, y)
  y += 28

  const section = (title: string, body: string) => {
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(12)
    doc.setTextColor(15, 23, 42)
    if (y > height - 80) {
      doc.addPage()
      y = 64
    }
    doc.text(title, left, y)
    y += 18
    doc.setFont('helvetica', 'normal')
    doc.setFontSize(10.5)
    doc.setTextColor(30, 41, 59)
    for (const line of doc.splitTextToSize(body, usable) as string[]) {
      if (y > height - 56) {
        doc.addPage()
        y = 64
      }
      doc.text(line, left, y)
      y += 15
    }
    y += 18
  }
  section('Discussion Notes', note.discussion)
  if (note.actionItems) section('Action Items & Commitments', note.actionItems)
  if (note.followUpDate) section('Follow-up Date', shortDay(note.followUpDate))

  doc.setFont('helvetica', 'normal')
  doc.setFontSize(8)
  doc.setTextColor(148, 163, 184)
  doc.text(`Logged by ${note.teacherName}`, left, height - 32)
  return { doc, fileName: `ptm-${slug(note.student.fullName)}-${note.date}.pdf` }
}

/**
 * Print: opens the report in a new tab with the print dialog. The tab is
 * opened right away (inside the click), so popup blockers allow it, and gets
 * the PDF once it is ready.
 */
export async function printPtmReport(note: PtmNote) {
  const tab = window.open('', '_blank')
  const { doc, fileName } = await ptmReportPdf(note)
  doc.setProperties({ title: fileName })
  doc.autoPrint()
  const url = doc.output('bloburl') as unknown as string
  if (tab) tab.location.href = url
  else window.open(url, '_blank')
}
