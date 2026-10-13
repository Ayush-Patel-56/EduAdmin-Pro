import { api } from '@/lib/api'
import { todayIst } from '@/lib/dates'
import { downloadFile, toCsv } from '@/lib/spreadsheet'
import { rosterQuery, STUDENT_STATUS_LABELS, type RosterFilters, type StudentStatus } from '@/features/students/api'
import { STUDENT_HEADER } from './studentSheet'

/** One exported student; the API masks Aadhaar (XXXX-XXXX-1234). */
type ExportRow = {
  fullName: string
  admissionNumber: string | null
  aadharNumber: string | null
  rollNumber: string | null
  email: string | null
  phone: string | null
  parentContact: string | null
  address: string | null
  city: string | null
  state: string | null
  pincode: string | null
  dateOfBirth: string | null
  gender: string | null
  bloodGroup: string | null
  previousSchool: string | null
  previousPercentage: number | null
  classLevel: string | null
  program: string | null
  batch: string | null
  admissionDate: string | null
  status: StudentStatus
  notes: string | null
  guardianName: string | null
  guardianRelationship: string | null
  guardianPhone: string | null
  guardianEmail: string | null
}

const slug = (name: string) => name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'school'

async function fetchRows(schoolId: string, filters: Omit<RosterFilters, 'page'>) {
  const rows = await api<ExportRow[]>(`/schools/${schoolId}/students/export${rosterQuery(filters)}`)
  if (rows.length === 0) throw new Error('No students match these filters')
  return rows
}

/** The CSV uses the import template's columns, so an export can be edited and imported back. */
export async function exportRosterCsv(schoolId: string, schoolName: string, filters: Omit<RosterFilters, 'page'>) {
  const rows = await fetchRows(schoolId, filters)
  const body = rows.map((r) => [
    r.fullName, r.admissionNumber, r.aadharNumber, r.rollNumber, r.email, r.phone, r.parentContact, r.address, r.city, r.state,
    r.pincode, r.dateOfBirth, r.gender, r.bloodGroup, '', r.previousSchool,
    r.previousPercentage === null ? '' : `${r.previousPercentage}%`, r.classLevel, r.program, r.batch, r.admissionDate,
    STUDENT_STATUS_LABELS[r.status], r.notes, r.guardianName, r.guardianRelationship, r.guardianPhone, r.guardianEmail,
  ])
  // Aadhaar is masked; the renamed header makes a re-import skip that column instead of failing on it.
  const header = STUDENT_HEADER.map((h) => (h === 'Aadhar Number' ? 'Aadhar Number (masked)' : h))
  downloadFile(`students-${slug(schoolName)}-${todayIst()}.csv`, toCsv([header, ...body]))
  return rows.length
}

/** A printable roster: the columns a class list needs, landscape A4. */
export async function exportRosterPdf(schoolId: string, schoolName: string, filters: Omit<RosterFilters, 'page'>, filterLabel: string) {
  const rows = await fetchRows(schoolId, filters)
  const [{ jsPDF }, { autoTable }] = await Promise.all([import('jspdf'), import('jspdf-autotable')])
  const doc = new jsPDF({ orientation: 'landscape', unit: 'pt', format: 'a4' })
  doc.setFontSize(16)
  doc.text(`${schoolName}: Student Roster`, 40, 40)
  doc.setFontSize(9)
  doc.setTextColor(100)
  doc.text(`${filterLabel} · ${rows.length} student${rows.length === 1 ? '' : 's'} · generated ${todayIst()}`, 40, 56)
  autoTable(doc, {
    startY: 70,
    head: [['Roll No', 'Name', 'Admission No', 'Class', 'Program', 'Batch', 'Phone', 'Parent Contact', 'Guardian', 'Status']],
    body: rows.map((r) => [
      r.rollNumber ?? '—',
      r.fullName,
      r.admissionNumber ?? '—',
      r.classLevel ?? '—',
      r.program ?? 'Unassigned',
      r.batch ?? 'Unassigned',
      r.phone ?? '—',
      r.parentContact ?? '—',
      r.guardianName ? `${r.guardianName}${r.guardianRelationship ? ` (${r.guardianRelationship})` : ''}` : '—',
      STUDENT_STATUS_LABELS[r.status],
    ]),
    styles: { fontSize: 8, cellPadding: 4 },
    headStyles: { fillColor: [15, 23, 42] },
    alternateRowStyles: { fillColor: [248, 250, 252] },
    margin: { left: 40, right: 40 },
  })
  doc.save(`students-${slug(schoolName)}-${todayIst()}.pdf`)
  return rows.length
}
