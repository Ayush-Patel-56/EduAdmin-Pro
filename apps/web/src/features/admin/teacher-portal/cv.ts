import { todayIst } from '@/lib/dates'
import { FACULTY_STATUS_LABELS } from '@/features/academic/api'
import { formatDay } from '@/features/portal/format'
import { BATCH_ROLE_LABELS, DESIGNATION_LABELS, type FacultyDetail } from '@/features/faculty/api'

const slug = (name: string) => name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'faculty'

/** A one-page CV built from the faculty profile, downloaded as a PDF. */
export async function downloadCv(f: FacultyDetail, schoolName: string) {
  const { jsPDF } = await import('jspdf')
  const doc = new jsPDF({ unit: 'pt', format: 'a4' })
  const width = doc.internal.pageSize.getWidth()
  const left = 48
  let y = 64

  doc.setFont('helvetica', 'bold')
  doc.setFontSize(22)
  doc.text(f.name, left, y)
  y += 20
  doc.setFont('helvetica', 'normal')
  doc.setFontSize(11)
  doc.setTextColor(90)
  const headline = [DESIGNATION_LABELS[f.designation], f.primarySubject, schoolName].filter(Boolean).join(' · ')
  doc.text(headline, left, y)
  y += 16
  const contact = [f.email, f.phone, [f.city, f.state].filter(Boolean).join(', ')].filter(Boolean).join('  |  ')
  if (contact) {
    doc.text(contact, left, y)
    y += 16
  }
  doc.setDrawColor(220)
  doc.line(left, y, width - left, y)
  y += 24

  const section = (title: string) => {
    if (y > 760) {
      doc.addPage()
      y = 64
    }
    doc.setTextColor(20)
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(12)
    doc.text(title.toUpperCase(), left, y)
    y += 16
    doc.setFont('helvetica', 'normal')
    doc.setFontSize(10.5)
    doc.setTextColor(60)
  }
  const line = (label: string, value: string | number | null | undefined) => {
    if (value === null || value === undefined || value === '') return
    doc.setFont('helvetica', 'bold')
    doc.text(`${label}:`, left, y)
    doc.setFont('helvetica', 'normal')
    const wrapped = doc.splitTextToSize(String(value), width - left * 2 - 130) as string[]
    doc.text(wrapped, left + 130, y)
    y += 15 * wrapped.length
  }
  const paragraph = (text: string) => {
    const wrapped = doc.splitTextToSize(text, width - left * 2) as string[]
    doc.text(wrapped, left, y)
    y += 15 * wrapped.length
  }

  if (f.bio) {
    section('Profile')
    paragraph(f.bio)
    y += 10
  }
  section('Professional')
  line('Qualification', f.qualification)
  line('Specialisation', f.specialization)
  line('Primary stream', f.primaryStream)
  line('Experience', f.experienceYears === null ? null : `${f.experienceYears} year${f.experienceYears === 1 ? '' : 's'}`)
  line('Joined', f.joiningDate ? formatDay(f.joiningDate) : null)
  line('Employee ID', f.employeeId)
  line('Status', FACULTY_STATUS_LABELS[f.status])
  y += 10
  section('Teaching')
  line('Subjects', f.subjects.map((s) => (s === f.primarySubject ? `${s} (primary)` : s)).join(', ') || null)
  line('Programs', f.programs.map((p) => p.name).join(', ') || null)
  line('Batches', f.batches.map((b) => `${b.name} (${BATCH_ROLE_LABELS[b.role]})`).join(', ') || null)
  y += 10
  section('Personal')
  line('Date of birth', f.dateOfBirth ? formatDay(f.dateOfBirth) : null)
  line('Gender', f.gender)
  line('Address', [f.address, f.city, f.state, f.pincode].filter(Boolean).join(', ') || null)
  line('Alt phone', f.altPhone)

  doc.setFontSize(8)
  doc.setTextColor(150)
  doc.text(`Generated from EduAdmin Pro on ${formatDay(todayIst())}`, left, doc.internal.pageSize.getHeight() - 32)
  doc.save(`cv-${slug(f.name)}.pdf`)
}
