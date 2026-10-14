import { downloadFile, toCsv } from '@/lib/spreadsheet'
import { todayIst } from '@/lib/dates'
import { formatDay } from '@/features/portal/format'
import { CATEGORY_LABELS, FREQUENCY_LABELS, METHOD_LABELS, periodLabel, STATUS_LABELS, type Due, type FeeStructure } from '@/features/fees/api'

const slug = (name: string) => name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'school'
/** Plain rupees for spreadsheets ("12500.5"), so the column stays numeric. */
const amount = (paise: number) => String(paise / 100)

const STRUCTURE_HEADER = ['Fee Name', 'Fee Category', 'Amount (INR)', 'Frequency', 'Due Day', 'Mandatory', 'Program', 'Batch', 'Academic Year', 'Description']
const structureRows = (rows: FeeStructure[]) =>
  rows.map((s) => [
    s.name,
    CATEGORY_LABELS[s.category],
    amount(s.amountPaise),
    FREQUENCY_LABELS[s.frequency],
    s.dueDay,
    s.mandatory ? 'Yes' : 'No',
    s.program?.name ?? 'All Programs',
    s.batch?.name ?? 'All Batches',
    s.academicYear,
    s.description ?? '',
  ])

const DUE_HEADER = ['Receipt No(s)', 'Student Roll No', 'Student Name', 'Batch', 'Fee Structure Name', 'Period', 'Due Date', 'Amount Due', 'Discount', 'Late Fee', 'Net Payable', 'Amount Paid', 'Outstanding', 'Status', 'Payment Method(s)', 'Transaction ID(s)', 'Last Paid Date']
function dueRows(rows: Due[]) {
  return rows.map((d) => {
    const live = d.payments.filter((p) => !p.voidedAt)
    return [
      live.map((p) => p.receiptNumber).join('; '),
      d.student.rollNumber ?? '',
      d.student.fullName,
      d.student.batch ?? '',
      d.structure.name,
      periodLabel(d.period, d.structure.frequency),
      formatDay(d.dueDate),
      amount(d.amountPaise),
      amount(d.discountPaise),
      amount(d.lateFeePaise),
      amount(d.netPaise),
      amount(d.paidPaise),
      amount(d.outstandingPaise),
      STATUS_LABELS[d.status],
      [...new Set(live.map((p) => METHOD_LABELS[p.method]))].join('; '),
      live.map((p) => p.transactionRef).filter(Boolean).join('; '),
      d.lastPaidOn ? formatDay(d.lastPaidOn) : '',
    ]
  })
}

const name = (school: string, what: string, ext: string) => `${what}-${slug(school)}-${todayIst()}.${ext}`

async function pdf(title: string, subtitle: string, head: string[], body: (string | number)[][], file: string) {
  const [{ jsPDF }, { autoTable }] = await Promise.all([import('jspdf'), import('jspdf-autotable')])
  const doc = new jsPDF({ orientation: 'landscape', unit: 'pt', format: 'a4' })
  doc.setFontSize(16)
  doc.text(title, 40, 40)
  doc.setFontSize(9)
  doc.setTextColor(100)
  doc.text(subtitle, 40, 56)
  autoTable(doc, {
    startY: 70,
    head: [head],
    body,
    styles: { fontSize: 7, cellPadding: 3 },
    headStyles: { fillColor: [15, 23, 42] },
    alternateRowStyles: { fillColor: [248, 250, 252] },
    margin: { left: 30, right: 30 },
  })
  doc.save(file)
}

/** The CSV uses the import template's columns, so an export can be edited and imported back. */
export function exportStructures(format: 'pdf' | 'csv', school: string, rows: FeeStructure[]) {
  if (format === 'csv') return downloadFile(name(school, 'fee-structures', 'csv'), toCsv([STRUCTURE_HEADER, ...structureRows(rows)]))
  return pdf(`${school}: Fee Structures`, `${rows.length} fee structure${rows.length === 1 ? '' : 's'} · generated ${todayIst()}`, STRUCTURE_HEADER, structureRows(rows), name(school, 'fee-structures', 'pdf'))
}

export function exportDues(format: 'pdf' | 'csv', school: string, rows: Due[], filterLabel: string) {
  if (format === 'csv') return downloadFile(name(school, 'fee-payments', 'csv'), toCsv([DUE_HEADER, ...dueRows(rows)]))
  return pdf(`${school}: Fee Payments & Dues`, `${filterLabel} · ${rows.length} record${rows.length === 1 ? '' : 's'} · generated ${todayIst()}`, DUE_HEADER, dueRows(rows), name(school, 'fee-payments', 'pdf'))
}
